import { zipSync } from 'fflate';

import { getReceiptFile } from '../api/cache';
import type { Business, Invoice } from '../types';

// The monthly accountant report is assembled entirely in the browser from the cached
// invoice list and receipt files, then handed to the OS share sheet (or downloaded),
// so sending it costs no email service and usually no backend calls at all.

export interface AccountantReport {
  invoiceCount: number;
  total: number;
  files: File[];
  zip: File;
  shareText: string;
}

// Chrome's share sheet re-checks each file's MIME type against an allowlist only when
// share() runs (canShare doesn't), so a receipt stored as e.g. application/octet-stream
// would fail the whole share. Derive the type from the extension instead.
const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  pdf: 'application/pdf',
};

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function localDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function safeName(value: string): string {
  return value.replace(/[^\p{L}\p{N}_-]+/gu, '_').replace(/^_+|_+$/g, '') || 'receipt';
}

export function invoicesInMonth(invoices: Invoice[], month: number, year: number): Invoice[] {
  return invoices
    .filter((inv) => {
      const d = new Date(inv.date);
      return d.getFullYear() === year && d.getMonth() + 1 === month;
    })
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

function buildCsv(business: Business | null, period: string, invoices: Invoice[], total: number) {
  const rows = [
    ['SmartReceipt Monthly Expense Report'],
    [`Business: ${business?.name ?? ''}`, `Tax ID: ${business?.tax_id ?? ''}`],
    [`Period: ${period}`],
    [],
    ['Date', 'Vendor', 'Category', 'Tax ID', 'Amount', 'Source'],
    ...invoices.map((inv) => [
      localDate(inv.date),
      inv.vendor_name,
      inv.category_name ?? 'Uncategorized',
      inv.tax_id ?? '',
      inv.amount.toFixed(2),
      inv.ocr_source,
    ]),
    [],
    ['', '', '', 'Total', total.toFixed(2)],
  ];
  const text = rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
  // BOM so Excel renders the Hebrew vendor names correctly.
  return new File(['﻿' + text], `expenses-${period}.csv`, { type: 'text/csv' });
}

export async function buildAccountantReport(
  business: Business | null,
  invoices: Invoice[],
  month: number,
  year: number,
  onProgress: (done: number) => void,
): Promise<AccountantReport> {
  const period = `${year}-${pad(month)}`;
  const total = Math.round(invoices.reduce((sum, inv) => sum + inv.amount, 0) * 100) / 100;

  const receipts: File[] = [];
  for (const inv of invoices) {
    const blob = await getReceiptFile(inv.id);
    const ext = (inv.file_name.split('.').pop() || 'bin').toLowerCase();
    const name = `${localDate(inv.date)}_${safeName(inv.vendor_name)}_${inv.id}.${ext}`;
    const type = MIME_BY_EXTENSION[ext] ?? (inv.file_content_type || blob.type);
    receipts.push(new File([blob], name, { type }));
    onProgress(receipts.length);
  }

  const csv = buildCsv(business, period, invoices, total);
  const files = [csv, ...receipts];
  const entries: Record<string, Uint8Array> = {};
  for (const file of files) {
    entries[file.name] = new Uint8Array(await file.arrayBuffer());
  }
  const zipName = `${safeName(business?.name ?? 'SmartReceipt')}-expenses-${period}.zip`;
  const zip = new File([zipSync(entries, { level: 6 }) as Uint8Array<ArrayBuffer>], zipName, {
    type: 'application/zip',
  });

  const shareText =
    `דוח הוצאות ${business?.name ?? ''} לחודש ${pad(month)}/${year}\n` +
    `${invoices.length} קבלות, סה"כ ₪${total.toFixed(2)}`;

  return { invoiceCount: invoices.length, total, files, zip, shareText };
}

// Chrome enforces these only inside share() itself - canShare() returns true for a
// zip, or for 20 files, and share() then rejects with "NotAllowedError: Permission
// denied". So the zip is never shared (download only) and the limits are checked here.
const SHAREABLE_EXTENSIONS = new Set([...Object.keys(MIME_BY_EXTENSION), 'csv']);
const MAX_SHARE_FILES = 10;
const MAX_SHARE_BYTES = 50 * 1024 * 1024;

/** The CSV + receipt files to hand to navigator.share, or null if this browser (or this
 * report's size) can't be shared directly and the zip download should be used instead. */
export function shareableFiles(report: AccountantReport): File[] | null {
  if (typeof navigator.canShare !== 'function') return null;
  const { files } = report;
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  const allAllowed = files.every((file) =>
    SHAREABLE_EXTENSIONS.has(file.name.split('.').pop() ?? ''),
  );
  if (files.length > MAX_SHARE_FILES || totalBytes > MAX_SHARE_BYTES || !allAllowed) return null;
  return navigator.canShare({ files }) ? files : null;
}

export function downloadFile(file: File) {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
