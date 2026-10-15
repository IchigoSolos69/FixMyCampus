import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const uri = process.env.TEST_DATABASE_URL;
if (uri && !/test/i.test(decodeURIComponent(new URL(uri).pathname)))
  throw new Error('TEST_DATABASE_URL must name a separate disposable test database');
describe.skipIf(!uri)('Real MySQL API integration (dedicated TEST_DATABASE_URL)', () => {
  let server: Server;
  let base: string;
  let uploads: string;
  let db: typeof import('../apps/api/src/db.js');
  const tokens: Record<string, string> = {};
  let catalog: any;
  let complaint: any;
  let registeredEmail = '';
  const password = 'CampusDemo!2026';
  async function request(
    endpoint: string,
    role?: string,
    body?: unknown,
    method = body === undefined ? 'GET' : 'POST',
  ) {
    const response = await fetch(`${base}/api/v1${endpoint}`, {
      method,
      headers: {
        ...(role ? { Authorization: `Bearer ${tokens[role]}` } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  }
  async function action(role: string, actionName: string, fields = {}) {
    const response = await request(`/complaints/${complaint.id}/actions`, role, {
      action: actionName,
      ...fields,
    });
    if (response.status < 300) complaint = response.body;
    return response;
  }
  beforeAll(async () => {
    process.env.DATABASE_URL = uri;
    process.env.NODE_ENV = 'test';
    process.env.APP_URL = 'http://localhost:5173';
    uploads = await mkdtemp(path.join(tmpdir(), 'fixmycampus-test-'));
    process.env.UPLOADS_DIR = uploads;
    db = await import('../apps/api/src/db.js');
    const { migrate } = await import('../apps/api/src/migrate.js');
    const { seed } = await import('../apps/api/src/seed.js');
    await migrate();
    await seed();
    const { createApp } = await import('../apps/api/src/app.js');
    server = createApp().listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test listener');
    base = `http://127.0.0.1:${address.port}`;
    for (const [role, email] of Object.entries({
      student: 'student@campus.test',
      faculty: 'faculty@campus.test',
      incharge: 'incharge@campus.test',
      admin: 'admin@campus.test',
      civil: 'officer1@campus.test',
      it: 'officer4@campus.test',
      welfare: 'officer9@campus.test',
    })) {
      const result = await request('/auth/login', undefined, { email, password });
      expect(result.status).toBe(200);
      tokens[role] = result.body.accessToken;
    }
    catalog = (await request('/catalog', 'student')).body;
  });
  afterAll(async () => {
    if (server)
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    if (db) await db.pool.end();
    if (uploads) await rm(uploads, { recursive: true, force: true });
  });

  it('requires authentication, institutional domain, and valid fields', async () => {
    const [clock] = await db.rows<any>('SELECT @@session.time_zone zone');
    expect(clock.zone).toBe('+00:00');
    expect((await request('/complaints')).status).toBe(401);
    expect(
      (
        await request('/auth/register', undefined, {
          name: 'Outside User',
          email: `outside-${Date.now()}@example.com`,
          password,
        })
      ).status,
    ).toBe(422);
    const invalid = await request('/complaints', 'student', {
      categoryId: 0,
      location: '',
      description: 'short',
    });
    expect(invalid.status).toBe(422);
    expect(invalid.body.error.fields).toBeDefined();
    expect(
      catalog.categories.filter((category: any) => !category.code.startsWith('CUSTOM_')),
    ).toHaveLength(15);
    expect(catalog.departments.length).toBeGreaterThanOrEqual(11);
  });
  it('registers, blocks unverified login, and consumes verification once', async () => {
    const email = `integration-${Date.now()}@campus.test`;
    registeredEmail = email;
    expect(
      (
        await request('/auth/register', undefined, {
          name: 'Integration Reporter',
          email,
          password,
          role: 'Administrator',
        })
      ).status,
    ).toBe(201);
    expect((await request('/auth/login', undefined, { email, password })).status).toBe(403);
    const [record] = await db.rows<any>(
      'SELECT u.role,o.variables FROM users u JOIN email_outbox o ON o.user_id=u.id WHERE u.email=? AND o.event=? ORDER BY o.id DESC LIMIT 1',
      [email, 'email_verification'],
    );
    expect(record.role).toBe('Student');
    const variables =
      typeof record.variables === 'string' ? JSON.parse(record.variables) : record.variables;
    expect(
      (await request('/auth/verify-email', undefined, { token: variables.token })).status,
    ).toBe(200);
    expect(
      (await request('/auth/verify-email', undefined, { token: variables.token })).status,
    ).toBe(422);
    expect((await request('/auth/login', undefined, { email, password })).status).toBe(200);
  });
  it('locks failed logins, expires single-use reset links, and revokes old tokens', async () => {
    for (let attempt = 1; attempt <= 5; attempt++) {
      expect(
        (
          await request('/auth/login', undefined, {
            email: registeredEmail,
            password: 'wrong-password',
          })
        ).status,
      ).toBe(attempt === 5 ? 423 : 401);
    }
    expect(
      (await request('/auth/login', undefined, { email: registeredEmail, password })).status,
    ).toBe(423);
    const [account] = await db.rows<any>('SELECT id FROM users WHERE email=?', [registeredEmail]);
    expect(
      (
        await db.rows('SELECT id FROM email_outbox WHERE user_id=? AND event=?', [
          account.id,
          'account_locked',
        ])
      ).length,
    ).toBeGreaterThan(0);
    await db.execute(
      'UPDATE users SET locked_until=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 SECOND) WHERE id=?',
      [account.id],
    );
    const signedIn = await request('/auth/login', undefined, { email: registeredEmail, password });
    expect(signedIn.status).toBe(200);
    tokens.registered = signedIn.body.accessToken;
    await request('/auth/forgot-password', undefined, { email: registeredEmail });
    const latestReset = async () => {
      const [mail] = await db.rows<any>(
        'SELECT variables FROM email_outbox WHERE user_id=? AND event=? ORDER BY id DESC LIMIT 1',
        [account.id, 'password_reset'],
      );
      return typeof mail.variables === 'string' ? JSON.parse(mail.variables) : mail.variables;
    };
    const expired = await latestReset();
    await db.execute(
      "UPDATE auth_tokens SET expires_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 SECOND) WHERE user_id=? AND kind='reset'",
      [account.id],
    );
    expect(
      (
        await request('/auth/reset-password', undefined, {
          token: expired.token,
          password: 'ChangedDemo!2026',
        })
      ).status,
    ).toBe(422);
    await request('/auth/forgot-password', undefined, { email: registeredEmail });
    const valid = await latestReset();
    expect(
      (
        await request('/auth/reset-password', undefined, {
          token: valid.token,
          password: 'ChangedDemo!2026',
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await request('/auth/reset-password', undefined, {
          token: valid.token,
          password: 'ChangedDemo!2026',
        })
      ).status,
    ).toBe(422);
    expect((await request('/profile', 'registered')).status).toBe(401);
    const login = await request('/auth/login', undefined, {
      email: registeredEmail,
      password: 'ChangedDemo!2026',
    });
    expect(login.status).toBe(200);
    tokens.registered = login.body.accessToken;
  });
  it('audits profile changes, protects photo access, and checks the current password', async () => {
    const profile = await request(
      '/profile',
      'registered',
      { contactNumber: '5550100', affiliation: 'Integration hostel' },
      'PATCH',
    );
    expect(profile.status).toBe(200);
    expect(profile.body.contactNumber).toBe('5550100');
    expect(
      (await request('/profile', 'registered', { role: 'Administrator' }, 'PATCH')).status,
    ).toBe(422);
    const photo = new FormData();
    photo.append(
      'photo',
      new Blob([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' }),
      'profile.png',
    );
    expect(
      (
        await fetch(`${base}/api/v1/profile/photo`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${tokens.registered}` },
          body: photo,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await fetch(`${base}/api/v1/profile/photo`, {
          headers: { Authorization: `Bearer ${tokens.registered}` },
        })
      ).status,
    ).toBe(200);
    expect((await fetch(`${base}/api/v1/profile/photo`)).status).toBe(401);
    expect(
      (
        await request('/profile/password', 'registered', {
          currentPassword: 'incorrect',
          newPassword: 'AnotherDemo!2026',
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await request('/profile/password', 'registered', {
          currentPassword: 'ChangedDemo!2026',
          newPassword: 'AnotherDemo!2026',
        })
      ).status,
    ).toBe(200);
    expect((await request('/profile', 'registered')).status).toBe(401);
    const login = await request('/auth/login', undefined, {
      email: registeredEmail,
      password: 'AnotherDemo!2026',
    });
    expect(login.status).toBe(200);
    tokens.registered = login.body.accessToken;
    const events = await db.rows(
      'SELECT action FROM audit_events WHERE actor_id=? AND action IN (?,?,?)',
      [login.body.user.id, 'profile.updated', 'profile.photo_changed', 'profile.password_changed'],
    );
    expect(events).toHaveLength(3);
  });
  it('creates unique IST references concurrently with durable history/outbox', async () => {
    const category = catalog.categories.find((c: any) => c.code === 'CLASSROOM');
    const responses = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        request('/complaints', 'student', {
          categoryId: category.id,
          location: 'Integration classroom',
          description: `A broken classroom window requires repair, sample ${i}.`,
        }),
      ),
    );
    expect(responses.every((r) => r.status === 201)).toBe(true);
    expect(new Set(responses.map((r) => r.body.reference)).size).toBe(8);
    complaint = responses[0].body;
    expect(complaint.reference).toMatch(/^CMP-\d{8}-\d{4,}$/);
    expect(complaint.status).toBe('Submitted');
    expect(complaint.history).toHaveLength(1);
    expect(
      (await db.rows('SELECT id FROM resolution_cycles WHERE complaint_id=?', [complaint.id]))
        .length,
    ).toBe(1);
  });
  it('enforces triage, departments, resolution, reopening, and one feedback', async () => {
    expect((await request(`/complaints/${complaint.id}`, 'faculty')).status).toBe(404);
    expect((await action('student', 'verify')).status).toBe(403);
    expect(
      (await action('incharge', 'assign', { departmentId: catalog.departments[0].id })).status,
    ).toBe(409);
    expect((await action('incharge', 'return')).status).toBe(422);
    expect((await action('incharge', 'verify')).status).toBe(200);
    const civil = catalog.departments.find((d: any) => d.name === 'Civil Engineering');
    expect((await action('incharge', 'assign', { departmentId: civil.id })).status).toBe(200);
    expect((await action('it', 'start')).status).toBe(404);
    expect((await action('civil', 'start')).status).toBe(200);
    expect(
      (await action('civil', 'progress', { note: 'Replacement materials received.' })).status,
    ).toBe(200);
    expect((await action('civil', 'resolve', { summary: 'short' })).status).toBe(422);
    expect(
      (await action('civil', 'resolve', { summary: 'Window frame repaired and inspected.' }))
        .status,
    ).toBe(200);
    expect((await action('incharge', 'priority', { priority: 'High' })).status).toBe(409);
    expect(
      (
        await request(`/complaints/${complaint.id}/feedback`, 'student', {
          rating: 5,
          comment: 'Repair completed safely.',
        })
      ).status,
    ).toBe(201);
    const [feedback] = await db.rows<any>(
      'SELECT department_id FROM feedback WHERE complaint_id=?',
      [complaint.id],
    );
    expect(Number(feedback.department_id)).toBe(civil.id);
    expect(
      (await request(`/complaints/${complaint.id}/feedback`, 'student', { rating: 4, comment: '' }))
        .status,
    ).toBe(409);
    expect(
      (await action('student', 'reopen', { reason: 'The repaired frame remains loose.' })).status,
    ).toBe(200);
    expect(complaint.status).toBe('Assigned');
    expect(complaint.history.filter((h: any) => h.toStatus === 'Resolved')).toHaveLength(1);
    expect(
      (await db.rows('SELECT id FROM resolution_cycles WHERE complaint_id=?', [complaint.id]))
        .length,
    ).toBe(2);
    const it = catalog.departments.find((d: any) => d.name === 'Information Technology');
    expect(
      (
        await action('incharge', 'assign', {
          departmentId: it.id,
          reason: 'Second cycle needs a different specialist team.',
        })
      ).status,
    ).toBe(200);
    expect(
      (await action('it', 'resolve', { summary: 'Frame reinforced and checked again.' })).status,
    ).toBe(200);
    const [retained] = await db.rows<any>(
      'SELECT department_id FROM feedback WHERE complaint_id=?',
      [complaint.id],
    );
    expect(Number(retained.department_id)).toBe(civil.id);
    const dashboard = await request('/dashboard', 'admin');
    expect(dashboard.body.departments.find((d: any) => d.id === civil.id).averageRating).toBe(5);
    await db.execute(
      'UPDATE complaints SET resolved_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 73 HOUR) WHERE id=?',
      [complaint.id],
    );
    expect(
      (await action('student', 'reopen', { reason: 'A late follow-up request.' })).status,
    ).toBe(409);
  });
  it('routes critical anonymous reports and excludes private details from other roles', async () => {
    const mental = catalog.categories.find((c: any) => c.code === 'MENTAL_HEALTH');
    const result = await request('/complaints', 'student', {
      categoryId: mental.id,
      description: 'I would like confidential help from the welfare team.',
      location: 'Private consultation',
      anonymous: true,
    });
    expect(result.status).toBe(201);
    const item = result.body;
    expect(item.priority).toBe('Critical');
    expect(item.status).toBe('Assigned');
    const incharge = await request(`/complaints/${item.id}`, 'incharge');
    expect(incharge.body.reporter).toBeNull();
    expect((await request(`/complaints/${item.id}`, 'welfare')).body.reporter).toBeNull();
    expect((await request(`/complaints/${item.id}`, 'admin')).status).toBe(404);
    expect((await request(`/complaints/${item.id}`, 'it')).status).toBe(404);
    const search = await request(`/complaints?q=${encodeURIComponent(item.reference)}`, 'it');
    expect(search.body.items).toHaveLength(0);
    expect(
      (await db.rows('SELECT id FROM notifications WHERE complaint_id=?', [item.id])).length,
    ).toBeGreaterThanOrEqual(3);
  });
  it('protects private attachments and validates signatures/count', async () => {
    const category = catalog.categories.find((c: any) => c.code === 'CLASSROOM');
    const form = new FormData();
    form.append('categoryId', String(category.id));
    form.append('location', 'Attachment test');
    form.append('description', 'The test window frame needs a maintenance inspection.');
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    form.append('files', new Blob([png], { type: 'image/png' }), 'sample.png');
    const response = await fetch(`${base}/api/v1/complaints`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokens.student}` },
      body: form,
    });
    expect(response.status).toBe(201);
    const item = await response.json();
    expect(item.attachments).toHaveLength(1);
    const attachmentUrl = `${base}/api/v1/attachments/${item.attachments[0].id}`;
    expect(
      (await fetch(attachmentUrl, { headers: { Authorization: `Bearer ${tokens.student}` } }))
        .status,
    ).toBe(200);
    expect(
      (await fetch(attachmentUrl, { headers: { Authorization: `Bearer ${tokens.faculty}` } }))
        .status,
    ).toBe(404);
    const bad = new FormData();
    bad.append('categoryId', String(category.id));
    bad.append('location', 'Invalid upload');
    bad.append('description', 'This invalid upload must never be persisted.');
    bad.append('files', new Blob(['not a png'], { type: 'image/png' }), 'fake.png');
    expect(
      (
        await fetch(`${base}/api/v1/complaints`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${tokens.student}` },
          body: bad,
        })
      ).status,
    ).toBe(422);
    for (const [count, bytes] of [
      [6, 8],
      [1, 10 * 1024 * 1024 + 1],
    ]) {
      const oversized = new FormData();
      oversized.append('categoryId', String(category.id));
      oversized.append('location', 'Boundary upload');
      oversized.append('description', 'This boundary upload must never be persisted.');
      for (let i = 0; i < count; i++) {
        const buffer = Buffer.alloc(bytes);
        png.copy(buffer);
        oversized.append('files', new Blob([buffer], { type: 'image/png' }), `boundary-${i}.png`);
      }
      expect(
        (
          await fetch(`${base}/api/v1/complaints`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${tokens.student}` },
            body: oversized,
          })
        ).status,
      ).toBe(422);
    }
  });
  it('escalates a breached cycle once and persists immutable audit/history', async () => {
    const category = catalog.categories.find((c: any) => c.code === 'NETWORK');
    const result = await request('/complaints', 'student', {
      categoryId: category.id,
      description: 'The wireless access point is not available in this room.',
      location: 'Network test room',
    });
    await db.execute(
      'UPDATE resolution_cycles SET due_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 MINUTE) WHERE complaint_id=?',
      [result.body.id],
    );
    const { scanSla } = await import('../apps/api/src/notifications.js');
    await Promise.all([scanSla(), scanSla()]);
    const entries = await db.rows('SELECT id FROM audit_events WHERE entity_id=? AND action=?', [
      result.body.id,
      'sla_escalated',
    ]);
    expect(entries).toHaveLength(1);
    await expect(
      db.execute('UPDATE audit_events SET action=? WHERE id=?', ['tampered', entries[0].id]),
    ).rejects.toThrow();
    const [history] = await db.rows('SELECT id FROM status_history WHERE complaint_id=?', [
      result.body.id,
    ]);
    await expect(
      db.execute('DELETE FROM status_history WHERE id=?', [history.id]),
    ).rejects.toThrow();
  });
  it('scopes notification read changes and restricts reports and exports', async () => {
    const notifications = await request('/notifications', 'student');
    expect(notifications.body.items.length).toBeGreaterThan(0);
    const id = notifications.body.items[0].id;
    expect((await request('/notifications/read', 'faculty', { id })).status).toBe(200);
    let [notice] = await db.rows('SELECT read_at FROM notifications WHERE id=?', [id]);
    expect(notice.read_at).toBeNull();
    await request('/notifications/read', 'student', { id });
    [notice] = await db.rows('SELECT read_at FROM notifications WHERE id=?', [id]);
    expect(notice.read_at).not.toBeNull();
    expect((await request('/notifications/read', 'student', {})).status).toBe(200);
    expect((await request('/reports?type=category', 'incharge')).status).toBe(200);
    expect((await request('/reports?type=department', 'incharge')).status).toBe(403);
    expect((await request('/reports?type=category', 'student')).status).toBe(403);
    const report = await request('/reports?type=department', 'admin');
    expect(report.status).toBe(200);
    expect(report.body.rows.length).toBeGreaterThan(0);
    for (const format of ['csv', 'pdf']) {
      const url = `${base}/api/v1/reports/export?type=department&format=${format}`;
      expect(
        (await fetch(url, { headers: { Authorization: `Bearer ${tokens.incharge}` } })).status,
      ).toBe(403);
      const response = await fetch(url, { headers: { Authorization: `Bearer ${tokens.admin}` } });
      expect(response.status).toBe(200);
      const bytes = Buffer.from(await response.arrayBuffer());
      expect(bytes.length).toBeGreaterThan(100);
      if (format === 'pdf') expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    }
  });
  it('enforces administrative invariants and revokes tokens after security edits', async () => {
    expect((await request('/admin/users', 'student')).status).toBe(403);
    const [account] = await db.rows<any>('SELECT id FROM users WHERE email=?', [registeredEmail]);
    expect(
      (
        await request(
          `/admin/users/${account.id}`,
          'admin',
          { role: 'Department Officer', departmentId: null },
          'PATCH',
        )
      ).status,
    ).toBe(422);
    expect(
      (
        await request(
          `/admin/users/${account.id}`,
          'admin',
          { role: 'Faculty', departmentId: null },
          'PATCH',
        )
      ).status,
    ).toBe(200);
    expect((await request('/profile', 'registered')).status).toBe(401);
    const login = await request('/auth/login', undefined, {
      email: registeredEmail,
      password: 'AnotherDemo!2026',
    });
    tokens.registered = login.body.accessToken;
    expect(
      (await request(`/admin/users/${account.id}`, 'admin', { active: false }, 'PATCH')).status,
    ).toBe(200);
    expect((await request('/profile', 'registered')).status).toBe(401);
    const [admin] = await db.rows<any>("SELECT id FROM users WHERE email='admin@campus.test'");
    expect(
      (await request(`/admin/users/${admin.id}`, 'admin', { active: false }, 'PATCH')).status,
    ).toBe(409);
    const department = await request('/admin/departments', 'admin', {
      name: `Integration department ${Date.now()}`,
    });
    expect(department.status).toBe(201);
    const category = await request('/admin/categories', 'admin', {
      name: `Integration category ${Date.now()}`,
      departmentId: department.body.id,
    });
    expect(category.status).toBe(201);
    expect(
      (
        await request(
          `/admin/departments/${department.body.id}`,
          'admin',
          { active: false },
          'PATCH',
        )
      ).status,
    ).toBe(409);
    const mental = catalog.categories.find((c: any) => c.code === 'MENTAL_HEALTH');
    const rename = await request(
      `/admin/categories/${mental.id}`,
      'admin',
      { name: 'Mental Health Concerns' },
      'PATCH',
    );
    expect(rename.body.emergency).toBe(true);
    expect(rename.body.confidential).toBe(true);
    expect(
      (await request(`/admin/categories/${mental.id}`, 'admin', { confidential: false }, 'PATCH'))
        .status,
    ).toBe(422);
  });
});
