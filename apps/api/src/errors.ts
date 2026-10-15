import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = 'REQUEST_ERROR',
  ) {
    super(message);
  }
}
export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof ZodError) {
    res.status(422).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Check the highlighted fields.',
        fields: error.flatten().fieldErrors,
      },
    });
    return;
  }
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: { code: error.code, message: error.message } });
    return;
  }
  if (error.type === 'entity.parse.failed') {
    res
      .status(400)
      .json({ error: { code: 'INVALID_JSON', message: 'The request contains invalid JSON.' } });
    return;
  }
  if (error.code === 'ER_DUP_ENTRY') {
    res.status(409).json({ error: { code: 'CONFLICT', message: 'This record already exists.' } });
    return;
  }
  if (
    error.code === 'LIMIT_FILE_SIZE' ||
    error.code === 'LIMIT_FILE_COUNT' ||
    error.code === 'LIMIT_UNEXPECTED_FILE'
  ) {
    res.status(422).json({
      error: {
        code: 'UPLOAD_LIMIT',
        message: 'Upload at most five JPEG, PNG or PDF files, each no larger than 10 MB.',
      },
    });
    return;
  }
  console.error(
    JSON.stringify({ event: 'request_failed', message: error.message, stack: error.stack }),
  );
  res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' },
  });
};
