import type { ComplaintAction, Priority, Role, Status } from '@fixmycampus/shared';
import { HttpError } from './errors.js';
export interface WorkflowComplaint {
  status: Status;
  reporter_id: number;
  department_id: number | null;
  emergency: boolean | number;
  resolved_at: string | Date | null;
}
export function nextStatus(
  c: WorkflowComplaint,
  user: { id: number; role: Role; departmentId: number | null },
  a: ComplaintAction,
  now = new Date(),
): Status {
  const incharge = user.role === 'Campus Incharge';
  const officer =
    user.role === 'Department Officer' &&
    user.departmentId !== null &&
    user.departmentId === c.department_id;
  const owner = user.id === c.reporter_id;
  if (c.status === 'Resolved' && !['reopen'].includes(a.action))
    throw new HttpError(409, 'Resolved complaints cannot be changed.');
  if (c.status === 'Rejected') throw new HttpError(409, 'Rejected complaints cannot be changed.');
  const requireRole = (ok: boolean) => {
    if (!ok) throw new HttpError(403, 'You do not have permission for this action.');
  };
  const state = (allowed: Status[]) => {
    if (!allowed.includes(c.status))
      throw new HttpError(409, 'This action is not available for the current status.');
  };
  const reason = () => {
    if (!a.reason?.trim()) throw new HttpError(422, 'A reason is required.');
  };
  switch (a.action) {
    case 'verify':
      requireRole(incharge);
      state(['Submitted']);
      return 'Verified';
    case 'return':
      requireRole(incharge);
      state(['Submitted', 'Verified']);
      reason();
      return 'Returned';
    case 'reject':
      requireRole(incharge);
      state(['Submitted', 'Verified', 'Returned']);
      reason();
      return 'Rejected';
    case 'assign':
      requireRole(incharge);
      state(['Verified', 'Assigned', 'In Progress']);
      if (!a.departmentId) throw new HttpError(422, 'Choose a department.');
      return 'Assigned';
    case 'priority':
      requireRole(incharge);
      if (!a.priority) throw new HttpError(422, 'Choose a priority.');
      if (c.emergency && a.priority !== 'Critical')
        throw new HttpError(422, 'Emergency complaints must remain Critical.');
      return c.status;
    case 'start':
      requireRole(officer);
      state(['Assigned']);
      return 'In Progress';
    case 'progress':
      requireRole(officer);
      state(['Assigned', 'In Progress']);
      if (!a.note?.trim()) throw new HttpError(422, 'Enter a progress note.');
      return c.status;
    case 'resolve':
      requireRole(officer);
      state(['Assigned', 'In Progress']);
      if (!a.summary || a.summary.trim().length < 10)
        throw new HttpError(422, 'Resolution summary must contain at least 10 characters.');
      return 'Resolved';
    case 'reopen': {
      requireRole(owner);
      state(['Resolved']);
      reason();
      const resolved =
        c.resolved_at instanceof Date
          ? c.resolved_at.getTime()
          : c.resolved_at
            ? new Date(
                c.resolved_at.includes('T') ? c.resolved_at : c.resolved_at.replace(' ', 'T') + 'Z',
              ).getTime()
            : NaN;
      const elapsed = now.getTime() - resolved;
      if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed > 72 * 3600000)
        throw new HttpError(409, 'The 72-hour reopening window has ended.');
      return 'Assigned';
    }
    case 'escalate':
      requireRole(incharge);
      reason();
      return c.status;
    case 'resubmit':
      requireRole(owner);
      state(['Returned']);
      return 'Submitted';
  }
}
export function referenceDate(now: Date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(now)
    .replaceAll('-', '');
}
export function deadline(start: Date, hours: number) {
  return new Date(start.getTime() + hours * 3600000);
}
export function istDateBoundary(value: unknown, end = false) {
  const text = String(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new HttpError(422, 'Dates must use YYYY-MM-DD.');
  const calendar = new Date(`${text}T00:00:00Z`);
  if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== text)
    throw new HttpError(422, 'Choose a valid calendar date.');
  return new Date(calendar.getTime() - 330 * 60000 + (end ? 86400000 : 0));
}
export function priorityOrder(priority: Priority) {
  return { Critical: 0, High: 1, Medium: 2, Low: 3 }[priority];
}
export function canReadComplaint(
  user: { id: number; role: Role; departmentId: number | null },
  c: { reporter_id: number; department_id: number | null; confidential: boolean | number },
) {
  return (
    user.id === c.reporter_id ||
    user.role === 'Campus Incharge' ||
    (user.role === 'Department Officer' &&
      user.departmentId !== null &&
      user.departmentId === c.department_id)
  );
}
export function weeklyFlag(
  cycles: { resolvedAt: string; hours: number; slaHours: number }[],
  now = new Date(),
) {
  const shifted = new Date(now.getTime() + 330 * 60000);
  const day = (shifted.getUTCDay() + 6) % 7;
  const monday =
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate() - day) -
    330 * 60000;
  return [1, 2].every((w) => {
    const group = cycles.filter((c) => {
      const t = new Date(c.resolvedAt).getTime();
      return t >= monday - w * 7 * 86400000 && t < monday - (w - 1) * 7 * 86400000;
    });
    return (
      group.length > 0 && group.reduce((sum, c) => sum + c.hours / c.slaHours, 0) / group.length > 1
    );
  });
}
