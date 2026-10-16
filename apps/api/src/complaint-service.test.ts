import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { User, ComplaintAction } from '@fixmycampus/shared';
const mocks = vi.hoisted(() => ({
  rows: vi.fn(),
  execute: vi.fn(),
  audit: vi.fn(),
  notify: vi.fn(),
  deliver: vi.fn(),
  validate: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
  db: {},
}));
vi.mock('./db.js', () => ({
  rows: mocks.rows,
  execute: mocks.execute,
  transaction: (fn: (db: unknown) => unknown) => fn(mocks.db),
  iso: (value: unknown) =>
    value instanceof Date
      ? value.toISOString()
      : new Date(
          String(value).includes('T') ? String(value) : String(value).replace(' ', 'T') + 'Z',
        ).toISOString(),
}));
vi.mock('./audit.js', () => ({ audit: mocks.audit }));
vi.mock('./notifications.js', () => ({
  notifyComplaint: mocks.notify,
  deliverOutbox: mocks.deliver,
}));
vi.mock('./storage.js', () => ({
  validateFile: mocks.validate,
  saveFile: mocks.save,
  removeFile: mocks.remove,
}));
import {
  complaintVisibility,
  complaintFilters,
  serializeComplaint,
  slaHours,
  listComplaints,
  getComplaint,
  createComplaint,
  actOnComplaint,
  addAttachments,
  submitFeedback,
} from './complaint-service.js';

const owner: User = {
  id: 1,
  name: 'Reporter',
  email: 'reporter@campus.test',
  role: 'Student',
  departmentId: null,
  contactNumber: null,
  affiliation: null,
  photoUrl: null,
  active: true,
  createdAt: '2026-10-01T00:00:00Z',
};
const incharge: User = { ...owner, id: 2, role: 'Campus Incharge' };
const officer: User = { ...owner, id: 3, role: 'Department Officer', departmentId: 10 };
const admin: User = { ...owner, id: 4, role: 'Administrator' };
const input = {
  categoryId: 1,
  description: 'The classroom ceiling requires repair.',
  location: 'Building A, room 101',
  anonymous: false,
};
const file = (name = 'reporter-name.png'): Express.Multer.File =>
  ({
    fieldname: 'files',
    originalname: name,
    encoding: '7bit',
    mimetype: 'image/png',
    size: 8,
    buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  }) as Express.Multer.File;
let current: Record<string, any>;
let category: Record<string, any>;
let attachmentCount = 0;
let attachmentRows: Record<string, any>[];
let inactiveDepartments: Set<number>;
let sequence = 1;
function joined() {
  return {
    ...current,
    category_name: category.name,
    department_name: current.department_id ? 'Maintenance' : null,
    reporter_name: owner.name,
    reporter_email: owner.email,
    due_at: '2026-10-19 12:00:00',
    escalated_at: null,
    rating: null,
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-16T12:00:00Z'));
  current = {
    id: 42,
    reference: 'CMP-20261016-0001',
    reporter_id: 1,
    category_id: 1,
    department_id: 10,
    status: 'Assigned',
    priority: 'Medium',
    description: input.description,
    location: input.location,
    anonymous: 0,
    confidential: 0,
    emergency: 0,
    cycle_number: 1,
    version: 2,
    resolved_at: null,
    resolution_summary: null,
    created_at: '2026-10-16 10:00:00',
    updated_at: '2026-10-16 10:00:00',
  };
  category = {
    id: 1,
    code: 'CLASSROOM',
    name: 'Classroom Infrastructure',
    department_id: 10,
    confidential: 0,
    emergency: 0,
    active: 1,
  };
  attachmentCount = 0;
  attachmentRows = [];
  inactiveDepartments = new Set();
  sequence = 1;
  mocks.validate.mockReturnValue('image/png');
  mocks.save.mockResolvedValue({ key: 'saved-image', driver: 'local' });
  mocks.remove.mockResolvedValue(undefined);
  mocks.audit.mockResolvedValue(undefined);
  mocks.notify.mockResolvedValue(undefined);
  mocks.deliver.mockResolvedValue(undefined);
  mocks.rows.mockReset();
  mocks.rows.mockImplementation(async (sql: string, values: unknown[] = []) => {
    if (sql.startsWith('SELECT c.*,cat.name')) return [joined()];
    if (sql.startsWith('SELECT * FROM complaints')) return [{ ...current }];
    if (sql.startsWith('SELECT cat.*')) return [category];
    if (sql.startsWith('SELECT last_number')) return [{ last_number: sequence }];
    if (sql.startsWith('SELECT value_json')) return [];
    if (sql.startsWith('SELECT id FROM departments'))
      return inactiveDepartments.has(Number(values[0])) ? [] : [{ id: Number(values[0]) }];
    if (sql.startsWith('SELECT department_id FROM categories'))
      return [{ department_id: category.department_id }];
    if (sql.startsWith('SELECT started_at FROM resolution_cycles'))
      return [{ started_at: current.created_at }];
    if (sql.startsWith('SELECT COUNT(*) count FROM attachments'))
      return [{ count: attachmentCount }];
    if (sql.startsWith('SELECT COUNT(*) total')) return [{ total: 1 }];
    if (sql.startsWith('SELECT id,original_name')) return attachmentRows;
    return [];
  });
  mocks.execute.mockReset();
  mocks.execute.mockImplementation(async (sql: string, values: unknown[] = []) => {
    if (sql.startsWith('INSERT INTO complaints'))
      Object.assign(current, {
        reporter_id: values[1],
        category_id: values[2],
        description: values[3],
        location: values[4],
        anonymous: values[5],
        confidential: values[6],
        emergency: values[7],
        priority: values[8],
        status: 'Submitted',
        department_id: null,
        version: 0,
      });
    if (sql.startsWith('UPDATE complaints SET department_id')) current.department_id = values[0];
    if (sql.startsWith("UPDATE complaints SET status='Assigned'")) current.status = 'Assigned';
    if (sql.startsWith('UPDATE complaints SET status=?')) {
      current.status = values[0];
      current.version++;
    }
    if (sql.startsWith('UPDATE complaints SET priority=')) current.priority = values[0];
    if (sql.startsWith('UPDATE complaints SET resolution_summary=')) {
      current.resolution_summary = values[0];
      current.resolved_at = values[1];
    }
    if (sql.startsWith('UPDATE complaints SET cycle_number=')) {
      current.cycle_number = values[0];
      current.resolved_at = null;
      current.resolution_summary = null;
    }
    return { insertId: 42, affectedRows: 1 };
  });
});
afterEach(() => vi.useRealTimers());
describe('visibility, search and serialization', () => {
  it('scopes reporter, department, triage and administrator queues', () => {
    expect(complaintVisibility(owner)).toEqual({ sql: 'c.reporter_id=?', values: [1] });
    expect(complaintVisibility(officer)).toEqual({ sql: 'c.department_id=?', values: [10] });
    expect(complaintVisibility(incharge).sql).toBe('1=1');
    expect(complaintVisibility(admin).sql).toBe('1=0');
  });
  it('parameterizes combined filters and excludes anonymous identities from name searches', () => {
    const filters = complaintFilters(officer, {
      q: "' OR 1=1 --",
      categoryId: 2,
      departmentId: 10,
      status: 'Assigned',
      priority: 'Critical',
      from: '2026-10-01',
      to: '2026-10-15',
    });
    expect(filters.where).not.toContain("' OR 1=1");
    expect(filters.where).toContain('c.anonymous=0 AND u.name LIKE ?');
    expect(filters.values).toContain("%' OR 1=1 --%");
    expect(filters.values.slice(-2)).toEqual([
      new Date('2026-09-30T18:30:00Z'),
      new Date('2026-10-15T18:30:00Z'),
    ]);
  });
  it('rejects malformed filter dates', () => {
    expect(() => complaintFilters(owner, { from: 'last Tuesday' })).toThrow(
      expect.objectContaining({ status: 422 }),
    );
  });
  it.each(['2026-02-30', '2026-04-31', '2026-99-01', '2026-10-00'])(
    'rejects nonexistent calendar date %s instead of normalizing or querying it',
    (from) => {
      expect(() => complaintFilters(owner, { from })).toThrow(
        expect.objectContaining({ status: 422 }),
      );
    },
  );
  it('hides anonymous identity from triage and officers while preserving it for the reporter', () => {
    const c = { ...joined(), anonymous: 1, confidential: 1 };
    expect(serializeComplaint(c, incharge).reporter).toBeNull();
    expect(serializeComplaint(c, officer).reporter).toBeNull();
    expect(serializeComplaint(c, owner).reporter).toEqual({
      id: 1,
      name: owner.name,
      email: owner.email,
    });
    expect(serializeComplaint({ ...c, anonymous: 0 }, officer).reporter?.name).toBe(owner.name);
  });
  it('normalizes resolved timestamps and numeric ratings', () => {
    expect(
      serializeComplaint(
        {
          ...joined(),
          resolved_at: '2026-10-16 11:00:00',
          escalated_at: '2026-10-16 10:30:00',
          rating: '5',
        },
        owner,
      ),
    ).toMatchObject({
      resolvedAt: '2026-10-16T11:00:00.000Z',
      escalatedAt: '2026-10-16T10:30:00.000Z',
      rating: 5,
    });
  });
  it('paginates with a capped page size and critical-first ordering', async () => {
    const result = await listComplaints(officer, { page: 2, pageSize: 1000 });
    expect(result).toMatchObject({ total: 1, page: 2, pageSize: 100 });
    expect(mocks.rows).toHaveBeenCalledWith(
      expect.stringContaining('ORDER BY c.priority DESC'),
      [10],
    );
  });
  it.each([admin, { ...officer, departmentId: 99 }, { ...owner, id: 99 }])(
    'denies complaint detail access before fetching child records',
    async (user) => {
      await expect(getComplaint(user, 42)).rejects.toMatchObject({ status: 404 });
      expect(mocks.rows).toHaveBeenCalledTimes(1);
    },
  );
  it('redacts identity-bearing attachment names only for anonymous operational views', async () => {
    current.anonymous = 1;
    current.confidential = 1;
    attachmentRows = [
      {
        id: 8,
        original_name: 'Reporter-private-proof.pdf',
        mime: 'application/pdf',
        size: 12,
        kind: 'report',
        created_at: current.created_at,
      },
    ];
    expect((await getComplaint(officer, 42)).attachments[0].name).toBe('Evidence 8.pdf');
    expect((await getComplaint(owner, 42)).attachments[0].name).toBe('Reporter-private-proof.pdf');
  });
  it('reads configured SLA values as JSON strings or driver objects, with defaults', async () => {
    expect(await slaHours('Medium')).toBe(72);
    mocks.rows.mockResolvedValueOnce([{ value_json: '{"Medium":48}' }]);
    expect(await slaHours('Medium')).toBe(48);
    mocks.rows.mockResolvedValueOnce([{ value_json: { High: 12 } }]);
    expect(await slaHours('High')).toBe(12);
  });
});
describe('atomic complaint submission', () => {
  it('restricts submission to reporter roles before saving files', async () => {
    await expect(createComplaint(incharge, input, [file()])).rejects.toMatchObject({ status: 403 });
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it('validates form and all file types before persisting files', async () => {
    await expect(createComplaint(owner, { ...input, description: 'short' })).rejects.toThrow();
    mocks.validate.mockImplementationOnce(() => {
      throw new Error('Invalid signature');
    });
    await expect(createComplaint(owner, input, [file()])).rejects.toThrow('Invalid signature');
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it('rejects more than five files before storage', async () => {
    await expect(
      createComplaint(
        owner,
        input,
        Array.from({ length: 6 }, () => file()),
      ),
    ).rejects.toMatchObject({ status: 422 });
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it('creates a Medium Submitted complaint and records uploaded evidence', async () => {
    const result = await createComplaint(owner, input, [file('evidence\u0000.png')]);
    expect(result.status).toBe('Submitted');
    expect(mocks.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO complaints'),
      expect.arrayContaining(['CMP-20261016-0001', 'Medium']),
      mocks.db,
    );
    expect(mocks.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO attachments'),
      [42, 'saved-image', 'local', 'image/png', 8, 'evidence.png', 'report'],
      mocks.db,
    );
    expect(mocks.notify).toHaveBeenCalledWith(
      mocks.db,
      expect.any(Object),
      'submitted',
      expect.any(String),
      'complaint:42:submitted',
    );
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it('assigns Critical submissions immediately and records both status events', async () => {
    Object.assign(category, { emergency: 1, confidential: 1, department_id: 10 });
    const result = await createComplaint(owner, { ...input, anonymous: true });
    expect(result).toMatchObject({
      status: 'Assigned',
      priority: 'Critical',
      departmentId: 10,
      anonymous: true,
    });
    const histories = mocks.execute.mock.calls
      .filter(([sql]) => sql.includes('INSERT INTO status_history'))
      .map(([, values]) => values);
    expect(histories).toEqual(
      expect.arrayContaining([
        [42, null, 'Submitted', 1, 'Student', 'Complaint submitted.'],
        [
          42,
          'Submitted',
          'Assigned',
          null,
          'System',
          'Critical complaint routed immediately, bypassing verification.',
        ],
      ]),
    );
    expect(mocks.notify).toHaveBeenCalledWith(
      mocks.db,
      expect.objectContaining({ department_id: 10 }),
      'critical',
      expect.any(String),
      'complaint:42:critical',
    );
  });
  it('cleans uploaded files after category or anonymity validation fails', async () => {
    await expect(
      createComplaint(owner, { ...input, anonymous: true }, [file()]),
    ).rejects.toMatchObject({ status: 422 });
    expect(mocks.remove).toHaveBeenCalledWith('saved-image', 'local');
  });
  it('cleans files when the category was deactivated before transaction validation', async () => {
    mocks.rows.mockResolvedValueOnce([]);
    await expect(createComplaint(owner, input, [file()])).rejects.toMatchObject({ status: 422 });
    expect(mocks.remove).toHaveBeenCalledWith('saved-image', 'local');
  });
  it('cleans private ImageKit uploads when the complaint transaction fails', async () => {
    mocks.save.mockResolvedValueOnce({ key: 'private-imagekit-key', driver: 'imagekit' });
    mocks.rows.mockResolvedValueOnce([]);
    await expect(createComplaint(owner, input, [file()])).rejects.toMatchObject({ status: 422 });
    expect(mocks.remove).toHaveBeenCalledWith('private-imagekit-key', 'imagekit');
  });
  it('cleans earlier files if a later storage write fails', async () => {
    mocks.save
      .mockResolvedValueOnce({ key: 'first', driver: 'local' })
      .mockRejectedValueOnce(new Error('Storage offline'));
    await expect(createComplaint(owner, input, [file(), file()])).rejects.toThrow(
      'Storage offline',
    );
    expect(mocks.remove).toHaveBeenCalledWith('first', 'local');
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it('cleans files if reference capacity is exhausted', async () => {
    sequence = 10000;
    await expect(createComplaint(owner, input, [file()])).rejects.toMatchObject({ status: 503 });
    expect(mocks.remove).toHaveBeenCalledWith('saved-image', 'local');
    expect(mocks.execute.mock.calls.some(([sql]) => sql.startsWith('INSERT INTO complaints'))).toBe(
      false,
    );
  });
});
describe('complaint actions', () => {
  it('rejects unauthorized actors and stale versions without mutation', async () => {
    await expect(
      actOnComplaint({ ...officer, departmentId: 99 }, 42, { action: 'start' }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      actOnComplaint(officer, 42, { action: 'start', version: 1 }),
    ).rejects.toMatchObject({ status: 409 });
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it.each([
    ['Submitted', incharge, { action: 'verify' }, 'Verified'],
    ['Submitted', incharge, { action: 'return', reason: 'Clarify the location' }, 'Returned'],
    ['Submitted', incharge, { action: 'reject', reason: 'Duplicate complaint' }, 'Rejected'],
    ['Verified', incharge, { action: 'assign', departmentId: 10 }, 'Assigned'],
    ['Assigned', officer, { action: 'start' }, 'In Progress'],
    ['Assigned', officer, { action: 'progress', note: 'Replacement ordered' }, 'Assigned'],
    [
      'Assigned',
      incharge,
      { action: 'escalate', reason: 'Additional oversight needed' },
      'Assigned',
    ],
  ] as const)('records %s action and keeps an audit history', (status, user, action, expected) => {
    current.status = status;
    return actOnComplaint(user, 42, action as ComplaintAction).then((result) => {
      expect(result.status).toBe(expected);
      expect(mocks.audit).toHaveBeenCalledWith(
        mocks.db,
        user.id,
        `complaint_${action.action}`,
        'complaint',
        42,
        expect.any(Object),
      );
      expect(
        mocks.execute.mock.calls.some(([sql]) => sql.startsWith('INSERT INTO status_history')),
      ).toBe(true);
    });
  });
  it('ends the resolution cycle when an officer resolves the issue', async () => {
    const result = await actOnComplaint(officer, 42, {
      action: 'resolve',
      summary: 'Replaced the damaged ceiling panel.',
    });
    expect(result.status).toBe('Resolved');
    expect(mocks.execute).toHaveBeenCalledWith(
      expect.stringContaining('SET resolved_at=?,ended_at=?'),
      [expect.any(Date), expect.any(Date), 10, 42, 1],
      mocks.db,
    );
    expect(mocks.notify).toHaveBeenCalledWith(
      mocks.db,
      expect.any(Object),
      'resolution',
      expect.any(String),
      'complaint:42:v3',
    );
  });
  it('recalculates changed priority from the existing cycle start', async () => {
    await actOnComplaint(incharge, 42, { action: 'priority', priority: 'High' });
    expect(mocks.execute).toHaveBeenCalledWith(
      expect.stringContaining('SET sla_hours=?,due_at=?'),
      [24, new Date('2026-10-17T10:00:00Z'), 42, 1],
      mocks.db,
    );
  });
  it('resubmits corrected text without resetting SLA or changing category', async () => {
    current.status = 'Returned';
    await actOnComplaint(owner, 42, {
      action: 'resubmit',
      description: 'The actual damage is in the north ceiling panel.',
      location: 'North classroom',
    });
    expect(mocks.execute).toHaveBeenCalledWith(
      'UPDATE complaints SET description=?,location=? WHERE id=?',
      ['The actual damage is in the north ceiling panel.', 'North classroom', 42],
      mocks.db,
    );
    expect(mocks.execute.mock.calls.some(([sql]) => sql.includes('UPDATE resolution_cycles'))).toBe(
      false,
    );
  });
  it('prevents changing category during resubmission', async () => {
    current.status = 'Returned';
    await expect(
      actOnComplaint(owner, 42, { action: 'resubmit', categoryId: 2 }),
    ).rejects.toMatchObject({ status: 422 });
  });
  it('opens a new SLA cycle and reroutes when the old department is inactive', async () => {
    Object.assign(current, { status: 'Resolved', resolved_at: '2026-10-16 11:00:00' });
    inactiveDepartments.add(10);
    category.department_id = 20;
    const result = await actOnComplaint(owner, 42, {
      action: 'reopen',
      reason: 'The repair did not hold',
    });
    expect(result).toMatchObject({ status: 'Assigned', departmentId: 20 });
    expect(mocks.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO resolution_cycles'),
      [42, 2, 20, expect.any(Date), 72, new Date('2026-10-19T12:00:00Z')],
      mocks.db,
    );
    expect(mocks.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO assignments'),
      [
        42,
        10,
        20,
        null,
        'System',
        'Previous department inactive; current category mapping used on reopening.',
      ],
      mocks.db,
    );
  });
});
describe('attachment and feedback boundaries', () => {
  it('requires at least one uploaded file', async () => {
    await expect(addAttachments(officer, 42, [], 'proof')).rejects.toMatchObject({ status: 422 });
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it('cleans new files after authorization fails', async () => {
    await expect(
      addAttachments({ ...officer, departmentId: 99 }, 42, [file()], 'proof'),
    ).rejects.toMatchObject({ status: 404 });
    expect(mocks.remove).toHaveBeenCalledWith('saved-image', 'local');
  });
  it('enforces five total files including proof', async () => {
    attachmentCount = 5;
    await expect(addAttachments(officer, 42, [file()], 'proof')).rejects.toMatchObject({
      status: 422,
    });
    expect(mocks.remove).toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it('allows assigned officers to add proof and returned reporters to add evidence', async () => {
    await addAttachments(officer, 42, [file()], 'proof');
    expect(mocks.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO attachments'),
      expect.arrayContaining(['proof']),
      mocks.db,
    );
    current.status = 'Returned';
    await addAttachments(owner, 42, [file()], 'report');
    expect(mocks.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO attachments'),
      expect.arrayContaining(['report']),
      mocks.db,
    );
  });
  it('denies new attachments after resolution and cleans stored bytes', async () => {
    current.status = 'Resolved';
    await expect(addAttachments(officer, 42, [file()], 'proof')).rejects.toMatchObject({
      status: 403,
    });
    expect(mocks.remove).toHaveBeenCalled();
  });
  it('restricts feedback to the resolved complaint owner', async () => {
    await expect(submitFeedback(officer, 42, { rating: 5, comment: '' })).rejects.toMatchObject({
      status: 404,
    });
    await expect(submitFeedback(owner, 42, { rating: 5, comment: '' })).rejects.toMatchObject({
      status: 409,
    });
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it('persists feedback once for its resolving department and preserves uniqueness', async () => {
    current.status = 'Resolved';
    await submitFeedback(owner, 42, { rating: 5, comment: 'Thank you' });
    expect(mocks.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO feedback'),
      [42, 1, 5, 'Thank you', 10],
      mocks.db,
    );
    const duplicate = Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' });
    mocks.execute.mockRejectedValueOnce(duplicate);
    await expect(submitFeedback(owner, 42, { rating: 1, comment: 'Changed' })).rejects.toBe(
      duplicate,
    );
  });
});
