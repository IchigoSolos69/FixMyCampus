import { beforeEach, describe, expect, it, vi } from 'vitest';
const { mockRows } = vi.hoisted(() => ({ mockRows: vi.fn() }));
vi.mock('./db.js', () => ({ rows: mockRows, iso: (v: string) => new Date(v).toISOString() }));
vi.mock('./complaint-service.js', () => ({
  complaintVisibility: (u: any) => ({
    sql: u.role === 'Campus Incharge' ? '1=1' : 'c.reporter_id=?',
    values: u.role === 'Campus Incharge' ? [] : [u.id],
  }),
  listComplaints: vi.fn(async () => ({ items: [] })),
}));
import { dashboard, generateReport, median, csvCell, reportCsv } from './report-service.js';
import type { User, Report } from '@fixmycampus/shared';
const user = { id: 1, role: 'Administrator' } as User;
beforeEach(() => vi.clearAllMocks());
describe('report calculations and exports', () => {
  it('calculates odd/even medians without changing input', () => {
    const input = [8, 2, 4];
    expect(median(input)).toBe(4);
    expect(input).toEqual([8, 2, 4]);
    expect(median([8, 2, 4, 6])).toBe(5);
    expect(median([])).toBeNull();
  });
  it('escapes quoted CSV and protects spreadsheet formula cells', () => {
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    for (const value of ['=SUM(A1)', '+1', '-1', '@test', '\tmacro', '\rformula'])
      expect(csvCell(value)).toBe(`"'${value}"`);
    expect(csvCell(null)).toBe('""');
  });
  it('generates a real UTF-8 report with empty and decimal fields', () => {
    const report = {
      type: 'category',
      from: null,
      to: null,
      rows: [
        {
          label: 'Electrical, power',
          count: 2,
          resolved: 1,
          averageHours: 2.456,
          slaCompliance: 50,
        },
        { label: 'No resolution', count: 1, resolved: 0, averageHours: null, slaCompliance: null },
      ],
    } satisfies Report;
    const csv = reportCsv(report);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('"2.46"');
    expect(csv).toContain('"Electrical, power"');
    expect(csv).toContain('"No resolution","1","0","",""');
  });
  it('rejects invalid report types and unauthorized report scope', async () => {
    await expect(generateReport(user, { type: 'users' })).rejects.toMatchObject({ status: 422 });
    await expect(
      generateReport({ ...user, role: 'Student' }, { type: 'category' }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      generateReport({ ...user, role: 'Campus Incharge' }, { type: 'sla' }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('applies IST inclusive date filters with safe parameters', async () => {
    mockRows.mockResolvedValue([
      { label: 'IT', count: '3', resolved: '2', average_hours: '1.5', sla_compliance: '50' },
    ]);
    const result = await generateReport(user, {
      type: 'sla',
      from: '2026-10-01',
      to: '2026-10-02',
    });
    expect(result.rows[0]).toEqual({
      label: 'IT',
      count: 3,
      resolved: 2,
      averageHours: 1.5,
      slaCompliance: 50,
    });
    const params = mockRows.mock.calls[0][1];
    expect(params.map((d: Date) => d.toISOString())).toEqual([
      '2026-09-30T18:30:00.000Z',
      '2026-10-02T18:30:00.000Z',
    ]);
    await expect(generateReport(user, { from: 'DROP TABLE' })).rejects.toMatchObject({
      status: 422,
    });
  });
  it('provides only the category summary to Incharge', async () => {
    mockRows.mockResolvedValue([
      { label: 'Classroom', count: 1, resolved: 0, average_hours: null, sla_compliance: null },
    ]);
    const result = await generateReport({ ...user, role: 'Campus Incharge' }, {});
    expect(result.type).toBe('category');
    expect(result.rows[0].averageHours).toBeNull();
    expect(result.from).toBeNull();
  });
  it('calculates admin metrics without exposing recent confidential details', async () => {
    mockRows
      .mockResolvedValueOnce([{ total: 3, open: 1, resolved: 2, overdue: 1 }])
      .mockResolvedValueOnce([{ status: 'Resolved', count: 2 }])
      .mockResolvedValueOnce([{ priority: 'Critical', count: 1 }])
      .mockResolvedValueOnce([
        { department_id: 4, resolved_at: '2026-10-10T00:00:00Z', sla_hours: 24, hours: 12 },
        { department_id: 4, resolved_at: '2026-10-11T00:00:00Z', sla_hours: 24, hours: 36 },
      ])
      .mockResolvedValueOnce([{ id: 4, name: 'IT', count: 3, average_rating: 4.5 }]);
    const result = await dashboard(user);
    expect(result.averageResolutionHours).toBe(24);
    expect(result.medianResolutionHours).toBe(24);
    expect(result.recent).toEqual([]);
    expect(result.departments[0]).toMatchObject({
      count: 3,
      slaCompliance: 50,
      averageRating: 4.5,
    });
  });
  it('returns usable empty dashboard metrics for a new reporter', async () => {
    mockRows
      .mockResolvedValueOnce([{ total: 0, open: null, resolved: null, overdue: null }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const result = await dashboard({ ...user, role: 'Student' });
    expect(result.open).toBe(0);
    expect(result.averageResolutionHours).toBeNull();
    expect(result.departments).toEqual([]);
  });
});
