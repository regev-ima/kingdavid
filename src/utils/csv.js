// Tiny CSV utility — no deps. We export Hebrew columns so Excel needs the
// UTF-8 BOM to detect the encoding correctly; without it Hebrew shows as
// mojibake on Windows.

const BOM = '﻿';

function escapeCell(raw) {
  if (raw === null || raw === undefined) return '';
  const value = typeof raw === 'string' ? raw : String(raw);
  // RFC 4180: quote if value contains ", , or newlines; double any quote.
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Build a CSV string from an array of rows.
 * @param {Array<object>} rows
 * @param {Array<{header: string, value: (row: object) => any}>} columns
 */
export function toCsv(rows, columns) {
  const headerLine = columns.map((c) => escapeCell(c.header)).join(',');
  const dataLines = rows.map((row) =>
    columns.map((c) => escapeCell(c.value(row))).join(','),
  );
  return [headerLine, ...dataLines].join('\r\n');
}

export function downloadCsv(filename, csv) {
  const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Defer revoke a tick so Safari finishes the download before the URL dies.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
