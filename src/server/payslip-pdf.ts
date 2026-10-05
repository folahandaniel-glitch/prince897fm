import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

type Line = { label: string; amount: number; detail?: { label: string; amount: number }[] };
export interface PayslipView {
  period: string; gross: number; totalDeductions: number; net: number; currency: string;
  org: { name: string }; employee: Record<string, any>;
  details: { earnings: Line[]; deductions: (Line & { kind?: string })[]; employer: Line[]; tax: { annualGross: number; taxable: number } };
  logoPath?: string; footer?: string;
}

// The standard PDF fonts cannot print the naira sign, so amounts are written as "NGN 1,234.56".
const money = (minor: number, cur: string) => `${cur === 'NGN' ? 'NGN' : cur} ${(minor / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const ascii = (s: string) => s.replace(/[^\x20-\x7E]/g, '?');
const monthName = (p: string) => new Date(`${p}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

export async function buildPayslipPdf(v: PayslipView): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Payslip ${v.period} - ${v.employee.name}`);
  pdf.setProducer('WorkSuite'); pdf.setCreator('WorkSuite');
  const page = pdf.addPage([595.28, 841.89]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 595.28, M = 40;
  const ink = rgb(0.07, 0.09, 0.12), muted = rgb(0.4, 0.43, 0.5), line = rgb(0.85, 0.87, 0.9), brand = rgb(0.07, 0.07, 0.07);
  let y = 800;

  page.drawRectangle({ x: 0, y: 770, width: W, height: 72, color: brand });
  let x = M;
  if (v.logoPath) {
    try {
      const bytes = fs.readFileSync(v.logoPath);
      const img = v.logoPath.endsWith('.png') ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
      const h = 54; page.drawImage(img, { x: M, y: 779, width: (img.width / img.height) * h, height: h }); x = M + (img.width / img.height) * h + 14;
    } catch { /* logo is optional */ }
  }
  page.drawText(ascii(v.org.name), { x, y: 810, size: 16, font: bold, color: rgb(1, 1, 1) });
  page.drawText('PAYSLIP', { x, y: 790, size: 11, font, color: rgb(1, 0.78, 0) });
  page.drawText(ascii(monthName(v.period)), { x: W - M - 140, y: 800, size: 13, font: bold, color: rgb(1, 1, 1) });
  y = 745;

  const kv = (label: string, value: string, cx: number, cy: number) => { page.drawText(label, { x: cx, y: cy, size: 8, font, color: muted }); page.drawText(ascii(value || '-'), { x: cx, y: cy - 12, size: 10, font: bold, color: ink }); };
  kv('EMPLOYEE', v.employee.name, M, y); kv('EMPLOYEE NO.', v.employee.number, 250, y); kv('DEPARTMENT', v.employee.department, 380, y);
  y -= 34; kv('POSITION', v.employee.position, M, y); kv('BANK', [v.employee.bankName, v.employee.bankAccount ? `****${String(v.employee.bankAccount).slice(-4)}` : ''].filter(Boolean).join(' '), 250, y); kv('TAX ID', v.employee.taxId, 380, y);
  y -= 30; page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.7, color: line }); y -= 22;

  const section = (title: string, rows: Line[], totalLabel: string, total: number) => {
    page.drawText(title, { x: M, y, size: 10, font: bold, color: ink }); y -= 16;
    for (const r of rows) {
      page.drawText(ascii(r.label).slice(0, 70), { x: M, y, size: 9.5, font, color: ink });
      const t = money(r.amount, v.currency); page.drawText(t, { x: W - M - font.widthOfTextAtSize(t, 9.5), y, size: 9.5, font, color: ink }); y -= 14;
      for (const d of r.detail ?? []) {
        page.drawText(ascii(d.label).slice(0, 80), { x: M + 14, y, size: 8, font, color: muted });
        const dt = money(d.amount, v.currency); page.drawText(dt, { x: W - M - 90 - font.widthOfTextAtSize(dt, 8), y, size: 8, font, color: muted }); y -= 11;
      }
    }
    page.drawLine({ start: { x: M, y: y + 6 }, end: { x: W - M, y: y + 6 }, thickness: 0.5, color: line }); y -= 6;
    page.drawText(totalLabel, { x: M, y, size: 10, font: bold, color: ink });
    const tt = money(total, v.currency); page.drawText(tt, { x: W - M - bold.widthOfTextAtSize(tt, 10), y, size: 10, font: bold, color: ink }); y -= 26;
  };
  section('EARNINGS', v.details.earnings, 'Gross pay', v.gross);
  section('DEDUCTIONS', v.details.deductions.length ? v.details.deductions : [{ label: 'None', amount: 0 }], 'Total deductions', v.totalDeductions);

  page.drawRectangle({ x: M, y: y - 8, width: W - 2 * M, height: 34, color: rgb(1, 0.97, 0.85), borderColor: rgb(0.9, 0.75, 0.1), borderWidth: 1 });
  page.drawText('NET PAY', { x: M + 12, y: y + 3, size: 12, font: bold, color: ink });
  const nt = money(v.net, v.currency); page.drawText(nt, { x: W - M - 12 - bold.widthOfTextAtSize(nt, 14), y: y + 2, size: 14, font: bold, color: ink }); y -= 40;

  if (v.details.employer.length) {
    page.drawText('EMPLOYER CONTRIBUTIONS (not deducted from your pay)', { x: M, y, size: 8.5, font: bold, color: muted }); y -= 13;
    for (const r of v.details.employer) { page.drawText(ascii(r.label), { x: M, y, size: 8.5, font, color: muted }); const t = money(r.amount, v.currency); page.drawText(t, { x: W - M - font.widthOfTextAtSize(t, 8.5), y, size: 8.5, font, color: muted }); y -= 12; }
    y -= 6;
  }
  page.drawText(`Income tax is calculated on annualised taxable pay of ${money(v.details.tax.taxable, v.currency)}.`, { x: M, y, size: 8, font, color: muted }); y -= 11;
  page.drawText('If you believe anything on this payslip is wrong, contact HR within 14 days. Deductions may be queried in writing.', { x: M, y, size: 8, font, color: muted });
  page.drawLine({ start: { x: M, y: 50 }, end: { x: W - M, y: 50 }, thickness: 0.5, color: line });
  page.drawText(ascii(v.footer ?? 'Computer-generated payslip. Confidential.'), { x: M, y: 36, size: 8, font, color: muted });
  return pdf.save();
}

export function logoFor(iconBase?: string): string | undefined {
  if (!iconBase) return undefined;
  const p = path.join(process.cwd(), 'public', `${iconBase.replace(/^\//, '')}-192.png`);
  return fs.existsSync(p) ? p : undefined;
}
