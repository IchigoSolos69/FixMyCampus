import ImageKit, { toFile } from '@imagekit/nodejs';
import { config } from './config.js';
import { HttpError } from './errors.js';

const fileIdPattern = /^[A-Za-z0-9_-]{1,128}$/;
const filePathPattern =
  /^\/fixmycampus\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.(jpg|png|pdf)$/;

function imageKit() {
  if (!config.imagekit.privateKey || !config.imagekit.urlEndpoint)
    throw new HttpError(503, 'Attachment storage is not configured.');
  return new ImageKit({
    privateKey: config.imagekit.privateKey,
    baseURL: 'https://api.imagekit.io',
    timeout: 20000,
    maxRetries: 0,
    logLevel: 'off',
  });
}

function parseKey(key: string): { id: string; path: string } {
  try {
    const value = JSON.parse(key);
    if (
      value &&
      typeof value.id === 'string' &&
      fileIdPattern.test(value.id) &&
      typeof value.path === 'string' &&
      filePathPattern.test(value.path)
    )
      return { id: value.id, path: value.path };
  } catch {}
  throw new HttpError(404, 'Attachment not found.');
}

export async function saveImageKitFile(buffer: Buffer, mime: string, id: string) {
  const client = imageKit();
  const extension = mime === 'image/jpeg' ? 'jpg' : mime === 'image/png' ? 'png' : 'pdf';
  const fileName = `${id}.${extension}`;
  const filePath = `/fixmycampus/${fileName}`;
  try {
    const result = await client.files.upload({
      file: await toFile(buffer, fileName, { type: mime }),
      fileName,
      folder: '/fixmycampus',
      isPrivateFile: true,
      responseFields: ['isPrivateFile'],
      useUniqueFileName: false,
      overwriteFile: false,
    });
    if (
      result.fileId &&
      fileIdPattern.test(result.fileId) &&
      result.filePath === filePath &&
      result.isPrivateFile === true
    )
      return JSON.stringify({ id: result.fileId, path: filePath });
    if (result.fileId && fileIdPattern.test(result.fileId))
      await client.files.delete(result.fileId).catch(() => {});
    throw new Error('Invalid private upload response');
  } catch {
    throw new HttpError(502, 'Could not save the attachment.');
  }
}

export async function readImageKitFile(key: string): Promise<Buffer> {
  const stored = parseKey(key);
  const client = imageKit();
  try {
    const endpoint = config.imagekit.urlEndpoint!;
    const signed = new URL(
      client.helper.buildSrc({
        urlEndpoint: endpoint,
        src: stored.path,
        transformation: [{ original: true }],
        signed: true,
        expiresIn: 60,
      }),
    );
    const expected = new URL(`${endpoint}${stored.path}`);
    if (
      signed.origin !== expected.origin ||
      signed.pathname !== expected.pathname ||
      signed.username ||
      signed.password
    )
      throw new Error('Invalid delivery URL');
    const result = await fetch(signed, {
      redirect: 'error',
      signal: AbortSignal.timeout(20000),
    });
    if (!result.ok) throw new Error('Delivery failed');
    return Buffer.from(await result.arrayBuffer());
  } catch {
    throw new HttpError(502, 'Could not read the attachment.');
  }
}

export async function removeImageKitFile(key: string) {
  const stored = parseKey(key);
  const client = imageKit();
  try {
    await client.files.delete(stored.id);
  } catch (error) {
    if (!(error instanceof ImageKit.NotFoundError))
      throw new HttpError(502, 'Could not remove the attachment.');
  }
}
