import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

// rows: array of plain objects, same shape you want as column headers.
// Exports the FULL filtered/query result set passed in — independent of
// whatever page the table UI is currently showing.

export function exportRowsToExcel(rows, fileName, sheetName = 'Sheet1') {
  if (!rows || rows.length === 0) return;
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  XLSX.writeFile(workbook, fileName);
}

export function exportRowsToCsv(rows, fileName) {
  if (!rows || rows.length === 0) return;
  const header = Object.keys(rows[0]).join(',');
  const body = rows
    .map((r) => Object.values(r).map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');

  // Prepend a UTF-8 BOM (\uFEFF) — without it, Excel opens the CSV using the
  // system's default codepage instead of UTF-8, which is exactly what turned
  // "→" into "â†'" originally. This makes any future UTF-8 content in CSV
  // exports (currency symbols, accented names, etc.) render correctly too.
  const blob = new Blob(['\uFEFF' + header + '\n' + body], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

export function exportRowsToPdf(rows, fileName, title) {
  if (!rows || rows.length === 0) return;
  const doc = new jsPDF({ orientation: 'landscape' });
  if (title) {
    doc.setFontSize(14);
    doc.text(title, 14, 15);
  }
  const columns = Object.keys(rows[0]);
  const body = rows.map((r) => columns.map((c) => String(r[c] ?? '')));
  autoTable(doc, {
    head: [columns],
    body,
    startY: title ? 20 : 10,
    styles: { fontSize: 8 },
    headStyles: { fillColor: [13, 45, 94] },
  });
  doc.save(fileName);
}