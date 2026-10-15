import { randomUUID } from 'node:crypto';
import { mkdir, readFile as fsReadFile, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { v2 as cloudinary } from 'cloudinary';
import multer from 'multer';
import { config } from './config.js';
import { HttpError } from './errors.js';
import { MAX_FILES, MAX_FILE_SIZE } from '@fixmycampus/shared';
cloudinary.config(config.cloudinary);
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: MAX_FILES, fields: 20, fieldSize: 20000 },
});
export function detectMime(buffer: Buffer): string | null {
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return 'image/png';
  if (buffer.length >= 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255)
    return 'image/jpeg';
  if (buffer.subarray(0, 5).toString() === '%PDF-') return 'application/pdf';
  return null;
}
export function validateFile(file: Express.Multer.File) {
  const mime = detectMime(file.buffer);
  if (!mime || mime !== file.mimetype)
    throw new HttpError(422, 'Only valid JPEG, PNG and PDF files are accepted.');
  if (file.size > MAX_FILE_SIZE)
    throw new HttpError(422, 'Each attachment must be no larger than 10 MB.');
  return mime;
}
export async function saveFile(
  buffer: Buffer,
  mime: string,
): Promise<{ key: string; driver: 'local' | 'cloudinary' }> {
  if (!detectMime(buffer) || detectMime(buffer) !== mime)
    throw new HttpError(422, 'Invalid file contents.');
  const id = randomUUID();
  if (config.storage === 'cloudinary') {
    if (
      !config.cloudinary.cloud_name ||
      !config.cloudinary.api_key ||
      !config.cloudinary.api_secret
    )
      throw new HttpError(503, 'Attachment storage is not configured.');
    const result = await new Promise<any>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { public_id: `fixmycampus/${id}`, resource_type: 'raw', type: 'authenticated' },
        (error, result) => (error ? reject(error) : resolve(result)),
      );
      stream.end(buffer);
    });
    return { key: result.public_id, driver: 'cloudinary' };
  }
  await mkdir(config.uploadsDir, { recursive: true });
  await writeFile(path.join(config.uploadsDir, id), buffer, { flag: 'wx' });
  return { key: id, driver: 'local' };
}
export async function readFile(key: string, driver: string): Promise<Buffer> {
  if (driver === 'cloudinary') {
    const url = cloudinary.utils.private_download_url(key, '', {
      resource_type: 'raw',
      type: 'authenticated',
      expires_at: Math.floor(Date.now() / 1000) + 60,
    });
    const result = await fetch(url);
    if (!result.ok) throw new HttpError(502, 'Could not read the attachment.');
    return Buffer.from(await result.arrayBuffer());
  }
  if (!/^[a-f0-9-]{36}$/.test(key)) throw new HttpError(404, 'Attachment not found.');
  try {
    return await fsReadFile(path.join(config.uploadsDir, key));
  } catch {
    throw new HttpError(404, 'Attachment not found.');
  }
}
export async function removeFile(key: string, driver: string) {
  if (driver === 'cloudinary')
    await cloudinary.uploader.destroy(key, { resource_type: 'raw', type: 'authenticated' });
  else if (/^[a-f0-9-]{36}$/.test(key))
    await unlink(path.join(config.uploadsDir, key)).catch(() => {});
}
