/**
 * Payroll-ready PDF export (FR-10).
 *
 * jsPDF is loaded lazily on click: it is a large dependency and has no place
 * in the dashboard's initial bundle.
 *
 * UNICODE NOTE: jsPDF's built-in fonts are Latin-1 only, so Bangla employee
 * names would render as blanks. `registerBanglaFont` accepts a base64 TTF and
 * wires it up. Until a font is supplied, names are transliterated-safe ASCII
 * from the API, and `hasBanglaText` warns the user rather than silently
 * producing an empty cell.
 */
import type { AttendanceLog } from '@/types/models';
import { formatDate, formatTime, toDhakaDateKey } from './tz';
import { checkTypeLabel, STATUS_LABEL } from './format';
import { FACE_MATCH_THRESHOLD } from './constants';

let banglaFontBase64: string | null = null;

/** Supply a Noto Sans Bengali TTF as base64 to enable Bangla names in PDFs. */
export function registerBanglaFont(base64Ttf: string): void {
  banglaFontBase64 = base64Ttf;
}

export function hasBanglaText(value: string): boolean {
  return /[\u0980-\u09FF]/.test(value);
}

export interface PdfReportOptions {
  title: string;
  subtitle?: string;
  fromDate: string;
  toDate: string;
  officeName?: string;
  preparedBy?: string;
}

export async function exportAttendancePdf(
  logs: AttendanceLog[],
  options: PdfReportOptions,
): Promise<void> {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);

  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  let bodyFont = 'helvetica';

  if (banglaFontBase64) {
    doc.addFileToVFS('NotoSansBengali.ttf', banglaFontBase64);
    doc.addFont('NotoSansBengali.ttf', 'NotoSansBengali', 'normal');
    bodyFont = 'NotoSansBengali';
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text(options.title, 40, 44);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(90);
  const metaLines = [
    `Period: ${formatDate(options.fromDate)} to ${formatDate(options.toDate)}  (Asia/Dhaka)`,
    options.officeName ? `Office: ${options.officeName}` : 'Office: All locations',
    `Records: ${logs.length}   Auto-approval threshold: ${FACE_MATCH_THRESHOLD}%`,
    `Generated: ${formatDate(new Date())} ${formatTime(new Date())}${options.preparedBy ? `  by ${options.preparedBy}` : ''}`,
  ];
  metaLines.forEach((line, index) => doc.text(line, 40, 62 + index * 13));

  autoTable(doc, {
    startY: 62 + metaLines.length * 13 + 10,
    head: [['Employee ID', 'Employee', 'Office', 'Date', 'Time', 'Type', 'Match %', 'Status']],
    body: logs.map((log) => [
      log.employee_code ?? '',
      log.employee_name ?? '',
      log.office_name ?? '',
      toDhakaDateKey(log.timestamp),
      formatTime(log.timestamp),
      checkTypeLabel(log.check_type),
      log.face_match_score.toFixed(1),
      STATUS_LABEL[log.status],
    ]),
    styles: { font: bodyFont, fontSize: 8, cellPadding: 4, textColor: 30 },
    headStyles: { fillColor: [15, 27, 45], textColor: 255, fontStyle: 'bold', font: 'helvetica' },
    alternateRowStyles: { fillColor: [245, 247, 250] },
    columnStyles: {
      6: { halign: 'right' },
    },
    didParseCell: (hookData) => {
      // Mark below-threshold matches so payroll sees the exceptions at a glance.
      if (hookData.section === 'body' && hookData.column.index === 6) {
        const score = Number(hookData.cell.raw);
        if (!Number.isNaN(score) && score < FACE_MATCH_THRESHOLD) {
          hookData.cell.styles.textColor = [179, 38, 30];
          hookData.cell.styles.fontStyle = 'bold';
        }
      }
    },
    margin: { left: 40, right: 40 },
  });

  doc.save(`pnsm-attendance-${toDhakaDateKey(options.fromDate)}-to-${toDhakaDateKey(options.toDate)}.pdf`);
}
