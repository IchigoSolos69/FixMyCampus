import { Router } from 'express';
import PDFDocument from 'pdfkit';
import { requireAuth } from './auth.js';
import { dashboard, generateReport, reportCsv } from './report-service.js';
import { HttpError } from './errors.js';
export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);
dashboardRouter.get('/', async (req, res) => {
  res.json(await dashboard(req.user!));
});
export const reportRouter = Router();
reportRouter.use(requireAuth);
reportRouter.get('/', async (req, res) => {
  res.json(await generateReport(req.user!, req.query));
});
reportRouter.get('/export', async (req, res) => {
  if (req.user!.role !== 'Administrator')
    throw new HttpError(403, 'Only Administrators can export reports.');
  const report = await generateReport(req.user!, req.query);
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.query.format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="fixmycampus-${report.type}.csv"`);
    res.send(reportCsv(report));
    return;
  }
  if (req.query.format !== 'pdf') throw new HttpError(422, 'Choose CSV or PDF format.');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="fixmycampus-${report.type}.pdf"`);
  const doc = new PDFDocument({
    size: 'A4',
    margin: 40,
    info: { Title: 'FixMyCampus complaint report' },
  });
  doc.pipe(res);
  const header = () => {
    doc.fontSize(22).fillColor('#172F3E').text('FixMyCampus');
    doc
      .moveDown(0.4)
      .fontSize(13)
      .text(`${report.type[0].toUpperCase() + report.type.slice(1)} report`);
    doc
      .fontSize(9)
      .fillColor('#4D6370')
      .text(
        `Period: ${report.from || 'All dates'} to ${report.to || 'Present'} | Generated: ${new Date().toISOString()}`,
      );
    doc.moveDown();
  };
  header();
  for (const row of report.rows) {
    if (doc.y > 710) {
      doc.addPage();
      header();
    }
    doc.fontSize(11).fillColor('#172F3E').text(row.label);
    doc
      .fontSize(10)
      .fillColor('#4D6370')
      .text(
        `${row.count} complaints | ${row.resolved} resolved | Average: ${row.averageHours?.toFixed(1) ?? '—'} hours | SLA: ${row.slaCompliance?.toFixed(1) ?? '—'}%`,
      );
    doc.moveDown(0.8);
  }
  if (!report.rows.length) doc.text('No complaints match this date range.');
  doc.end();
});
