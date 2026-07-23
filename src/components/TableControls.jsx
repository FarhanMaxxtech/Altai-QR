import React from 'react';
import '../styles/TableControls.css';

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

// Reusable "Show [N] entries ... [Excel][CSV][PDF]" toolbar, same visual
// language as ProductListing's toolbar. Drop this above any table.
export default function TableControls({
  pageSize,
  onPageSizeChange,
  onExportExcel,
  onExportCsv,
  onExportPdf,
  disabled = false,
}) {
  return (
    <div className="listing-toolbar">
      <div className="entries-control">
        <span>Show</span>
        <select
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
        >
          {PAGE_SIZE_OPTIONS.map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
        <span>entries</span>
      </div>

      <div className="export-buttons">
        <button type="button" onClick={onExportExcel} disabled={disabled}>Export Excel</button>
        <button type="button" onClick={onExportCsv} disabled={disabled}>Export CSV</button>
        <button type="button" onClick={onExportPdf} disabled={disabled}>Export PDF</button>
      </div>
    </div>
  );
}