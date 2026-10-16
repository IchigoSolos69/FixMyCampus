import mysql, {
  type PoolConnection,
  type ResultSetHeader,
  type RowDataPacket,
} from 'mysql2/promise';
import { config } from './config.js';
export const pool = mysql.createPool({
  uri: config.databaseUrl,
  ssl: config.databaseSslCa
    ? { ca: config.databaseSslCa, rejectUnauthorized: true, verifyIdentity: true }
    : undefined,
  timezone: 'Z',
  dateStrings: true,
  connectionLimit: 12,
  decimalNumbers: true,
  multipleStatements: false,
});
// Driver timezone only converts values; SQL defaults and NOW() also need a UTC session.
pool.pool.on('connection', (connection) => {
  connection.query("SET time_zone = '+00:00'", (error: Error | null) => {
    if (error) {
      console.error('Could not establish UTC database session');
      connection.destroy();
    }
  });
});
export type DB = Pick<PoolConnection, 'execute' | 'query'>;
export async function rows<T = Record<string, any>>(
  sql: string,
  values: unknown[] = [],
  db: DB = pool,
): Promise<T[]> {
  const [result] = await db.execute<RowDataPacket[]>(sql, values as any[]);
  return result as T[];
}
export async function execute(
  sql: string,
  values: unknown[] = [],
  db: DB = pool,
): Promise<ResultSetHeader> {
  const [result] = await db.execute<ResultSetHeader>(sql, values as any[]);
  return result;
}
export async function transaction<T>(fn: (db: PoolConnection) => Promise<T>): Promise<T> {
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    const result = await fn(db);
    await db.commit();
    return result;
  } catch (error) {
    await db.rollback();
    throw error;
  } finally {
    db.release();
  }
}
export function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  const s = String(value);
  return new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z').toISOString();
}
