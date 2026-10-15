import { describe, expect, it } from 'vitest';
import { MAX_FILE_SIZE } from '@fixmycampus/shared';
import { detectMime, validateFile, readFile } from './storage.js';

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const jpeg = Buffer.from([255, 216, 255, 224, 0, 0]);
const pdf = Buffer.from('%PDF-1.7\n');
const file = (buffer: Buffer, mimetype: string, originalname = 'evidence'): Express.Multer.File =>
  ({ buffer, mimetype, originalname, size: buffer.length }) as Express.Multer.File;
describe('attachment trust boundary', () => {
  it.each([
    [png, 'image/png'],
    [jpeg, 'image/jpeg'],
    [pdf, 'application/pdf'],
  ] as const)(
    'recognizes allowed file signatures and accepts matching MIME',
    async (buffer, mime) => {
      expect(detectMime(buffer)).toBe(mime);
      expect(validateFile(file(buffer, mime))).toBe(mime);
    },
  );
  it.each([
    Buffer.alloc(0),
    Buffer.from('not an image'),
    png.subarray(0, 7),
    jpeg.subarray(0, 2),
    Buffer.from('%PDF'),
  ])('rejects missing, unknown and truncated signatures', (buffer) => {
    expect(detectMime(buffer)).toBeNull();
    expect(() => validateFile(file(buffer, 'image/png'))).toThrow(
      expect.objectContaining({ status: 422 }),
    );
  });
  it('rejects a false MIME claim instead of trusting an upload filename', () => {
    expect(() => validateFile(file(png, 'image/jpeg', 'photo.jpg'))).toThrow(
      expect.objectContaining({ status: 422 }),
    );
    expect(() => validateFile(file(pdf, 'image/png', 'image.png'))).toThrow(
      expect.objectContaining({ status: 422 }),
    );
  });
  it('validates the content even when a filename has a supported extension', () => {
    expect(() =>
      validateFile(file(Buffer.from('<script>alert(1)</script>'), 'image/png', 'photo.png')),
    ).toThrow(expect.objectContaining({ status: 422 }));
  });
  it('allows the exact 10 MB boundary and rejects a single byte more', () => {
    const exact = Buffer.alloc(MAX_FILE_SIZE);
    png.copy(exact);
    expect(validateFile(file(exact, 'image/png'))).toBe('image/png');
    const oversized = Buffer.alloc(MAX_FILE_SIZE + 1);
    png.copy(oversized);
    expect(() => validateFile(file(oversized, 'image/png'))).toThrow(
      expect.objectContaining({ status: 422 }),
    );
  });
  it.each(['../outside-file', '../../.env', 'C:\\secrets\\file', '/etc/passwd', ''])(
    'rejects local traversal keys before reading disk',
    async (key) => {
      await expect(readFile(key, 'local')).rejects.toMatchObject({ status: 404 });
    },
  );
});
