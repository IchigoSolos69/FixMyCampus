import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
const dbMocks = vi.hoisted(() => ({ rows: vi.fn(), execute: vi.fn(), transaction: vi.fn() }));
vi.mock('./db.js', () => ({ ...dbMocks }));
vi.mock('./audit.js', () => ({ audit: vi.fn() }));
vi.mock('./auth.js', () => ({
  requireAuth: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req.user = { id: 99 };
    next();
  },
  roles: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
import {
  officerDepartment,
  ensureDepartmentCanDeactivate,
  userEditSchema,
  settingsSchema,
  adminRouter,
} from './admin.js';
import type { DB } from './db.js';
import { errorHandler } from './errors.js';
beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.rows.mockReset();
  dbMocks.transaction.mockImplementation(async (fn: (db: unknown) => unknown) => fn({}));
});
describe('role and department invariants', () => {
  it('requires exactly one department for an officer and clears it for other roles', () => {
    expect(officerDepartment('Department Officer', undefined, 4)).toBe(4);
    expect(officerDepartment('Department Officer', 7, 4)).toBe(7);
    expect(() => officerDepartment('Department Officer', null, 4)).toThrow('one active department');
    expect(() => officerDepartment('Department Officer', undefined, null)).toThrow(
      'one active department',
    );
    expect(officerDepartment('Student', undefined, 4)).toBeNull();
    expect(() => officerDepartment('Administrator', 7, null)).toThrow('Only Department Officers');
  });
  it('rejects administrative edits to credentials and invalid roles through strict schemas', () => {
    expect(userEditSchema.safeParse({ password_hash: 'new-password' }).success).toBe(false);
    expect(userEditSchema.safeParse({ role: 'Super Admin' }).success).toBe(false);
    expect(userEditSchema.safeParse({ active: 'false' }).success).toBe(false);
  });
});
describe('department deactivation', () => {
  const db = {} as DB;
  it.each([
    [1, 0, 0, 'officers'],
    [0, 1, 0, 'category mapping'],
    [0, 0, 1, 'open complaints'],
  ] as const)(
    'blocks departments with dependent operational records (%s,%s,%s)',
    async (officers, categories, complaints, message) => {
      dbMocks.rows
        .mockResolvedValueOnce([{ count: officers }])
        .mockResolvedValueOnce([{ count: categories }])
        .mockResolvedValueOnce([{ count: complaints }]);
      await expect(ensureDepartmentCanDeactivate(3, db)).rejects.toMatchObject({
        status: 409,
        message: expect.stringContaining(message),
      });
    },
  );
  it('allows an unused department to deactivate', async () => {
    dbMocks.rows.mockResolvedValue([{ count: 0 }]);
    await expect(ensureDepartmentCanDeactivate(3, db)).resolves.toBeUndefined();
  });
});
describe('settings trust boundary', () => {
  const valid = {
    sla: { Low: 168, Medium: 72, High: 24, Critical: 24 },
    emailTemplates: [
      { event: 'assignment', subject: 'Assigned {{reference}}', body: 'Open {{url}}' },
    ],
  };
  it('accepts independently configured positive SLA values', () => {
    expect(settingsSchema.parse(valid).sla.Medium).toBe(72);
  });
  it('rejects missing priorities, zero deadlines, and duplicate e-mail events', () => {
    expect(settingsSchema.safeParse({ ...valid, sla: { ...valid.sla, Critical: 0 } }).success).toBe(
      false,
    );
    expect(settingsSchema.safeParse({ ...valid, sla: { Low: 168 } }).success).toBe(false);
    expect(
      settingsSchema.safeParse({
        ...valid,
        emailTemplates: [...valid.emailTemplates, ...valid.emailTemplates],
      }).success,
    ).toBe(false);
  });
});
async function adminRequest(path: string, body?: unknown) {
  const app = express();
  app.use(express.json());
  app.use('/admin', adminRouter);
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No listener');
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/admin${path}`, {
      method: body === undefined ? 'GET' : 'PATCH',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}
describe('administrative endpoint safeguards', () => {
  it('cannot promote an unverified account to an active operational role', async () => {
    dbMocks.rows.mockResolvedValueOnce([{ id: 99 }]).mockResolvedValueOnce([
      {
        id: 8,
        name: 'New Reporter',
        role: 'Student',
        active: 1,
        email_verified: 0,
        department_id: null,
      },
    ]);
    expect((await adminRequest('/users/8', { role: 'Administrator' })).status).toBe(422);
    expect(dbMocks.execute).not.toHaveBeenCalled();
  });
  it('counts only usable administrators when preventing a final demotion', async () => {
    dbMocks.rows.mockResolvedValueOnce([{ id: 99 }]).mockResolvedValueOnce([
      {
        id: 99,
        name: 'Administrator',
        role: 'Administrator',
        active: 1,
        email_verified: 1,
        department_id: null,
      },
    ]);
    expect((await adminRequest('/users/99', { role: 'Student' })).status).toBe(409);
    expect(dbMocks.rows).toHaveBeenCalledWith(
      expect.stringContaining('email_verified=1'),
      [],
      expect.anything(),
    );
    expect(dbMocks.execute).not.toHaveBeenCalled();
  });
  it('combines role and free-text filters without widening the requested role', async () => {
    dbMocks.rows.mockResolvedValueOnce([{ count: 0 }]).mockResolvedValueOnce([]);
    expect((await adminRequest('/users?q=Patil&role=Faculty')).status).toBe(200);
    expect(dbMocks.rows).toHaveBeenCalledWith(
      expect.stringContaining('(u.name LIKE ? OR u.email LIKE ?) AND u.role=?'),
      ['%Patil%', '%Patil%', 'Faculty'],
    );
  });
});
