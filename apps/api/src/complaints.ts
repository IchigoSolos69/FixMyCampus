import { Router } from 'express';
import { actionSchema, feedbackSchema } from '@fixmycampus/shared';
import { requireAuth } from './auth.js';
import { rows } from './db.js';
import { HttpError } from './errors.js';
import { upload, readFile } from './storage.js';
import {
  getComplaint,
  listComplaints,
  createComplaint,
  actOnComplaint,
  addAttachments,
  submitFeedback,
} from './complaint-service.js';
export const complaintRouter = Router();
complaintRouter.use(requireAuth);
function idParam(value: unknown) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(404, 'Complaint not found.');
  return id;
}
complaintRouter.get('/', async (req, res) => {
  res.json(await listComplaints(req.user!, req.query));
});
complaintRouter.post('/', upload.array('files', 5), async (req, res) => {
  res
    .status(201)
    .json(await createComplaint(req.user!, req.body, (req.files || []) as Express.Multer.File[]));
});
complaintRouter.get('/:id', async (req, res) => {
  res.json(await getComplaint(req.user!, idParam(req.params.id)));
});
complaintRouter.post('/:id/actions', async (req, res) => {
  res.json(await actOnComplaint(req.user!, idParam(req.params.id), actionSchema.parse(req.body)));
});
complaintRouter.post('/:id/attachments', upload.array('files', 5), async (req, res) => {
  if (!['proof', 'report'].includes(req.body.kind))
    throw new HttpError(422, 'Choose report or proof attachments.');
  res.json(
    await addAttachments(
      req.user!,
      idParam(req.params.id),
      (req.files || []) as Express.Multer.File[],
      req.body.kind,
    ),
  );
});
complaintRouter.post('/:id/feedback', async (req, res) => {
  res
    .status(201)
    .json(await submitFeedback(req.user!, idParam(req.params.id), feedbackSchema.parse(req.body)));
});
export const attachmentRouter = Router();
attachmentRouter.use(requireAuth);
attachmentRouter.get('/:id', async (req, res) => {
  const id = idParam(req.params.id);
  const [file] = await rows<any>('SELECT * FROM attachments WHERE id=?', [id]);
  if (!file) throw new HttpError(404, 'Attachment not found.');
  const c = await getComplaint(req.user!, Number(file.complaint_id));
  const buffer = await readFile(file.storage_key, file.driver);
  const ext = file.mime === 'application/pdf' ? 'pdf' : file.mime === 'image/png' ? 'png' : 'jpg';
  res.setHeader('Content-Type', file.mime);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${c.reference}-evidence-${id}.${ext}"`,
  );
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(buffer);
});
