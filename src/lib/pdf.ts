/** Builds the weekly "Urenstaat" PDF: plain A4, black on white. */
import { jsPDF } from 'jspdf';
import autoTable, { type RowInput } from 'jspdf-autotable';
import type { Settings, Tool, WeekRecord, WorkLocation } from '../types';
import { formatDate, formatDayDate, formatHours } from './format';
import { weekDates } from './week';

export interface PdfInput {
  week: WeekRecord;
  settings: Settings;
  locations: WorkLocation[];
  tools: Tool[];
}

export function pdfFileName(week: WeekRecord): string {
  return `Urenstaat week ${week.isoWeek} ${week.isoYear}.pdf`;
}

const BLACK = 0;
const MARGIN = 15;

export function buildPdf({ week, settings, locations, tools }: PdfInput): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const dates = weekDates(week);
  const locationById = new Map(locations.map((l) => [l.id, l]));
  const toolById = new Map(tools.map((t) => [t.id, t]));

  // Header
  doc.setTextColor(BLACK);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text(`Urenstaat week ${week.isoWeek} ${week.isoYear}`, MARGIN, 20);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  let y = 28;
  for (const line of [settings.name, settings.company].filter((s) => s.trim() !== '')) {
    doc.text(line, MARGIN, y);
    y += 5.5;
  }
  doc.text(`${formatDate(dates[0])} t/m ${formatDate(dates[6])}`, MARGIN, y);
  y += 10;

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

  // Table 1: Uren
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('Uren', MARGIN, y);

  const hourRows: RowInput[] = [];
  for (const date of dates) {
    for (const entry of week.days[date]?.entries ?? []) {
      const location = locationById.get(entry.locationId);
      hourRows.push([
        formatDayDate(date),
        location?.werknummer ?? '',
        location?.address ?? '',
        formatHours(entry.hours),
      ]);
    }
  }
  if (hourRows.length === 0) hourRows.push([{ content: 'Geen uren ingevuld', colSpan: 4 }]);

  autoTable(doc, {
    ...tableStyle,
    startY: y + 3,
    head: [['Datum', 'Werknummer', 'Adres', 'Uren']],
    body: hourRows,
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
  doc.text('Gebruikte materialen', MARGIN, toolsY);

  const toolRows: RowInput[] = week.tools
    .filter((usage) => toolById.has(usage.toolId))
    .map((usage) => {
      const location = locationById.get(usage.locationId);
      return [
        toolById.get(usage.toolId)!.name,
        location?.werknummer ?? '',
        location?.address ?? '',
      ];
    });
  if (toolRows.length === 0) {
    toolRows.push([{ content: 'Geen materialen ingevuld', colSpan: 3 }]);
  }

  autoTable(doc, {
    ...tableStyle,
    startY: toolsY + 3,
    head: [['Materiaal', 'Werknummer', 'Adres']],
    body: toolRows,
    columnStyles: { 0: { cellWidth: 60 }, 1: { cellWidth: 34 } },
  });

  return doc;
}
