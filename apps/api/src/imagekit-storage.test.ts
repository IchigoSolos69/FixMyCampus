import ImageKit from '@imagekit/nodejs';
import { Helper } from '@imagekit/nodejs/resources/helper';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from './config.js';
import { saveFile, readFile, removeFile } from './storage.js';

const original = { storage: config.storage, imagekit: { ...config.imagekit } };
const upload = vi.fn();
const remove = vi.fn();
const fetchFile = vi.fn();
const fileId = '507f1f77bcf86cd799439011';
const storedPath = '/fixmycampus/12345678-1234-1234-1234-123456789abc.pdf';
const storedKey = JSON.stringify({ id: fileId, path: storedPath });

beforeEach(() => {
  config.storage = 'imagekit';
  config.imagekit = {
    privateKey: 'test-private-api-key',
    urlEndpoint: 'https://ik.imagekit.io/campus',
  };
  vi.spyOn(ImageKit.Files.prototype, 'upload').mockImplementation(upload);
  vi.spyOn(ImageKit.Files.prototype, 'delete').mockImplementation(remove);
  vi.stubGlobal('fetch', fetchFile);
  upload.mockImplementation(async (body: ImageKit.FileUploadParams) => ({
    fileId,
    filePath: `/fixmycampus/${body.fileName}`,
    isPrivateFile: true,
  }));
  remove.mockResolvedValue(undefined);
});
afterEach(() => {
  config.storage = original.storage;
  config.imagekit = { ...original.imagekit };
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('private ImageKit attachments', () => {
  it.each([
    [Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), 'image/png', 'png'],
    [Buffer.from([255, 216, 255, 224]), 'image/jpeg', 'jpg'],
    [Buffer.from('%PDF-1.7\n'), 'application/pdf', 'pdf'],
  ])(
    'uploads validated bytes as a private file with a randomized name',
    async (buffer, mime, ext) => {
      const saved = await saveFile(buffer as Buffer, mime as string);
      const body = upload.mock.calls[0][0];
      expect(body).toMatchObject({
        folder: '/fixmycampus',
        isPrivateFile: true,
        responseFields: ['isPrivateFile'],
        useUniqueFileName: false,
        overwriteFile: false,
      });
      expect(body.fileName).toMatch(new RegExp(`^[a-f0-9-]{36}\\.${ext}$`));
      expect(body.file.type).toBe(mime);
      expect(Buffer.from(await body.file.arrayBuffer())).toEqual(buffer);
      expect(saved).toEqual({
        driver: 'imagekit',
        key: JSON.stringify({ id: fileId, path: `/fixmycampus/${body.fileName}` }),
      });
      expect(saved.key).not.toContain('https:');
    },
  );

  it('rejects forged file contents before contacting ImageKit', async () => {
    await expect(saveFile(Buffer.from('fake image'), 'image/png')).rejects.toMatchObject({
      status: 422,
    });
    expect(upload).not.toHaveBeenCalled();
  });

  it('requires server configuration and does not leak private keys in provider errors', async () => {
    config.imagekit.privateKey = '';
    await expect(saveFile(Buffer.from('%PDF-1.7'), 'application/pdf')).rejects.toMatchObject({
      status: 503,
      message: 'Attachment storage is not configured.',
    });
    config.imagekit.privateKey = 'test-private-api-key';
    config.imagekit.urlEndpoint = '';
    await expect(readFile(storedKey, 'imagekit')).rejects.toMatchObject({ status: 503 });
    config.imagekit.urlEndpoint = 'https://ik.imagekit.io/campus';
    upload.mockRejectedValueOnce(new Error('Authorization: test-private-api-key'));
    await expect(saveFile(Buffer.from('%PDF-1.7'), 'application/pdf')).rejects.toMatchObject({
      status: 502,
      message: 'Could not save the attachment.',
    });
  });

  it('removes an upload if the provider does not confirm that it is private', async () => {
    upload.mockResolvedValueOnce({ fileId, filePath: storedPath, isPrivateFile: false });
    await expect(saveFile(Buffer.from('%PDF-1.7'), 'application/pdf')).rejects.toMatchObject({
      status: 502,
    });
    expect(remove).toHaveBeenCalledWith(fileId);
  });

  it('fetches a 60-second signed URL on the server and returns only file bytes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-16T12:00:00Z'));
    const bytes = Buffer.from('%PDF-1.7\nprivate evidence');
    fetchFile.mockResolvedValueOnce(new Response(bytes));
    expect(await readFile(storedKey, 'imagekit')).toEqual(bytes);
    const [url, options] = fetchFile.mock.calls[0];
    expect(url.origin).toBe('https://ik.imagekit.io');
    expect(url.pathname).toBe(`/campus${storedPath}`);
    expect(url.searchParams.get('tr')).toBe('orig-true');
    expect(url.searchParams.get('ik-t')).toBe(String(Date.now() / 1000 + 60));
    expect(url.searchParams.get('ik-s')).toMatch(/^[a-f0-9]+$/);
    expect(url.toString()).not.toContain(config.imagekit.privateKey);
    expect(options).toMatchObject({ redirect: 'error', signal: expect.any(AbortSignal) });
  });

  it.each([
    '',
    'https://localhost/private.pdf',
    JSON.stringify({ id: fileId, path: '//localhost/private.pdf' }),
    JSON.stringify({ id: fileId, path: '/fixmycampus/../private.pdf' }),
    JSON.stringify({ id: '../../other', path: storedPath }),
  ])('rejects malformed or unsafe storage keys before provider access', async (key) => {
    await expect(readFile(key, 'imagekit')).rejects.toMatchObject({ status: 404 });
    await expect(removeFile(key, 'imagekit')).rejects.toMatchObject({ status: 404 });
    expect(fetchFile).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it('converts delivery and deletion failures into controlled errors', async () => {
    fetchFile.mockResolvedValueOnce(new Response('private provider error', { status: 403 }));
    await expect(readFile(storedKey, 'imagekit')).rejects.toMatchObject({
      status: 502,
      message: 'Could not read the attachment.',
    });
    remove.mockRejectedValueOnce(new Error('Authorization: test-private-api-key'));
    await expect(removeFile(storedKey, 'imagekit')).rejects.toMatchObject({
      status: 502,
      message: 'Could not remove the attachment.',
    });
  });

  it('blocks an unexpected delivery host before fetching any file', async () => {
    vi.spyOn(Helper.prototype, 'buildSrc').mockReturnValue('https://localhost/private.pdf');
    await expect(readFile(storedKey, 'imagekit')).rejects.toMatchObject({ status: 502 });
    expect(fetchFile).not.toHaveBeenCalled();
  });

  it('treats an already deleted provider file as successfully removed', async () => {
    remove.mockRejectedValueOnce(
      new ImageKit.NotFoundError(404, {}, 'File not found', new Headers()),
    );
    await expect(removeFile(storedKey, 'imagekit')).resolves.toBeUndefined();
  });

  it('deletes the opaque file ID during failed-transaction cleanup', async () => {
    await removeFile(storedKey, 'imagekit');
    expect(remove).toHaveBeenCalledWith(fileId);
  });
});
