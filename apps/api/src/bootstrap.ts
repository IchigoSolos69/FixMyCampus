import { registerSchema } from '@fixmycampus/shared';
import { seedCatalog } from './seed.js';
import { pool, rows, execute, transaction } from './db.js';
import { hashPassword } from './auth-service.js';
import { config } from './config.js';
import { audit } from './audit.js';
async function bootstrap() {
  const input = registerSchema.parse({
    name: process.env.BOOTSTRAP_ADMIN_NAME || 'Campus Administrator',
    email: process.env.BOOTSTRAP_ADMIN_EMAIL,
    password: process.env.BOOTSTRAP_ADMIN_PASSWORD,
  });
  if (!config.domains.includes(input.email.split('@')[1]))
    throw new Error('The Administrator email must belong to an approved institution domain.');
  await seedCatalog();
  const hash = await hashPassword(input.password);
  await transaction(async (db) => {
    const admins = await rows("SELECT id FROM users WHERE role='Administrator' FOR UPDATE", [], db);
    if (admins.length)
      throw new Error('An Administrator already exists. Manage accounts through the application.');
    const result = await execute(
      "INSERT INTO users (name,email,password_hash,role,active,email_verified) VALUES (?,?,?,'Administrator',1,1)",
      [input.name, input.email, hash],
      db,
    );
    await audit(db, null, 'admin.bootstrapped', 'user', result.insertId);
  });
  console.log('Initial Administrator and campus catalog created. No demo accounts were added.');
}
bootstrap()
  .then(() => pool.end())
  .catch(async (error) => {
    console.error(error.message);
    await pool.end();
    process.exitCode = 1;
  });
