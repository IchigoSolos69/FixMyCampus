import {
  type Complaint,
  type ComplaintDetail,
  type ComplaintAction,
  type User,
  type Priority,
  complaintSchema,
  SLA_HOURS,
  REPORTER_ROLES,
  MAX_FILES,
} from '@fixmycampus/shared';
import { type DB, rows, execute, transaction, iso } from './db.js';
import { HttpError } from './errors.js';
import { audit } from './audit.js';
import {
  nextStatus,
  canReadComplaint,
  referenceDate,
  deadline,
  istDateBoundary,
} from './workflow.js';
import { notifyComplaint, deliverOutbox } from './notifications.js';
import { validateFile, saveFile, removeFile, type StorageDriver } from './storage.js';

export const complaintSelect = `SELECT c.*,cat.name category_name,d.name department_name,u.name reporter_name,u.email reporter_email,r.due_at,r.escalated_at,f.rating FROM complaints c JOIN categories cat ON cat.id=c.category_id JOIN users u ON u.id=c.reporter_id LEFT JOIN departments d ON d.id=c.department_id JOIN resolution_cycles r ON r.complaint_id=c.id AND r.cycle_number=c.cycle_number LEFT JOIN feedback f ON f.complaint_id=c.id`;
export function complaintVisibility(user: User) {
  if (user.role === 'Campus Incharge') return { sql: '1=1', values: [] as unknown[] };
  if (user.role === 'Department Officer')
    return { sql: 'c.department_id=?', values: [user.departmentId] as unknown[] };
  if (REPORTER_ROLES.includes(user.role))
    return { sql: 'c.reporter_id=?', values: [user.id] as unknown[] };
  return { sql: '1=0', values: [] as unknown[] };
}
export function serializeComplaint(c: any, user: User): Complaint {
  const masked = Boolean(c.anonymous) && user.id !== Number(c.reporter_id);
  return {
    id: Number(c.id),
    reference: c.reference,
    categoryId: Number(c.category_id),
    categoryName: c.category_name,
    departmentId: c.department_id ? Number(c.department_id) : null,
    departmentName: c.department_name,
    status: c.status,
    priority: c.priority,
    description: c.description,
    location: c.location,
    anonymous: Boolean(c.anonymous),
    confidential: Boolean(c.confidential),
    emergency: Boolean(c.emergency),
    reporter: masked
      ? null
      : { id: Number(c.reporter_id), name: c.reporter_name, email: c.reporter_email },
    createdAt: iso(c.created_at),
    updatedAt: iso(c.updated_at),
    resolvedAt: c.resolved_at ? iso(c.resolved_at) : null,
    slaDueAt: iso(c.due_at),
    escalatedAt: c.escalated_at ? iso(c.escalated_at) : null,
    version: Number(c.version),
    resolutionSummary: c.resolution_summary,
    rating: c.rating === null ? null : Number(c.rating),
  };
}
export async function slaHours(priority: Priority, db?: DB) {
  const [setting] = await rows<any>("SELECT value_json FROM settings WHERE key_name='sla'", [], db);
  const v = setting
    ? typeof setting.value_json === 'string'
      ? JSON.parse(setting.value_json)
      : setting.value_json
    : SLA_HOURS;
  return Number(v[priority] || SLA_HOURS[priority]);
}
export function complaintFilters(user: User, query: Record<string, unknown>) {
  const visible = complaintVisibility(user);
  const clauses = ['c.deleted_at IS NULL', visible.sql];
  const values = visible.values;
  if (query.q) {
    const q = String(query.q).slice(0, 200);
    clauses.push(
      '(c.reference LIKE ? OR c.description LIKE ? OR (c.anonymous=0 AND u.name LIKE ?))',
    );
    values.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  for (const [field, column] of [
    ['categoryId', 'c.category_id'],
    ['departmentId', 'c.department_id'],
    ['status', 'c.status'],
    ['priority', 'c.priority'],
  ] as const)
    if (query[field]) {
      clauses.push(`${column}=?`);
      values.push(String(query[field]));
    }
  for (const [field, operator] of [
    ['from', '>='],
    ['to', '<'],
  ] as const)
    if (query[field]) {
      clauses.push(`c.created_at${operator}?`);
      values.push(istDateBoundary(query[field], field === 'to'));
    }
  return { where: clauses.join(' AND '), values };
}
export async function listComplaints(user: User, query: Record<string, unknown> = {}) {
  const page = Math.max(1, Math.min(100000, Number(query.page) || 1));
  const pageSize = Math.max(1, Math.min(100, Number(query.pageSize) || 20));
  const { where, values } = complaintFilters(user, query);
  const userJoin = query.q ? 'JOIN users u ON u.id=c.reporter_id' : '';
  const [count] = await rows<any>(
    `SELECT COUNT(*) total FROM complaints c ${userJoin} WHERE ${where}`,
    values,
  );
  // Select the page before loading evidence/actor joins, so queue reads touch only the requested rows.
  const items = await rows<any>(
    `${complaintSelect} JOIN (SELECT c.id FROM complaints c ${userJoin} WHERE ${where} ORDER BY c.priority DESC,c.created_at DESC,c.id DESC LIMIT ${Math.floor(pageSize)} OFFSET ${Math.floor((page - 1) * pageSize)}) page ON page.id=c.id ORDER BY c.priority DESC,c.created_at DESC,c.id DESC`,
    values,
  );
  return {
    items: items.map((c) => serializeComplaint(c, user)),
    total: Number(count.total),
    page,
    pageSize,
  };
}
export async function getComplaint(user: User, id: number, db?: DB): Promise<ComplaintDetail> {
  const [c] = await rows<any>(`${complaintSelect} WHERE c.id=? AND c.deleted_at IS NULL`, [id], db);
  if (!c || !canReadComplaint(user, c)) throw new HttpError(404, 'Complaint not found.');
  const history = await rows<any>(
    'SELECT id,from_status,to_status,actor_role,note,created_at FROM status_history WHERE complaint_id=? ORDER BY id',
    [id],
    db,
  );
  const notes = await rows<any>(
    'SELECT id,note,actor_role,created_at FROM progress_notes WHERE complaint_id=? ORDER BY id',
    [id],
    db,
  );
  const attachments = await rows<any>(
    'SELECT id,original_name,mime,size,kind,created_at FROM attachments WHERE complaint_id=? ORDER BY id',
    [id],
    db,
  );
  const assignments = await rows<any>(
    'SELECT a.id,d.name department_name,a.actor_role,a.reason,a.created_at FROM assignments a JOIN departments d ON d.id=a.department_id WHERE a.complaint_id=? ORDER BY a.id',
    [id],
    db,
  );
  const [feedback] = await rows<any>(
    'SELECT rating,comment,created_at FROM feedback WHERE complaint_id=?',
    [id],
    db,
  );
  const masked = Boolean(c.anonymous) && user.id !== Number(c.reporter_id);
  return {
    ...serializeComplaint(c, user),
    history: history.map((h) => ({
      id: Number(h.id),
      fromStatus: h.from_status,
      toStatus: h.to_status,
      actorRole: h.actor_role,
      note: h.note,
      createdAt: iso(h.created_at),
    })),
    notes: notes.map((n) => ({
      id: Number(n.id),
      note: n.note,
      actorRole: n.actor_role,
      createdAt: iso(n.created_at),
    })),
    attachments: attachments.map((a) => ({
      id: Number(a.id),
      name: masked
        ? `Evidence ${a.id}${a.mime === 'application/pdf' ? '.pdf' : a.mime === 'image/png' ? '.png' : '.jpg'}`
        : a.original_name,
      mime: a.mime,
      size: Number(a.size),
      kind: a.kind,
      createdAt: iso(a.created_at),
    })),
    assignments: assignments.map((a) => ({
      id: Number(a.id),
      departmentName: a.department_name,
      actorRole: a.actor_role,
      reason: a.reason,
      createdAt: iso(a.created_at),
    })),
    feedback: feedback
      ? {
          rating: Number(feedback.rating),
          comment: feedback.comment,
          createdAt: iso(feedback.created_at),
        }
      : null,
  };
}
type SavedFile = {
  key: string;
  driver: StorageDriver;
  file: Express.Multer.File;
  mime: string;
};
async function prepareFiles(files: Express.Multer.File[]): Promise<SavedFile[]> {
  if (files.length > MAX_FILES)
    throw new HttpError(422, 'At most five files are allowed per complaint.');
  const validated = files.map((file) => ({ file, mime: validateFile(file) }));
  const saved: SavedFile[] = [];
  try {
    for (const v of validated) saved.push({ ...(await saveFile(v.file.buffer, v.mime)), ...v });
    return saved;
  } catch (error) {
    await cleanupFiles(saved);
    throw error;
  }
}
async function cleanupFiles(files: SavedFile[]) {
  await Promise.allSettled(files.map((f) => removeFile(f.key, f.driver)));
}
async function persistFiles(db: DB, id: number, files: SavedFile[], kind: 'report' | 'proof') {
  for (const f of files)
    await execute(
      'INSERT INTO attachments (complaint_id,storage_key,driver,mime,size,original_name,kind) VALUES (?,?,?,?,?,?,?)',
      [
        id,
        f.key,
        f.driver,
        f.mime,
        f.file.size,
        f.file.originalname.replace(/[\x00-\x1f]/g, '').slice(0, 255),
        kind,
      ],
      db,
    );
}
async function history(
  db: DB,
  id: number,
  from: string | null,
  to: string,
  user: User | null,
  note: string,
) {
  await execute(
    'INSERT INTO status_history (complaint_id,from_status,to_status,actor_id,actor_role,note) VALUES (?,?,?,?,?,?)',
    [id, from, to, user?.id || null, user?.role || 'System', note],
    db,
  );
}
async function assign(db: DB, c: any, departmentId: number, user: User | null, reason: string) {
  const [d] = await rows<any>(
    'SELECT id FROM departments WHERE id=? AND active=1',
    [departmentId],
    db,
  );
  if (!d) throw new HttpError(422, 'Choose an active department.');
  await execute(
    'INSERT INTO assignments (complaint_id,from_department_id,department_id,actor_id,actor_role,reason) VALUES (?,?,?,?,?,?)',
    [c.id, c.department_id, departmentId, user?.id || null, user?.role || 'System', reason],
    db,
  );
  await execute('UPDATE complaints SET department_id=? WHERE id=?', [departmentId, c.id], db);
  await execute(
    'UPDATE resolution_cycles SET department_id=? WHERE complaint_id=? AND cycle_number=?',
    [departmentId, c.id, c.cycle_number],
    db,
  );
  c.department_id = departmentId;
}
export async function createComplaint(
  user: User,
  body: unknown,
  files: Express.Multer.File[] = [],
) {
  if (!REPORTER_ROLES.includes(user.role))
    throw new HttpError(403, 'Only Student, Faculty and Staff accounts can report issues.');
  const data = complaintSchema.parse(body);
  const saved = await prepareFiles(files);
  let id: number;
  try {
    id = await transaction(async (db) => {
      const [cat] = await rows<any>(
        'SELECT cat.* FROM categories cat JOIN departments d ON d.id=cat.department_id WHERE cat.id=? AND cat.active=1 AND d.active=1 FOR SHARE',
        [data.categoryId],
        db,
      );
      if (!cat) throw new HttpError(422, 'Choose an active category.');
      if (data.anonymous && !cat.confidential)
        throw new HttpError(
          422,
          'Anonymous reporting is only available for Mental Health and Anti-Ragging.',
        );
      const now = new Date();
      const date = referenceDate(now);
      await execute(
        'INSERT INTO reference_sequences (date_key,last_number) VALUES (?,1) ON DUPLICATE KEY UPDATE last_number=last_number+1',
        [date],
        db,
      );
      const [seq] = await rows<any>(
        'SELECT last_number FROM reference_sequences WHERE date_key=? FOR UPDATE',
        [date],
        db,
      );
      if (seq.last_number > 9999)
        throw new HttpError(503, 'Daily reference capacity reached. Contact the Campus Incharge.');
      const reference = `CMP-${date}-${String(seq.last_number).padStart(4, '0')}`;
      const priority = cat.emergency ? 'Critical' : 'Medium';
      const hours = await slaHours(priority, db);
      const result = await execute(
        'INSERT INTO complaints (reference,reporter_id,category_id,description,location,anonymous,confidential,emergency,priority,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        [
          reference,
          user.id,
          cat.id,
          data.description,
          data.location,
          data.anonymous,
          cat.confidential,
          cat.emergency,
          priority,
          now,
          now,
        ],
        db,
      );
      const id = result.insertId;
      await execute(
        'INSERT INTO resolution_cycles (complaint_id,cycle_number,started_at,sla_hours,due_at) VALUES (?,1,?,?,?)',
        [id, now, hours, deadline(now, hours)],
        db,
      );
      await history(db, id, null, 'Submitted', user, 'Complaint submitted.');
      const c = {
        id,
        reference,
        reporter_id: user.id,
        department_id: null,
        confidential: cat.confidential,
        cycle_number: 1,
      };
      await notifyComplaint(
        db,
        c,
        'submitted',
        `${reference} has been submitted.`,
        `complaint:${id}:submitted`,
      );
      if (cat.emergency) {
        await assign(db, c, cat.department_id, null, 'Automatic emergency routing.');
        await execute("UPDATE complaints SET status='Assigned' WHERE id=?", [id], db);
        await history(
          db,
          id,
          'Submitted',
          'Assigned',
          null,
          'Critical complaint routed immediately, bypassing verification.',
        );
        await notifyComplaint(
          db,
          c,
          'critical',
          `${reference} requires immediate attention.`,
          `complaint:${id}:critical`,
        );
      }
      await persistFiles(db, id, saved, 'report');
      await audit(db, user.id, 'complaint_submitted', 'complaint', id, {
        anonymous: data.anonymous,
      });
      return id;
    });
  } catch (error) {
    await cleanupFiles(saved);
    throw error;
  }
  void deliverOutbox().catch(() => {});
  return getComplaint(user, id);
}
export async function actOnComplaint(user: User, id: number, action: ComplaintAction) {
  await transaction(async (db) => {
    const [c] = await rows<any>(
      'SELECT * FROM complaints WHERE id=? AND deleted_at IS NULL FOR UPDATE',
      [id],
      db,
    );
    if (!c || !canReadComplaint(user, c)) throw new HttpError(404, 'Complaint not found.');
    if (action.version !== undefined && action.version !== Number(c.version))
      throw new HttpError(409, 'The complaint changed. Refresh and try again.');
    const now = new Date();
    const to = nextStatus(c, user, action, now);
    let note = action.reason || action.note || action.summary || `${action.action} recorded.`;
    if (action.action === 'resubmit') {
      const data = complaintSchema.parse({
        categoryId: c.category_id,
        description: action.description ?? c.description,
        location: action.location ?? c.location,
        anonymous: c.anonymous,
      });
      if (action.categoryId !== undefined && action.categoryId !== c.category_id)
        throw new HttpError(422, 'The category cannot change after submission.');
      await execute(
        'UPDATE complaints SET description=?,location=? WHERE id=?',
        [data.description, data.location, id],
        db,
      );
    }
    if (action.action === 'assign')
      await assign(db, c, action.departmentId!, user, action.reason || 'Department assignment.');
    if (action.action === 'priority') {
      const hours = await slaHours(action.priority!, db);
      const [cycle] = await rows<any>(
        'SELECT started_at FROM resolution_cycles WHERE complaint_id=? AND cycle_number=?',
        [id, c.cycle_number],
        db,
      );
      await execute('UPDATE complaints SET priority=? WHERE id=?', [action.priority, id], db);
      await execute(
        'UPDATE resolution_cycles SET sla_hours=?,due_at=? WHERE complaint_id=? AND cycle_number=?',
        [hours, deadline(new Date(iso(cycle.started_at)), hours), id, c.cycle_number],
        db,
      );
      note = `Priority changed from ${c.priority} to ${action.priority}.`;
    }
    if (action.action === 'progress')
      await execute(
        'INSERT INTO progress_notes (complaint_id,actor_id,actor_role,note) VALUES (?,?,?,?)',
        [id, user.id, user.role, action.note],
        db,
      );
    if (action.action === 'resolve') {
      await execute(
        'UPDATE complaints SET resolution_summary=?,resolved_at=? WHERE id=?',
        [action.summary, now, id],
        db,
      );
      await execute(
        'UPDATE resolution_cycles SET resolved_at=?,ended_at=?,department_id=? WHERE complaint_id=? AND cycle_number=?',
        [now, now, c.department_id, id, c.cycle_number],
        db,
      );
    }
    if (action.action === 'reject')
      await execute(
        'UPDATE resolution_cycles SET ended_at=? WHERE complaint_id=? AND cycle_number=?',
        [now, id, c.cycle_number],
        db,
      );
    if (action.action === 'reopen') {
      const [dept] = await rows<any>(
        'SELECT id FROM departments WHERE id=? AND active=1',
        [c.department_id],
        db,
      );
      let departmentId = c.department_id;
      if (!dept) {
        const [cat] = await rows<any>(
          'SELECT department_id FROM categories WHERE id=?',
          [c.category_id],
          db,
        );
        departmentId = cat.department_id;
      }
      const hours = await slaHours(c.priority, db);
      c.cycle_number += 1;
      await execute(
        'UPDATE complaints SET cycle_number=?,resolved_at=NULL,resolution_summary=NULL WHERE id=?',
        [c.cycle_number, id],
        db,
      );
      await execute(
        'INSERT INTO resolution_cycles (complaint_id,cycle_number,department_id,started_at,sla_hours,due_at) VALUES (?,?,?,?,?,?)',
        [id, c.cycle_number, departmentId, now, hours, deadline(now, hours)],
        db,
      );
      if (!dept)
        await assign(
          db,
          c,
          departmentId,
          null,
          'Previous department inactive; current category mapping used on reopening.',
        );
    }
    if (action.action === 'escalate') {
      await execute(
        'UPDATE resolution_cycles SET escalated_at=COALESCE(escalated_at,?) WHERE complaint_id=? AND cycle_number=?',
        [now, id, c.cycle_number],
        db,
      );
      await notifyComplaint(
        db,
        c,
        'escalation',
        `${c.reference} has been escalated to campus oversight.`,
        `manual-escalation:${id}:${c.version}`,
      );
    }
    await execute(
      'UPDATE complaints SET status=?,version=version+1,updated_at=? WHERE id=?',
      [to, now, id],
      db,
    );
    await history(db, id, c.status, to, user, note);
    if (to !== c.status || action.action === 'assign') {
      const event =
        action.action === 'verify'
          ? 'verification'
          : action.action === 'resolve'
            ? 'resolution'
            : ['assign', 'reopen'].includes(action.action)
              ? 'assignment'
              : 'status';
      await notifyComplaint(
        db,
        c,
        event,
        `${c.reference} is now ${to}.`,
        `complaint:${id}:v${c.version + 1}`,
      );
    }
    await audit(db, user.id, `complaint_${action.action}`, 'complaint', id, {
      from: c.status,
      to,
      departmentId: c.department_id,
      priority: action.priority,
    });
  });
  void deliverOutbox().catch(() => {});
  return getComplaint(user, id);
}
export async function addAttachments(
  user: User,
  id: number,
  files: Express.Multer.File[],
  kind: 'report' | 'proof',
) {
  if (!files.length) throw new HttpError(422, 'Choose at least one file.');
  const saved = await prepareFiles(files);
  try {
    await transaction(async (db) => {
      const [c] = await rows<any>('SELECT * FROM complaints WHERE id=? FOR UPDATE', [id], db);
      if (!c || !canReadComplaint(user, c)) throw new HttpError(404, 'Complaint not found.');
      const own = user.id === Number(c.reporter_id) && c.status === 'Returned' && kind === 'report';
      const officer =
        user.role === 'Department Officer' &&
        user.departmentId === c.department_id &&
        ['Assigned', 'In Progress'].includes(c.status) &&
        kind === 'proof';
      if (!own && !officer) throw new HttpError(403, 'Files cannot be added in this state.');
      const [count] = await rows<any>(
        'SELECT COUNT(*) count FROM attachments WHERE complaint_id=?',
        [id],
        db,
      );
      if (Number(count.count) + saved.length > MAX_FILES)
        throw new HttpError(
          422,
          'A complaint can have at most five files, including completion proof.',
        );
      await persistFiles(db, id, saved, kind);
      await execute('UPDATE complaints SET version=version+1 WHERE id=?', [id], db);
      await audit(db, user.id, 'attachments_added', 'complaint', id, { count: saved.length, kind });
    });
  } catch (error) {
    await cleanupFiles(saved);
    throw error;
  }
  return getComplaint(user, id);
}
export async function submitFeedback(
  user: User,
  id: number,
  data: { rating: number; comment: string },
) {
  await transaction(async (db) => {
    const [c] = await rows<any>('SELECT * FROM complaints WHERE id=? FOR UPDATE', [id], db);
    if (!c || Number(c.reporter_id) !== user.id) throw new HttpError(404, 'Complaint not found.');
    if (c.status !== 'Resolved')
      throw new HttpError(409, 'Feedback is available after resolution.');
    await execute(
      'INSERT INTO feedback (complaint_id,reporter_id,rating,comment,department_id) VALUES (?,?,?,?,?)',
      [id, user.id, data.rating, data.comment, c.department_id],
      db,
    );
    await audit(db, user.id, 'feedback_submitted', 'complaint', id);
  });
  return getComplaint(user, id);
}
