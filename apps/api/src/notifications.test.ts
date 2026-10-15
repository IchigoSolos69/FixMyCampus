import { beforeEach, describe, expect, it, vi } from 'vitest';
const { mockRows, mockExecute, sendMail } = vi.hoisted(() => ({
  mockRows: vi.fn(),
  mockExecute: vi.fn(),
  sendMail: vi.fn(),
}));
vi.mock('./db.js', () => ({
  rows: mockRows,
  execute: mockExecute,
  transaction: (fn: any) => fn({}),
  iso: (v: string) => new Date(v).toISOString(),
}));
vi.mock('./auth.js', () => ({ requireAuth: (_req: any, _res: any, next: any) => next() }));
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail }) } }));
import {
  enqueueMail,
  notify,
  notifyComplaint,
  renderTemplate,
  deliverOutbox,
  scanSla,
} from './notifications.js';
beforeEach(() => {
  vi.clearAllMocks();
  mockExecute.mockResolvedValue({});
  mockRows.mockResolvedValue([]);
  sendMail.mockResolvedValue({});
});
describe('transactional notifications', () => {
  it('renders only named placeholders without interpreting HTML or code', () => {
    expect(
      renderTemplate('Hello {{ name }} {{url}} {{missing}}', {
        name: 'A < B',
        url: 'http://local',
      }),
    ).toBe('Hello A < B http://local ');
  });
  it('uses idempotent outbox keys and preserves transaction connection', async () => {
    const db = {} as any;
    await enqueueMail(db, 2, 'assignment', { reference: 'CMP' }, 'event:2');
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT IGNORE'),
      [2, 'assignment', '{"reference":"CMP"}', 'event:2'],
      db,
    );
  });
  it('creates an in-app event without unnecessarily sending email', async () => {
    await notify({} as any, 1, 3, 'Submitted', 'Saved', 'key');
    expect(mockExecute).toHaveBeenCalledTimes(1);
    await notify({} as any, 1, 3, 'Assigned', 'Routed', 'key2', 'assignment', 'CMP');
    expect(mockExecute).toHaveBeenCalledTimes(3);
  });
  it('redacts confidential admin links while notifying active operational recipients', async () => {
    mockRows.mockResolvedValue([
      { id: 2, role: 'Campus Incharge' },
      { id: 3, role: 'Department Officer' },
      { id: 4, role: 'Administrator' },
    ]);
    await notifyComplaint(
      {} as any,
      { id: 7, reporter_id: 1, reference: 'CMP', department_id: 8, confidential: 1 },
      'escalation',
      'Deadline exceeded.',
      'cycle:7',
    );
    const inserts = mockExecute.mock.calls.filter(([sql]) =>
      sql.includes('INSERT IGNORE INTO notifications'),
    );
    expect(inserts).toHaveLength(4);
    expect(inserts.find(([, values]) => values[0] === 4)?.[1][1]).toBeNull();
    expect(inserts.find(([, values]) => values[0] === 3)?.[1][1]).toBe(7);
  });
  it('sends queued email and marks it delivered', async () => {
    mockRows
      .mockResolvedValueOnce([
        {
          id: 1,
          user_id: 1,
          email: 'a@campus.test',
          name: 'A',
          event: 'assignment',
          variables: '{"message":"Assigned","reference":"CMP"}',
          event_key: 'event:1',
          attempts: 0,
        },
      ])
      .mockResolvedValueOnce([
        { subject: 'Update {{reference}}', body: 'Hello {{name}}: {{message}}' },
      ])
      .mockResolvedValueOnce([]);
    await deliverOutbox();
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'a@campus.test',
        subject: 'Update CMP',
        text: 'Hello A: Assigned',
      }),
    );
    expect(mockExecute.mock.calls.some(([sql]) => sql.includes('sent_at=UTC_TIMESTAMP'))).toBe(
      true,
    );
  });
  it('retries SMTP failure with backoff and keeps successful domain changes intact', async () => {
    mockRows
      .mockResolvedValueOnce([
        {
          id: 1,
          email: 'a@campus.test',
          name: 'A',
          event: 'unknown',
          variables: { message: 'Saved' },
          event_key: 'event1',
          attempts: 2,
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    sendMail.mockRejectedValue(new Error('SMTP unavailable'));
    await deliverOutbox();
    const retry = mockExecute.mock.calls.find(([sql]) => sql.includes('last_error=?'));
    expect(retry?.[1][1]).toBe('SMTP unavailable');
    expect(retry?.[1][0].getTime()).toBeGreaterThan(Date.now());
  });
  it('escalates one overdue active cycle and writes an immutable audit event', async () => {
    mockRows
      .mockResolvedValueOnce([{ id: 1, complaint_id: 7 }])
      .mockResolvedValueOnce([
        {
          id: 7,
          status: 'Assigned',
          reporter_id: 1,
          reference: 'CMP',
          department_id: 2,
          confidential: 0,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 1,
          due_at: '2026-01-01T00:00:00Z',
          cycle_number: 1,
          escalated_at: null,
          ended_at: null,
        },
      ])
      .mockResolvedValueOnce([]);
    await scanSla();
    expect(mockExecute.mock.calls.some(([sql]) => sql.includes('SET escalated_at='))).toBe(true);
    expect(mockExecute.mock.calls.some(([, params]) => params.includes('sla_escalated'))).toBe(
      true,
    );
  });
  it('ignores cycles changed after selection, including extended deadlines', async () => {
    for (const cycle of [
      { escalated_at: '2026-01-01', due_at: '2020-01-01' },
      { ended_at: '2026-01-01', due_at: '2020-01-01' },
      { due_at: '2099-01-01T00:00:00Z' },
    ]) {
      mockRows
        .mockResolvedValueOnce([{ id: 1, complaint_id: 7 }])
        .mockResolvedValueOnce([{ id: 7, status: 'Assigned' }])
        .mockResolvedValueOnce([cycle]);
      await scanSla();
    }
    expect(mockExecute).not.toHaveBeenCalled();
  });
});
