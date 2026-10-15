/** Generate synthetic scale data only in a deliberately named benchmark DB. */
import mysql from 'mysql2/promise';
import { randomBytes, scryptSync } from 'node:crypto';

const uri = process.env.BENCH_DATABASE_URL;
if (!uri || process.env.ALLOW_BENCHMARK_SEED !== '1')
  throw new Error('Set BENCH_DATABASE_URL and ALLOW_BENCHMARK_SEED=1 explicitly');
const target = new URL(uri);
const database = decodeURIComponent(target.pathname.slice(1));
if (!/^fixmycampus_benchmark[a-z0-9_]*$/.test(database))
  throw new Error('Refusing database: name must start fixmycampus_benchmark');
const connection = await mysql.createConnection({ uri, timezone: 'Z' });
await connection.query("SET time_zone='+00:00'");
const batchSize = 250;
async function insertMany(table, fields, values) {
  for (let offset = 0; offset < values.length; offset += batchSize) {
    const batch = values.slice(offset, offset + batchSize);
    const placeholders = batch.map(() => `(${fields.map(() => '?').join(',')})`).join(',');
    await connection.execute(
      `INSERT IGNORE INTO ${table} (${fields.join(',')}) VALUES ${placeholders}`,
      batch.flat(),
    );
  }
}
try {
  const [categories] = await connection.query(
    'SELECT id,department_id,confidential,emergency FROM categories ORDER BY id',
  );
  if (categories.length < 15)
    throw new Error('Run migrations and demo seed against this benchmark database first');
  const salt = randomBytes(16).toString('hex');
  const hash = `scrypt$32768$8$3$${salt}$${scryptSync('CampusDemo!2026', salt, 64, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }).toString('hex')}`;
  await connection.beginTransaction();
  await insertMany(
    'users',
    ['name', 'email', 'password_hash', 'role', 'email_verified'],
    Array.from({ length: 5000 }, (_, i) => [
      `Benchmark Student ${i + 1}`,
      `benchmark${i + 1}@campus.test`,
      hash,
      'Student',
      true,
    ]),
  );
  const [users] = await connection.query(
    "SELECT id FROM users WHERE email LIKE 'benchmark%@campus.test' ORDER BY id",
  );
  await insertMany(
    'complaints',
    [
      'reference',
      'reporter_id',
      'category_id',
      'department_id',
      'status',
      'priority',
      'description',
      'location',
      'anonymous',
      'confidential',
      'emergency',
      'resolved_at',
      'created_at',
    ],
    Array.from({ length: 10000 }, (_, i) => {
      const category = categories[i % categories.length];
      const resolved = i % 3 === 0;
      const day = Math.floor(i / 5000) + 1;
      return [
        `CMP-2020010${day}-${String((i % 5000) + 1).padStart(4, '0')}`,
        users[i % users.length].id,
        category.id,
        category.department_id,
        resolved ? 'Resolved' : 'Assigned',
        category.emergency ? 'Critical' : ['Low', 'Medium', 'High'][i % 3],
        `Synthetic campus maintenance benchmark complaint number ${i + 1}. No personal information.`,
        `Benchmark building ${(i % 20) + 1}`,
        false,
        category.confidential,
        category.emergency,
        resolved ? `2020-01-0${day + 1} 00:00:00` : null,
        `2020-01-0${day} 00:00:00`,
      ];
    }),
  );
  const [complaints] = await connection.query(
    "SELECT id,department_id,resolved_at,created_at,priority FROM complaints WHERE reference LIKE 'CMP-2020010_-%'",
  );
  const hours = { Low: 168, Medium: 72, High: 24, Critical: 24 };
  await insertMany(
    'resolution_cycles',
    [
      'complaint_id',
      'cycle_number',
      'department_id',
      'started_at',
      'sla_hours',
      'due_at',
      'resolved_at',
      'ended_at',
      'escalated_at',
    ],
    complaints.map((c) => [
      c.id,
      1,
      c.department_id,
      c.created_at,
      hours[c.priority],
      new Date(new Date(c.created_at).getTime() + hours[c.priority] * 3600000),
      c.resolved_at,
      c.resolved_at,
      c.resolved_at ? null : '2020-01-10 00:00:00',
    ]),
  );
  await connection.commit();
  console.log(
    JSON.stringify(
      {
        database,
        generatedUsers: users.length,
        generatedComplaints: complaints.length,
        syntheticOnly: true,
      },
      null,
      2,
    ),
  );
} catch (error) {
  await connection.rollback();
  throw error;
} finally {
  await connection.end();
}
