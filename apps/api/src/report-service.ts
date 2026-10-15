import type { User, Dashboard, Report } from '@fixmycampus/shared';
import { rows, iso } from './db.js';
import { complaintVisibility, listComplaints } from './complaint-service.js';
import { weeklyFlag, istDateBoundary } from './workflow.js';
import { HttpError } from './errors.js';
export function median(numbers: number[]) {
  if (!numbers.length) return null;
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
export async function dashboard(user: User): Promise<Dashboard> {
  const admin = user.role === 'Administrator';
  const scope = admin ? { sql: '1=1', values: [] } : complaintVisibility(user);
  const [total] = await rows<any>(
    `SELECT COUNT(*) total,SUM(c.status NOT IN ('Resolved','Rejected')) open,SUM(c.status='Resolved') resolved,SUM(c.status NOT IN ('Resolved','Rejected') AND r.due_at<UTC_TIMESTAMP(3)) overdue FROM complaints c JOIN resolution_cycles r ON r.complaint_id=c.id AND r.cycle_number=c.cycle_number WHERE c.deleted_at IS NULL AND ${scope.sql}`,
    scope.values,
  );
  const countsByStatus = await rows<any>(
    `SELECT c.status,COUNT(*) count FROM complaints c WHERE c.deleted_at IS NULL AND ${scope.sql} GROUP BY c.status`,
    scope.values,
  );
  const countsByPriority = await rows<any>(
    `SELECT c.priority,COUNT(*) count FROM complaints c WHERE c.deleted_at IS NULL AND ${scope.sql} GROUP BY c.priority`,
    scope.values,
  );
  const cycles = await rows<any>(
    `SELECT r.department_id,r.resolved_at,r.sla_hours,TIMESTAMPDIFF(SECOND,r.started_at,r.resolved_at)/3600 hours FROM resolution_cycles r JOIN complaints c ON c.id=r.complaint_id WHERE r.resolved_at IS NOT NULL AND c.deleted_at IS NULL AND ${scope.sql}`,
    scope.values,
  );
  const hours = cycles.map((c) => Number(c.hours));
  const departments = [];
  if (admin) {
    const depts = await rows<any>(
      'SELECT d.id,d.name,COUNT(DISTINCT c.id) count,MAX(f.average_rating) average_rating FROM departments d LEFT JOIN complaints c ON c.department_id=d.id AND c.deleted_at IS NULL LEFT JOIN (SELECT department_id,AVG(rating) average_rating FROM feedback GROUP BY department_id) f ON f.department_id=d.id GROUP BY d.id,d.name ORDER BY d.name',
    );
    for (const d of depts) {
      const group = cycles.filter((c) => Number(c.department_id) === Number(d.id));
      departments.push({
        id: Number(d.id),
        name: d.name,
        count: Number(d.count),
        averageHours: group.length
          ? group.reduce((s, c) => s + Number(c.hours), 0) / group.length
          : null,
        averageRating: d.average_rating === null ? null : Number(d.average_rating),
        slaCompliance: group.length
          ? (100 * group.filter((c) => Number(c.hours) <= Number(c.sla_hours)).length) /
            group.length
          : null,
        flagged: weeklyFlag(
          group.map((c) => ({
            resolvedAt: iso(c.resolved_at),
            hours: Number(c.hours),
            slaHours: Number(c.sla_hours),
          })),
        ),
      });
    }
  }
  return {
    total: Number(total.total),
    open: Number(total.open || 0),
    overdue: Number(total.overdue || 0),
    resolved: Number(total.resolved || 0),
    countsByStatus: countsByStatus.map((v) => ({ status: v.status, count: Number(v.count) })),
    countsByPriority: countsByPriority.map((v) => ({
      priority: v.priority,
      count: Number(v.count),
    })),
    averageResolutionHours: hours.length ? hours.reduce((s, v) => s + v, 0) / hours.length : null,
    medianResolutionHours: median(hours),
    departments,
    recent: admin ? [] : (await listComplaints(user, { pageSize: 6 })).items,
  };
}
export async function generateReport(user: User, query: Record<string, unknown>): Promise<Report> {
  const type = String(query.type || 'category');
  if (!['category', 'department', 'status', 'sla'].includes(type))
    throw new HttpError(422, 'Choose a valid report type.');
  if (user.role !== 'Administrator' && !(user.role === 'Campus Incharge' && type === 'category'))
    throw new HttpError(403, 'You do not have permission to view this report.');
  const conditions = ['c.deleted_at IS NULL'];
  const values: unknown[] = [];
  for (const [field, op] of [
    ['from', '>='],
    ['to', '<'],
  ] as const)
    if (query[field]) {
      conditions.push(`c.created_at${op}?`);
      values.push(istDateBoundary(query[field], field === 'to'));
    }
  const label =
    type === 'category'
      ? 'cat.name'
      : type === 'status'
        ? 'c.status'
        : "COALESCE(d.name,'Unassigned')";
  const data = await rows<any>(
    `SELECT ${label} label,COUNT(*) count,SUM(c.status='Resolved') resolved FROM complaints c JOIN categories cat ON cat.id=c.category_id LEFT JOIN departments d ON d.id=c.department_id WHERE ${conditions.join(' AND ')} GROUP BY ${label} ORDER BY label`,
    values,
  );
  const metrics = await rows<any>(
    `SELECT ${label} label,AVG(TIMESTAMPDIFF(SECOND,r.started_at,r.resolved_at)/3600) average_hours,100*AVG(r.resolved_at<=r.due_at) sla_compliance FROM resolution_cycles r JOIN complaints c ON c.id=r.complaint_id JOIN categories cat ON cat.id=c.category_id LEFT JOIN departments d ON d.id=${type === 'department' || type === 'sla' ? 'r.department_id' : 'c.department_id'} WHERE r.resolved_at IS NOT NULL AND ${conditions.join(' AND ')} GROUP BY ${label}`,
    values,
  );
  const grouped = new Map(
    data.map((r) => [
      r.label,
      {
        label: r.label,
        count: Number(r.count),
        resolved: Number(r.resolved),
        averageHours: null as number | null,
        slaCompliance: null as number | null,
      },
    ]),
  );
  for (const m of metrics) {
    const row = grouped.get(m.label) || {
      label: m.label,
      count: 0,
      resolved: 0,
      averageHours: null,
      slaCompliance: null,
    };
    row.averageHours = m.average_hours === null ? null : Number(m.average_hours);
    row.slaCompliance = m.sla_compliance === null ? null : Number(m.sla_compliance);
    grouped.set(m.label, row);
  }
  return {
    type: type as Report['type'],
    from: query.from ? String(query.from) : null,
    to: query.to ? String(query.to) : null,
    rows: [...grouped.values()].sort((a, b) => a.label.localeCompare(b.label)),
  };
}
export function csvCell(value: unknown) {
  let text = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
export function reportCsv(report: Report) {
  return (
    '\uFEFF' +
    [
      ['Group', 'Complaints', 'Resolved', 'Average resolution hours', 'SLA compliance (%)'],
      ...report.rows.map((r) => [
        r.label,
        r.count,
        r.resolved,
        r.averageHours?.toFixed(2) || '',
        r.slaCompliance?.toFixed(2) || '',
      ]),
    ]
      .map((row) => row.map(csvCell).join(','))
      .join('\r\n')
  );
}
