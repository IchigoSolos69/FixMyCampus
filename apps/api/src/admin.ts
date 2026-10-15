import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { ROLES, SLA_HOURS } from '@fixmycampus/shared';
import { requireAuth, roles } from './auth.js';
import { userFromRow, publicUser } from './auth-service.js';
import { rows, execute, transaction, type DB } from './db.js';
import { audit } from './audit.js';
import { HttpError } from './errors.js';

const idSchema = z.coerce.number().int().positive();
const nameSchema = z.string().trim().min(2).max(160);
export const userEditSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    role: z.enum(ROLES).optional(),
    active: z.boolean().optional(),
    departmentId: z.number().int().positive().nullable().optional(),
  })
  .strict();
export function officerDepartment(
  role: string,
  requested: number | null | undefined,
  current: number | null,
): number | null {
  if (role !== 'Department Officer') {
    if (requested !== undefined && requested !== null)
      throw new HttpError(422, 'Only Department Officers may be assigned to a department.');
    return null;
  }
  const departmentId = requested === undefined ? current : requested;
  if (!departmentId)
    throw new HttpError(422, 'A Department Officer must belong to one active department.');
  return departmentId;
}
async function requireActiveDepartment(id: number, db: DB): Promise<void> {
  if (
    !(await rows('SELECT id FROM departments WHERE id=? AND active=1 FOR UPDATE', [id], db)).length
  )
    throw new HttpError(422, 'Choose an active department.');
}
export async function ensureDepartmentCanDeactivate(id: number, db: DB): Promise<void> {
  const [officers] = await rows(
    'SELECT COUNT(*) AS count FROM users WHERE department_id=? AND active=1',
    [id],
    db,
  );
  if (Number(officers.count))
    throw new HttpError(
      409,
      'Reassign or deactivate this department’s officers first.',
      'DEPARTMENT_IN_USE',
    );
  const [categories] = await rows(
    'SELECT COUNT(*) AS count FROM categories WHERE department_id=?',
    [id],
    db,
  );
  if (Number(categories.count))
    throw new HttpError(
      409,
      'Move every category mapping to another active department first.',
      'DEPARTMENT_IN_USE',
    );
  const [complaints] = await rows(
    "SELECT COUNT(*) AS count FROM complaints WHERE department_id=? AND status NOT IN ('Resolved','Rejected')",
    [id],
    db,
  );
  if (Number(complaints.count))
    throw new HttpError(
      409,
      'Ask the Campus Incharge to reassign this department’s open complaints first.',
      'DEPARTMENT_IN_USE',
    );
}
export const adminRouter = Router();
adminRouter.use(requireAuth, roles('Administrator'));
adminRouter.get('/users', async (req, res) => {
  const query = z
    .object({
      q: z.string().trim().max(200).default(''),
      role: z.enum(ROLES).optional(),
      page: z.coerce.number().int().min(1).max(1000000).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(20),
    })
    .parse(req.query);
  const pattern = `%${query.q}%`;
  const offset = (query.page - 1) * query.pageSize;
  const clauses: string[] = [];
  const values: unknown[] = [];
  if (query.q) {
    clauses.push('(u.name LIKE ? OR u.email LIKE ?)');
    values.push(pattern, pattern);
  }
  if (query.role) {
    clauses.push('u.role=?');
    values.push(query.role);
  }
  const filter = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const [count] = await rows(`SELECT COUNT(*) AS count FROM users u ${filter}`, values);
  // Validated numeric literals avoid MySQL prepared LIMIT incompatibilities.
  const users = await rows(
    `SELECT u.*,d.name AS department_name FROM users u LEFT JOIN departments d ON d.id=u.department_id ${filter} ORDER BY u.created_at DESC,u.id DESC LIMIT ${query.pageSize} OFFSET ${offset}`,
    values,
  );
  res.json({
    items: users.map((user) => publicUser(userFromRow(user))),
    total: Number(count.count),
    page: query.page,
    pageSize: query.pageSize,
  });
});
adminRouter.patch('/users/:id', async (req, res) => {
  const id = idSchema.parse(req.params.id);
  const input = userEditSchema.parse(req.body);
  const user = await transaction(async (db) => {
    // Lock the administrator set before the target to protect the last-admin invariant.
    const admins = await rows(
      "SELECT id FROM users WHERE role='Administrator' AND active=1 AND email_verified=1 ORDER BY id FOR UPDATE",
      [],
      db,
    );
    const [current] = await rows('SELECT * FROM users WHERE id=? FOR UPDATE', [id], db);
    if (!current) throw new HttpError(404, 'This user was not found.');
    const role = input.role ?? current.role;
    const active = input.active ?? Boolean(current.active);
    if (
      active &&
      !current.email_verified &&
      ['Administrator', 'Campus Incharge', 'Department Officer'].includes(role)
    )
      throw new HttpError(
        422,
        'This user must verify their institutional e-mail before receiving an operational role.',
      );
    const departmentId = officerDepartment(
      role,
      input.departmentId,
      current.department_id === null ? null : Number(current.department_id),
    );
    if (departmentId) await requireActiveDepartment(departmentId, db);
    if (
      current.role === 'Administrator' &&
      current.active &&
      current.email_verified &&
      (role !== 'Administrator' || !active) &&
      admins.length <= 1
    )
      throw new HttpError(
        409,
        'Keep at least one active Administrator account.',
        'LAST_ADMINISTRATOR',
      );
    const securityChanged =
      role !== current.role ||
      active !== Boolean(current.active) ||
      departmentId !== current.department_id;
    await execute(
      'UPDATE users SET name=?,role=?,active=?,department_id=?,auth_version=auth_version+? WHERE id=?',
      [input.name ?? current.name, role, active ? 1 : 0, departmentId, securityChanged ? 1 : 0, id],
      db,
    );
    await audit(db, req.user!.id, 'admin.user_updated', 'user', id, {
      fields: Object.keys(input),
      role,
      active,
      departmentId,
    });
    const [updated] = await rows(
      'SELECT u.*,d.name AS department_name FROM users u LEFT JOIN departments d ON d.id=u.department_id WHERE u.id=?',
      [id],
      db,
    );
    return publicUser(userFromRow(updated));
  });
  res.json(user);
});
adminRouter.get('/departments', async (_req, res) => {
  const departments = await rows('SELECT * FROM departments ORDER BY name');
  res.json({
    items: departments.map((d) => ({ id: Number(d.id), name: d.name, active: Boolean(d.active) })),
  });
});
adminRouter.post('/departments', async (req, res) => {
  const { name } = z.object({ name: nameSchema }).strict().parse(req.body);
  const department = await transaction(async (db) => {
    const result = await execute('INSERT INTO departments (name,active) VALUES (?,1)', [name], db);
    await audit(db, req.user!.id, 'admin.department_created', 'department', result.insertId, {
      name,
    });
    return { id: result.insertId, name, active: true };
  });
  res.status(201).json(department);
});
adminRouter.patch('/departments/:id', async (req, res) => {
  const id = idSchema.parse(req.params.id);
  const input = z
    .object({ name: nameSchema.optional(), active: z.boolean().optional() })
    .strict()
    .parse(req.body);
  const department = await transaction(async (db) => {
    const [current] = await rows('SELECT * FROM departments WHERE id=? FOR UPDATE', [id], db);
    if (!current) throw new HttpError(404, 'This department was not found.');
    const active = input.active ?? Boolean(current.active);
    if (!active && current.active) await ensureDepartmentCanDeactivate(id, db);
    const name = input.name ?? current.name;
    await execute(
      'UPDATE departments SET name=?,active=? WHERE id=?',
      [name, active ? 1 : 0, id],
      db,
    );
    await audit(db, req.user!.id, 'admin.department_updated', 'department', id, input);
    return { id, name, active };
  });
  res.json(department);
});
function categoryFromRow(category: Record<string, any>) {
  return {
    id: Number(category.id),
    code: category.code,
    name: category.name,
    departmentId: Number(category.department_id),
    departmentName: category.department_name,
    active: Boolean(category.active),
    confidential: Boolean(category.confidential),
    emergency: Boolean(category.emergency),
  };
}
adminRouter.get('/categories', async (_req, res) => {
  res.json({
    items: (
      await rows(
        'SELECT c.*,d.name AS department_name FROM categories c JOIN departments d ON d.id=c.department_id ORDER BY c.name',
      )
    ).map(categoryFromRow),
  });
});
adminRouter.post('/categories', async (req, res) => {
  const input = z.object({ name: nameSchema, departmentId: idSchema }).strict().parse(req.body);
  const category = await transaction(async (db) => {
    await requireActiveDepartment(input.departmentId, db);
    const code = `CUSTOM_${randomBytes(8).toString('hex').toUpperCase()}`;
    const result = await execute(
      'INSERT INTO categories (code,name,department_id,confidential,emergency,active) VALUES (?,?,?,0,0,1)',
      [code, input.name, input.departmentId],
      db,
    );
    await audit(db, req.user!.id, 'admin.category_created', 'category', result.insertId, input);
    const [created] = await rows(
      'SELECT c.*,d.name AS department_name FROM categories c JOIN departments d ON d.id=c.department_id WHERE c.id=?',
      [result.insertId],
      db,
    );
    return categoryFromRow(created);
  });
  res.status(201).json(category);
});
adminRouter.patch('/categories/:id', async (req, res) => {
  const id = idSchema.parse(req.params.id);
  const input = z
    .object({
      name: nameSchema.optional(),
      departmentId: idSchema.optional(),
      active: z.boolean().optional(),
    })
    .strict()
    .parse(req.body);
  const category = await transaction(async (db) => {
    const [current] = await rows('SELECT * FROM categories WHERE id=? FOR UPDATE', [id], db);
    if (!current) throw new HttpError(404, 'This category was not found.');
    const departmentId = input.departmentId ?? Number(current.department_id);
    await requireActiveDepartment(departmentId, db);
    await execute(
      'UPDATE categories SET name=?,department_id=?,active=? WHERE id=?',
      [
        input.name ?? current.name,
        departmentId,
        input.active === undefined ? current.active : input.active ? 1 : 0,
        id,
      ],
      db,
    );
    await audit(db, req.user!.id, 'admin.category_updated', 'category', id, input);
    const [updated] = await rows(
      'SELECT c.*,d.name AS department_name FROM categories c JOIN departments d ON d.id=c.department_id WHERE c.id=?',
      [id],
      db,
    );
    return categoryFromRow(updated);
  });
  res.json(category);
});
const slaValue = z.number().int().min(1).max(8760);
export const settingsSchema = z
  .object({
    sla: z.object({ Low: slaValue, Medium: slaValue, High: slaValue, Critical: slaValue }).strict(),
    emailTemplates: z
      .array(
        z
          .object({
            event: z.string().min(1).max(80),
            subject: z.string().trim().min(1).max(200),
            body: z.string().trim().min(1).max(10000),
          })
          .strict(),
      )
      .max(50),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.emailTemplates.map((t) => t.event)).size !== value.emailTemplates.length)
      ctx.addIssue({
        code: 'custom',
        path: ['emailTemplates'],
        message: 'Each e-mail event must appear only once.',
      });
  });
async function getSettings() {
  const [setting] = await rows("SELECT value_json FROM settings WHERE key_name='sla'");
  return {
    sla: setting
      ? typeof setting.value_json === 'string'
        ? JSON.parse(setting.value_json)
        : setting.value_json
      : SLA_HOURS,
    emailTemplates: await rows('SELECT event,subject,body FROM email_templates ORDER BY event'),
  };
}
adminRouter.get('/settings', async (_req, res) => {
  res.json(await getSettings());
});
adminRouter.put('/settings', async (req, res) => {
  const input = settingsSchema.parse(req.body);
  await transaction(async (db) => {
    const templates = await rows<{ event: string }>(
      'SELECT event FROM email_templates FOR UPDATE',
      [],
      db,
    );
    const known = new Set(templates.map((t) => t.event));
    if (input.emailTemplates.some((t) => !known.has(t.event)))
      throw new HttpError(422, 'Choose an existing e-mail template event.');
    await execute(
      "INSERT INTO settings (key_name,value_json) VALUES ('sla',?) ON DUPLICATE KEY UPDATE value_json=VALUES(value_json)",
      [JSON.stringify(input.sla)],
      db,
    );
    for (const template of input.emailTemplates)
      await execute(
        'UPDATE email_templates SET subject=?,body=? WHERE event=?',
        [template.subject, template.body, template.event],
        db,
      );
    await audit(db, req.user!.id, 'admin.settings_updated', 'settings', null, {
      sla: input.sla,
      templates: input.emailTemplates.map((t) => t.event),
    });
  });
  res.json(await getSettings());
});
