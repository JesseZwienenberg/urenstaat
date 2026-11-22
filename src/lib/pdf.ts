/** Builds the weekly "Urenstaat" PDF: plain A4, black on white. The content comes from timesheet.ts. */
import { jsPDF } from 'jspdf';
import autoTable, { type RowInput } from 'jspdf-autotable';
import type { WeekRecord } from '../types';
import { buildTimesheet, type Table, type TimesheetInput } from './timesheet';

export type PdfInput = TimesheetInput;

export function pdfFileName(week: WeekRecord): string {
  return `Urenstaat week ${week.isoWeek} ${week.isoYear}.pdf`;
}

const BLACK = 0;
const MARGIN = 15;

export function buildPdf(input: PdfInput): jsPDF {
  const sheet = buildTimesheet(input);
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });

  // Header
  doc.setTextColor(BLACK);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text(sheet.title, MARGIN, 20);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  let y = 28;
  for (const line of sheet.lines) {
    doc.text(line, MARGIN, y);
    y += 5.5;
  }
  y += 4.5;

  const tableStyle = {
    theme: 'grid' as const,
    margin: { left: MARGIN, right: MARGIN },
    styles: {
      font: 'helvetica',
      fontSize: 10,
      textColor: BLACK,
      lineColor: BLACK,
      lineWidth: 0.2,
      cellPadding: 2,
    },
    headStyles: { fillColor: 255, textColor: BLACK, fontStyle: 'bold' as const, lineWidth: 0.2 },
  };

  const body = (table: Table): RowInput[] =>
    table.rows.length > 0 ? table.rows : [[{ content: table.empty, colSpan: table.head.length }]];

  // Table 1: Uren
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(sheet.hours.title, MARGIN, y);
  autoTable(doc, {
    ...tableStyle,
    startY: y + 3,
    head: [sheet.hours.head],
    body: body(sheet.hours),
    columnStyles: { 0: { cellWidth: 34 }, 1: { cellWidth: 34 }, 3: { cellWidth: 20, halign: 'right' } },
  });

  // Table 2: Gebruikte materialen
  const afterHours = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  let toolsY = afterHours + 12;
  if (toolsY > 260) {
    doc.addPage();
    toolsY = 20;
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(sheet.tools.title, MARGIN, toolsY);
  autoTable(doc, {
    ...tableStyle,
    startY: toolsY + 3,
    head: [sheet.tools.head],
    body: body(sheet.tools),
    columnStyles: { 0: { cellWidth: 52 }, 1: { cellWidth: 30 }, 2: { cellWidth: 32 } },
  });

  return doc;
}
