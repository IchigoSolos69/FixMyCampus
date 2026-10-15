import { describe, expect, it } from 'vitest';
import type { ComplaintAction, Role, Status } from '@fixmycampus/shared';
import {
  nextStatus,
  canReadComplaint,
  referenceDate,
  deadline,
  priorityOrder,
  weeklyFlag,
  type WorkflowComplaint,
} from './workflow.js';

const reporter = { id: 1, role: 'Student' as Role, departmentId: null };
const incharge = { id: 2, role: 'Campus Incharge' as Role, departmentId: null };
const officer = { id: 3, role: 'Department Officer' as Role, departmentId: 10 };
const administrator = { id: 4, role: 'Administrator' as Role, departmentId: null };
const complaint = (status: Status, extra: Partial<WorkflowComplaint> = {}): WorkflowComplaint => ({
  status,
  reporter_id: 1,
  department_id: 10,
  emergency: false,
  resolved_at: null,
  ...extra,
});
const now = new Date('2026-10-16T12:00:00Z');
describe('complaint state machine', () => {
  it.each([
    ['Submitted', incharge, { action: 'verify' }, 'Verified'],
    [
      'Submitted',
      incharge,
      { action: 'return', reason: 'More location information needed' },
      'Returned',
    ],
    ['Verified', incharge, { action: 'return', reason: 'Clarify the damage' }, 'Returned'],
    ['Returned', incharge, { action: 'reject', reason: 'Duplicate complaint' }, 'Rejected'],
    ['Verified', incharge, { action: 'assign', departmentId: 10 }, 'Assigned'],
    ['In Progress', incharge, { action: 'assign', departmentId: 11 }, 'Assigned'],
    ['Returned', incharge, { action: 'priority', priority: 'High' }, 'Returned'],
    ['Assigned', officer, { action: 'start' }, 'In Progress'],
    ['Assigned', officer, { action: 'progress', note: 'Repair scheduled' }, 'Assigned'],
    ['In Progress', officer, { action: 'progress', note: 'Parts delivered' }, 'In Progress'],
    [
      'Assigned',
      officer,
      { action: 'resolve', summary: 'The wiring has been repaired.' },
      'Resolved',
    ],
    [
      'Verified',
      incharge,
      { action: 'escalate', reason: 'Immediate oversight needed' },
      'Verified',
    ],
    ['Returned', reporter, { action: 'resubmit' }, 'Submitted'],
  ] as const)('%s accepts %j and moves to %s', (from, user, action, to) => {
    expect(nextStatus(complaint(from), user, action as ComplaintAction, now)).toBe(to);
  });
  it.each([
    ['Submitted', reporter, { action: 'verify' }, 403],
    ['Submitted', administrator, { action: 'verify' }, 403],
    ['Submitted', incharge, { action: 'assign', departmentId: 10 }, 409],
    ['In Progress', incharge, { action: 'verify' }, 409],
    ['Submitted', officer, { action: 'start' }, 409],
    ['Assigned', { ...officer, departmentId: 11 }, { action: 'start' }, 403],
    ['In Progress', reporter, { action: 'resolve', summary: 'Everything is repaired' }, 403],
    ['Returned', officer, { action: 'resubmit' }, 403],
    ['Verified', incharge, { action: 'assign' }, 422],
    ['Assigned', officer, { action: 'progress', note: '   ' }, 422],
    ['In Progress', officer, { action: 'resolve', summary: 'Too short' }, 422],
    ['Submitted', incharge, { action: 'priority' }, 422],
  ] as const)('rejects invalid action or actor (%s)', (status, user, action, expected) => {
    expect(() => nextStatus(complaint(status), user, action as ComplaintAction, now)).toThrow(
      expect.objectContaining({ status: expected }),
    );
  });
  it.each(['return', 'reject', 'escalate'] as const)(
    'requires a nonblank reason for %s',
    (action) => {
      expect(() =>
        nextStatus(complaint('Submitted'), incharge, { action, reason: '   ' }, now),
      ).toThrow(expect.objectContaining({ status: 422 }));
    },
  );
  it.each(['Low', 'Medium', 'High'] as const)(
    'prevents emergency priority downgrade to %s',
    (priority) => {
      expect(() =>
        nextStatus(
          complaint('Assigned', { emergency: true }),
          incharge,
          { action: 'priority', priority },
          now,
        ),
      ).toThrow(expect.objectContaining({ status: 422 }));
    },
  );
  it('allows Critical priority on an emergency', () => {
    expect(
      nextStatus(
        complaint('Assigned', { emergency: true }),
        incharge,
        { action: 'priority', priority: 'Critical' },
        now,
      ),
    ).toBe('Assigned');
  });
  it.each([
    'verify',
    'return',
    'reject',
    'assign',
    'priority',
    'start',
    'progress',
    'resolve',
    'escalate',
    'resubmit',
  ] as const)('keeps resolved records immutable for %s', (action) => {
    expect(() => nextStatus(complaint('Resolved'), incharge, { action }, now)).toThrow(
      expect.objectContaining({ status: 409 }),
    );
  });
  it('keeps rejected records terminal', () => {
    expect(() => nextStatus(complaint('Rejected'), reporter, { action: 'resubmit' }, now)).toThrow(
      expect.objectContaining({ status: 409 }),
    );
  });
  it('never treats two missing department ids as an officer assignment', () => {
    expect(() =>
      nextStatus(
        complaint('Assigned', { department_id: null }),
        { ...officer, departmentId: null },
        { action: 'start' },
        now,
      ),
    ).toThrow(expect.objectContaining({ status: 403 }));
  });
});
describe('72-hour reopening window', () => {
  it('includes the exact 72-hour boundary', () => {
    expect(
      nextStatus(
        complaint('Resolved', { resolved_at: '2026-10-13 12:00:00' }),
        reporter,
        { action: 'reopen', reason: 'The issue returned' },
        now,
      ),
    ).toBe('Assigned');
  });
  it('excludes a timestamp one millisecond beyond the boundary', () => {
    expect(() =>
      nextStatus(
        complaint('Resolved', { resolved_at: '2026-10-13 11:59:59.999' }),
        reporter,
        { action: 'reopen', reason: 'The issue returned' },
        now,
      ),
    ).toThrow(expect.objectContaining({ status: 409 }));
  });
  it('applies the same boundary to Date instances', () => {
    expect(() =>
      nextStatus(
        complaint('Resolved', { resolved_at: new Date('2026-10-13T11:59:59.999Z') }),
        reporter,
        { action: 'reopen', reason: 'The issue returned' },
        now,
      ),
    ).toThrow(expect.objectContaining({ status: 409 }));
  });
  it.each([null, 'invalid timestamp', '2026-10-17 12:00:00'])(
    'rejects an unusable resolution timestamp %s',
    (resolved_at) => {
      expect(() =>
        nextStatus(
          complaint('Resolved', { resolved_at }),
          reporter,
          { action: 'reopen', reason: 'The issue returned' },
          now,
        ),
      ).toThrow(expect.objectContaining({ status: 409 }));
    },
  );
  it('requires the original reporter and a reason', () => {
    const c = complaint('Resolved', { resolved_at: now });
    expect(() => nextStatus(c, incharge, { action: 'reopen', reason: 'Reopen' }, now)).toThrow(
      expect.objectContaining({ status: 403 }),
    );
    expect(() => nextStatus(c, reporter, { action: 'reopen' }, now)).toThrow(
      expect.objectContaining({ status: 422 }),
    );
  });
});
describe('complaint visibility', () => {
  it.each([false, true])(
    'restricts detail access independent of confidential=%s',
    (confidential) => {
      const c = { reporter_id: 1, department_id: 10, confidential };
      expect(canReadComplaint(reporter, c)).toBe(true);
      expect(canReadComplaint(incharge, c)).toBe(true);
      expect(canReadComplaint(officer, c)).toBe(true);
      expect(canReadComplaint(administrator, c)).toBe(false);
      expect(canReadComplaint({ ...officer, departmentId: 11 }, c)).toBe(false);
      expect(canReadComplaint({ ...reporter, id: 99 }, c)).toBe(false);
    },
  );
  it('does not expose unassigned complaints to an officer without a department', () => {
    expect(
      canReadComplaint(
        { ...officer, departmentId: null },
        { reporter_id: 1, department_id: null, confidential: true },
      ),
    ).toBe(false);
  });
});
describe('dates and priority', () => {
  it('generates daily reference keys at IST midnight', () => {
    expect(referenceDate(new Date('2026-10-15T18:29:59Z'))).toBe('20261015');
    expect(referenceDate(new Date('2026-10-15T18:30:00Z'))).toBe('20261016');
  });
  it('adds elapsed calendar hours without mutating the start time', () => {
    const start = new Date(now);
    expect(deadline(start, 72).toISOString()).toBe('2026-10-19T12:00:00.000Z');
    expect(start).toEqual(now);
  });
  it('sorts Critical before High, Medium, and Low', () => {
    expect(
      ['Low', 'High', 'Critical', 'Medium'].sort(
        (a, b) => priorityOrder(a as 'Low') - priorityOrder(b as 'Low'),
      ),
    ).toEqual(['Critical', 'High', 'Medium', 'Low']);
  });
});
describe('two-week department flag', () => {
  const cycle = (resolvedAt: string, hours = 30, slaHours = 24) => ({
    resolvedAt,
    hours,
    slaHours,
  });
  it('requires breach averages in both completed IST calendar weeks', () => {
    expect(weeklyFlag([cycle('2026-10-06T00:00:00Z'), cycle('2026-09-29T00:00:00Z')], now)).toBe(
      true,
    );
    expect(weeklyFlag([cycle('2026-10-06T00:00:00Z')], now)).toBe(false);
    expect(weeklyFlag([], now)).toBe(false);
  });
  it('ignores the incomplete current week', () => {
    expect(weeklyFlag([cycle('2026-10-14T00:00:00Z'), cycle('2026-10-06T00:00:00Z')], now)).toBe(
      false,
    );
  });
  it('uses normalized per-cycle ratios and treats an average exactly one as compliant', () => {
    expect(
      weeklyFlag(
        [
          cycle('2026-10-06T00:00:00Z', 36, 24),
          cycle('2026-10-07T00:00:00Z', 12, 24),
          cycle('2026-09-29T00:00:00Z', 100, 24),
        ],
        now,
      ),
    ).toBe(false);
  });
  it('uses the IST Monday boundary rather than UTC midnight', () => {
    expect(weeklyFlag([cycle('2026-10-04T18:30:00Z'), cycle('2026-09-27T18:30:00Z')], now)).toBe(
      true,
    );
  });
});
