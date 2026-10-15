import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { profileSchema, passwordSchema, MAX_FILE_SIZE } from '@fixmycampus/shared';
import { requireAuth, findUser } from './auth.js';
import { hashPassword, verifyPassword, publicUser } from './auth-service.js';
import { rows, execute, transaction } from './db.js';
import { audit } from './audit.js';
import { HttpError } from './errors.js';
import { saveFile, readFile, detectMime, removeFile } from './storage.js';

export const profileRouter = Router();
profileRouter.use(requireAuth);
profileRouter.get('/', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(publicUser(req.user!));
});
profileRouter.patch('/', async (req, res) => {
  const input = profileSchema.strict().parse(req.body);
  await transaction(async (db) => {
    const columns: string[] = [];
    const values: unknown[] = [];
    for (const [field, column] of [
      ['name', 'name'],
      ['contactNumber', 'contact_number'],
      ['affiliation', 'affiliation'],
    ] as const)
      if (input[field] !== undefined) {
        columns.push(`${column}=?`);
        values.push(input[field] || null);
      }
    if (columns.length) {
      await execute(
        `UPDATE users SET ${columns.join(',')} WHERE id=?`,
        [...values, req.user!.id],
        db,
      );
      await audit(db, req.user!.id, 'profile.updated', 'user', req.user!.id, {
        fields: Object.keys(input),
      });
    }
  });
  res.json(publicUser((await findUser(req.user!.id))!));
});
profileRouter.post('/password', async (req, res) => {
  const input = z
    .object({ currentPassword: z.string().min(1).max(128), newPassword: passwordSchema })
    .strict()
    .parse(req.body);
  const nextHash = await hashPassword(input.newPassword);
  await transaction(async (db) => {
    const [user] = await rows(
      'SELECT password_hash FROM users WHERE id=? FOR UPDATE',
      [req.user!.id],
      db,
    );
    if (!user || !(await verifyPassword(input.currentPassword, user.password_hash)))
      throw new HttpError(422, 'Your current password is incorrect.', 'INCORRECT_PASSWORD');
    await execute(
      'UPDATE users SET password_hash=?,auth_version=auth_version+1,failed_logins=0,locked_until=NULL WHERE id=?',
      [nextHash, req.user!.id],
      db,
    );
    await execute(
      "UPDATE auth_tokens SET used_at=UTC_TIMESTAMP() WHERE user_id=? AND kind='reset' AND used_at IS NULL",
      [req.user!.id],
      db,
    );
    await audit(db, req.user!.id, 'profile.password_changed', 'user', req.user!.id);
  });
  res.json({ message: 'Password changed. Sign in again on your devices.' });
});
const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: 1, fields: 0 },
}).single('photo');
profileRouter.post('/photo', photoUpload, async (req, res) => {
  if (!req.file) throw new HttpError(422, 'Choose a JPEG or PNG profile photo.');
  const mime = detectMime(req.file.buffer);
  if ((mime !== 'image/jpeg' && mime !== 'image/png') || mime !== req.file.mimetype)
    throw new HttpError(
      422,
      'Profile photos must be JPEG or PNG images with matching file contents.',
      'INVALID_FILE_TYPE',
    );
  const stored = await saveFile(req.file.buffer, mime);
  let previous: { key: string; driver: string } | null = null;
  try {
    await transaction(async (db) => {
      const [current] = await rows(
        'SELECT photo_key FROM users WHERE id=? FOR UPDATE',
        [req.user!.id],
        db,
      );
      if (current?.photo_key)
        previous =
          typeof current.photo_key === 'string' ? JSON.parse(current.photo_key) : current.photo_key;
      await execute(
        'UPDATE users SET photo_key=? WHERE id=?',
        [JSON.stringify({ ...stored, mime }), req.user!.id],
        db,
      );
      await audit(db, req.user!.id, 'profile.photo_changed', 'user', req.user!.id);
    });
  } catch (error) {
    await removeFile(stored.key, stored.driver).catch(() => {});
    throw error;
  }
  if (previous)
    await removeFile(
      (previous as { key: string; driver: string }).key,
      (previous as { key: string; driver: string }).driver,
    ).catch(() => {});
  res.json(publicUser((await findUser(req.user!.id))!));
});
profileRouter.get('/photo', async (req, res) => {
  const [user] = await rows('SELECT photo_key FROM users WHERE id=?', [req.user!.id]);
  if (!user?.photo_key) throw new HttpError(404, 'No profile photo has been uploaded.');
  const photo = typeof user.photo_key === 'string' ? JSON.parse(user.photo_key) : user.photo_key;
  const buffer = await readFile(photo.key, photo.driver);
  res.set({
    'Cache-Control': 'private, no-store',
    'Content-Type': photo.mime,
    'X-Content-Type-Options': 'nosniff',
  });
  res.send(buffer);
});
