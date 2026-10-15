import { randomUUID } from 'node:crypto';
import nodemailer from 'nodemailer';
import { Router } from 'express';
import { type DB, execute, rows, transaction, iso } from './db.js';
import { config } from './config.js';
import { requireAuth } from './auth.js';
import { audit } from './audit.js';
export const DEFAULT_TEMPLATES = [
  {
    event: 'email_verification',
    subject: 'Verify your FixMyCampus account',
    body: 'Hello {{name}},\nVerify your account: {{url}}\nThis link expires in 24 hours.',
  },
  {
    event: 'password_reset',
    subject: 'Reset your FixMyCampus password',
    body: 'Hello {{name}},\nReset your password: {{url}}\nThis link expires in 30 minutes. If you did not request this, ignore this message.',
  },
  {
    event: 'account_locked',
    subject: 'FixMyCampus account temporarily locked',
    body: 'Hello {{name}},\nYour account is locked for 15 minutes after five failed login attempts. You can reset your password if needed.',
  },
  ...['verification', 'assignment', 'resolution', 'escalation', 'critical'].map((event) => ({
    event,
    subject: `FixMyCampus: ${event} — {{reference}}`,
    body: 'Hello {{name}},\n{{message}}\nOpen FixMyCampus: {{url}}',
  })),
];
export async function enqueueMail(
  db: DB,
  userId: number,
  event: string,
  variables: Record<string, unknown>,
  uniqueKey: string = randomUUID(),
) {
  await execute(
    'INSERT IGNORE INTO email_outbox (user_id,event,variables,event_key) VALUES (?,?,?,?)',
    [userId, event, JSON.stringify(variables), uniqueKey],
    db,
  );
}
export async function notify(
  db: DB,
  userId: number,
  complaintId: number | null,
  title: string,
  body: string,
  key: string,
  event?: string,
  reference?: string,
) {
  await execute(
    'INSERT IGNORE INTO notifications (user_id,complaint_id,title,body,event_key) VALUES (?,?,?,?,?)',
    [userId, complaintId, title, body, key],
    db,
  );
  if (event)
    await enqueueMail(
      db,
      userId,
      event,
      {
        message: body,
        reference: reference || '',
        url: `${config.appUrl}${complaintId ? `/complaints/${complaintId}` : '/dashboard'}`,
      },
      key,
    );
}
export async function notifyComplaint(db: DB, c: any, event: string, message: string, key: string) {
  const recipients = new Map<number, string>();
  recipients.set(Number(c.reporter_id), 'reporter');
  if (['assignment', 'critical', 'escalation'].includes(event)) {
    for (const u of await rows<any>(
      "SELECT id,role FROM users WHERE active=1 AND (role='Campus Incharge' OR (role='Department Officer' AND department_id=?) OR (?='escalation' AND role='Administrator'))",
      [c.department_id, event],
      db,
    ))
      recipients.set(Number(u.id), u.role);
  }
  for (const [id, role] of recipients) {
    const redacted = role === 'Administrator' && Boolean(c.confidential);
    await notify(
      db,
      id,
      redacted ? null : Number(c.id),
      `${c.reference}: ${event}`,
      message,
      `${key}:${id}`,
      ['verification', 'assignment', 'resolution', 'escalation', 'critical'].includes(event)
        ? event
        : undefined,
      c.reference,
    );
  }
}
export function renderTemplate(template: string, variables: Record<string, unknown>) {
  return template.replace(/\{\{\s*([a-zA-Z]+)\s*\}\}/g, (_all, key) =>
    String(variables[key] ?? ''),
  );
}
const transport = nodemailer.createTransport({
  host: config.smtp.host,
  port: config.smtp.port,
  secure: config.smtp.secure,
  requireTLS: config.production,
  auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.password } : undefined,
  connectionTimeout: 10000,
  socketTimeout: 15000,
});
let mailing = false;
export async function deliverOutbox() {
  if (mailing) return;
  mailing = true;
  try {
    for (let i = 0; i < 20; i++) {
      const item = await transaction(async (db) => {
        const [row] = await rows<any>(
          "SELECT o.*,u.email,u.name FROM email_outbox o JOIN users u ON u.id=o.user_id WHERE o.sent_at IS NULL AND o.available_at<=UTC_TIMESTAMP(3) AND (o.locked_until IS NULL OR o.locked_until<UTC_TIMESTAMP(3)) ORDER BY (o.event='critical') DESC,o.id LIMIT 1 FOR UPDATE SKIP LOCKED",
          [],
          db,
        );
        if (row)
          await execute(
            'UPDATE email_outbox SET locked_until=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 60 SECOND),attempts=attempts+1 WHERE id=?',
            [row.id],
            db,
          );
        return row;
      });
      if (!item) break;
      try {
        const [template] = await rows<any>(
          'SELECT subject,body FROM email_templates WHERE event=?',
          [item.event],
        );
        const vars = {
          name: item.name,
          email: item.email,
          ...(typeof item.variables === 'string' ? JSON.parse(item.variables) : item.variables),
        };
        const fallback = DEFAULT_TEMPLATES.find((t) => t.event === item.event) || {
          subject: 'FixMyCampus update',
          body: '{{message}} {{url}}',
        };
        await transport.sendMail({
          from: config.smtp.from,
          to: item.email,
          subject: renderTemplate(template?.subject || fallback.subject, vars),
          text: renderTemplate(template?.body || fallback.body, vars),
          messageId: `<${item.event_key.replace(/[^a-zA-Z0-9-]/g, '-')}@fixmycampus.local>`,
        });
        await execute(
          'UPDATE email_outbox SET sent_at=UTC_TIMESTAMP(3),locked_until=NULL,last_error=NULL WHERE id=?',
          [item.id],
        );
      } catch (error) {
        await execute(
          'UPDATE email_outbox SET locked_until=NULL,available_at=?,last_error=? WHERE id=?',
          [
            new Date(Date.now() + Math.min(3600, 2 ** Math.min(item.attempts + 1, 10) * 10) * 1000),
            String((error as Error).message).slice(0, 500),
            item.id,
          ],
        );
      }
    }
  } finally {
    mailing = false;
  }
}
export async function scanSla() {
  let batchSize = 0;
  do {
    const due = await rows<any>(
      "SELECT r.id,r.complaint_id FROM resolution_cycles r JOIN complaints c ON c.id=r.complaint_id WHERE r.ended_at IS NULL AND r.escalated_at IS NULL AND r.due_at<UTC_TIMESTAMP(3) AND c.status NOT IN ('Resolved','Rejected') LIMIT 100",
    );
    batchSize = due.length;
    for (const item of due)
      await transaction(async (db) => {
        const [c] = await rows<any>(
          'SELECT * FROM complaints WHERE id=? FOR UPDATE',
          [item.complaint_id],
          db,
        );
        if (!c || ['Resolved', 'Rejected'].includes(c.status)) return;
        const [cycle] = await rows<any>(
          'SELECT * FROM resolution_cycles WHERE id=? FOR UPDATE',
          [item.id],
          db,
        );
        if (
          !cycle ||
          cycle.escalated_at ||
          cycle.ended_at ||
          new Date(iso(cycle.due_at)).getTime() >= Date.now()
        )
          return;
        await execute(
          'UPDATE resolution_cycles SET escalated_at=UTC_TIMESTAMP(3) WHERE id=?',
          [cycle.id],
          db,
        );
        await notifyComplaint(
          db,
          c,
          'escalation',
          `The resolution deadline for ${c.reference} has been exceeded.`,
          `sla:${cycle.id}`,
        );
        await audit(db, null, 'sla_escalated', 'complaint', c.id, { cycle: cycle.cycle_number });
      });
  } while (batchSize === 100);
}
export function startJobs() {
  let scanning = false;
  const safely = (fn: () => Promise<unknown>) =>
    void fn().catch((e) =>
      console.error(JSON.stringify({ event: 'job_failed', message: e.message })),
    );
  const mail = setInterval(() => safely(deliverOutbox), 5000);
  const sla = setInterval(() => {
    if (scanning) return;
    scanning = true;
    safely(async () => {
      try {
        await scanSla();
      } finally {
        scanning = false;
      }
    });
  }, 60000);
  mail.unref();
  sla.unref();
  safely(deliverOutbox);
  safely(scanSla);
  return () => {
    clearInterval(mail);
    clearInterval(sla);
  };
}
export const notificationRouter = Router();
notificationRouter.use(requireAuth);
notificationRouter.get('/', async (req, res) => {
  const items = await rows<any>(
    'SELECT id,title,body,complaint_id,read_at,created_at FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 100',
    [req.user!.id],
  );
  const [count] = await rows<any>(
    'SELECT COUNT(*) count FROM notifications WHERE user_id=? AND read_at IS NULL',
    [req.user!.id],
  );
  res.json({
    items: items.map((n) => ({
      id: n.id,
      title: n.title,
      body: n.body,
      complaintId: n.complaint_id,
      readAt: n.read_at ? iso(n.read_at) : null,
      createdAt: iso(n.created_at),
    })),
    unread: Number(count.count),
  });
});
notificationRouter.post('/read', async (req, res) => {
  const id = req.body.id;
  if (id !== undefined && (!Number.isInteger(id) || id < 1)) {
    res
      .status(422)
      .json({ error: { code: 'VALIDATION_ERROR', message: 'Choose a valid notification.' } });
    return;
  }
  await execute(
    `UPDATE notifications SET read_at=COALESCE(read_at,UTC_TIMESTAMP(3)) WHERE user_id=?${id !== undefined ? ' AND id=?' : ''}`,
    [req.user!.id, ...(id !== undefined ? [id] : [])],
  );
  res.json({ ok: true });
});
