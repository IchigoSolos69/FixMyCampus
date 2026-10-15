import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { pool, rows, execute } from './db.js';
export async function migrate() {
  const connection = await pool.getConnection();
  try {
    const [migrationLock] = await rows<any>(
      "SELECT GET_LOCK('fixmycampus_migrate',60) acquired",
      [],
      connection,
    );
    if (Number(migrationLock.acquired) !== 1)
      throw new Error(
        'Could not acquire the migration lock. Try again when other migrations finish.',
      );
    await connection.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (name VARCHAR(255) PRIMARY KEY,applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)',
    );
    const dir = [
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../migrations'),
      path.resolve(process.cwd(), 'migrations'),
      path.resolve(process.cwd(), 'apps/api/migrations'),
    ].find((p) => existsSync(p));
    if (!dir)
      throw new Error(
        'Cannot find database migrations. Run from the repository or apps/api directory.',
      );
    for (const name of (await readdir(dir)).filter((v) => v.endsWith('.sql')).sort()) {
      if (
        (await rows('SELECT name FROM schema_migrations WHERE name=?', [name], connection)).length
      )
        continue;
      const sql = await readFile(path.join(dir, name), 'utf8');
      // Each migration line is one complete SQL statement, including trigger bodies.
      for (const statement of sql
        .split(/\r?\n/)
        .map((v) => v.trim())
        .filter((v) => v && !v.startsWith('--')))
        await connection.query(statement);
      await execute('INSERT INTO schema_migrations (name) VALUES (?)', [name], connection);
      console.log(`Applied ${name}`);
    }
  } finally {
    await connection.query("SELECT RELEASE_LOCK('fixmycampus_migrate')");
    connection.release();
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  migrate()
    .then(() => pool.end())
    .catch(async (e) => {
      console.error(e.message);
      await pool.end();
      process.exitCode = 1;
    });
}
