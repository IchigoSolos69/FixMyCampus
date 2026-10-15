import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEED_DEPARTMENTS, SEED_CATEGORIES, SLA_HOURS } from '@fixmycampus/shared';
import { rows, execute, pool } from './db.js';
import { config } from './config.js';
import { hashPassword, userFromRow } from './auth-service.js';
import { DEFAULT_TEMPLATES } from './notifications.js';
import { createComplaint, actOnComplaint, submitFeedback } from './complaint-service.js';
export async function seedCatalog() {
  for (const name of SEED_DEPARTMENTS)
    await execute('INSERT IGNORE INTO departments (name) VALUES (?)', [name]);
  const departments = await rows<any>('SELECT id,name FROM departments');
  const dept = (name: string) => Number(departments.find((d) => d.name === name)!.id);
  for (const [code, name, department, confidential, emergency] of SEED_CATEGORIES)
    await execute(
      'INSERT IGNORE INTO categories (code,name,department_id,confidential,emergency) VALUES (?,?,?,?,?)',
      [code, name, dept(department), confidential, emergency],
    );
  await execute("INSERT IGNORE INTO settings (key_name,value_json) VALUES ('sla',?)", [
    JSON.stringify(SLA_HOURS),
  ]);
  for (const template of DEFAULT_TEMPLATES)
    await execute('INSERT IGNORE INTO email_templates (event,subject,body) VALUES (?,?,?)', [
      template.event,
      template.subject,
      template.body,
    ]);
  return { dept };
}
export async function seed() {
  if (config.production && process.env.ALLOW_DEMO_SEED !== 'true')
    throw new Error(
      'Demo seeding is disabled in production. Set ALLOW_DEMO_SEED=true only for a disposable demo.',
    );
  const { dept } = await seedCatalog();
  const password = await hashPassword('CampusDemo!2026');
  const users: [string, string, string, number | null][] = [
    ['student', 'Aarav Sharma', 'Student', null],
    ['faculty', 'Dr. Meera Desai', 'Faculty', null],
    ['staff', 'Rohan Patil', 'Staff', null],
    ['incharge', 'Priya Kulkarni', 'Campus Incharge', null],
    ['admin', 'Campus Administrator', 'Administrator', null],
    ...SEED_DEPARTMENTS.map((name, i): [string, string, string, number] => [
      `officer${i + 1}`,
      `${name} Officer`,
      'Department Officer',
      dept(name),
    ]),
  ];
  for (const [email, name, role, departmentId] of users)
    await execute(
      'INSERT IGNORE INTO users (name,email,password_hash,role,department_id,active,email_verified,affiliation) VALUES (?,?,?,?,?,1,1,?)',
      [name, `${email}@campus.test`, password, role, departmentId, 'PCCoE'],
    );
  const [count] = await rows<any>('SELECT COUNT(*) count FROM complaints');
  if (Number(count.count) === 0) {
    const load = async (email: string) =>
      userFromRow(
        (await rows<any>('SELECT * FROM users WHERE email=?', [`${email}@campus.test`]))[0],
      );
    const student = await load('student'),
      faculty = await load('faculty'),
      staff = await load('staff'),
      incharge = await load('incharge');
    const categories = await rows<any>('SELECT * FROM categories');
    const cat = (code: string) => categories.find((c) => c.code === code);
    await createComplaint(student, {
      categoryId: cat('NETWORK').id,
      description: 'The Wi-Fi connection drops repeatedly during afternoon classes.',
      location: 'IT Building, second floor',
    });
    const assigned = await createComplaint(faculty, {
      categoryId: cat('PROJECTOR').id,
      description: 'The classroom projector flickers and cannot display lecture slides clearly.',
      location: 'Room B-204',
    });
    await actOnComplaint(incharge, assigned.id, { action: 'verify' });
    await actOnComplaint(incharge, assigned.id, {
      action: 'assign',
      departmentId: cat('PROJECTOR').department_id,
    });
    const progress = await createComplaint(staff, {
      categoryId: cat('PLUMBING').id,
      description: 'A leaking tap is wasting water near the main building washroom.',
      location: 'Main Building, ground floor',
    });
    await actOnComplaint(incharge, progress.id, { action: 'verify' });
    await actOnComplaint(incharge, progress.id, {
      action: 'assign',
      departmentId: cat('PLUMBING').department_id,
    });
    await actOnComplaint(await load('officer1'), progress.id, { action: 'start' });
    await actOnComplaint(await load('officer1'), progress.id, {
      action: 'progress',
      note: 'Replacement tap ordered; temporary water isolation completed.',
    });
    const resolved = await createComplaint(student, {
      categoryId: cat('ELECTRICAL').id,
      description: 'The corridor lights outside the classroom are not switching on.',
      location: 'Block A, first floor corridor',
    });
    await actOnComplaint(incharge, resolved.id, { action: 'verify' });
    await actOnComplaint(incharge, resolved.id, {
      action: 'assign',
      departmentId: cat('ELECTRICAL').department_id,
    });
    await actOnComplaint(await load('officer3'), resolved.id, { action: 'start' });
    await actOnComplaint(await load('officer3'), resolved.id, {
      action: 'resolve',
      summary: 'Replaced the faulty LED driver and verified all corridor lights.',
    });
    await submitFeedback(student, resolved.id, {
      rating: 5,
      comment: 'The corridor is well lit again. Thank you.',
    });
    const returned = await createComplaint(student, {
      categoryId: cat('FURNITURE').id,
      description: 'A chair in the classroom has a broken support and cannot be used.',
      location: 'Academic block',
    });
    await actOnComplaint(incharge, returned.id, {
      action: 'return',
      reason: 'Please add the classroom number so the maintenance team can locate the chair.',
    });
    await createComplaint(student, {
      categoryId: cat('ANTI_RAGGING').id,
      description:
        'I would like to confidentially report an incident and request support from the committee.',
      location: 'Student activity area',
      anonymous: true,
    });
    await createComplaint(faculty, {
      categoryId: cat('SECURITY').id,
      description: 'A damaged safety barrier leaves an open section beside the parking area.',
      location: 'North parking entrance',
    });
  }
  console.log('Seed complete: 15 categories, 11 departments. Demo accounts use CampusDemo!2026.');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  seed()
    .then(() => pool.end())
    .catch(async (error) => {
      console.error(error);
      await pool.end();
      process.exitCode = 1;
    });
