import { ChevronRight, Download, FolderInput, Mail, Pencil, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState, type MouseEvent } from 'react';

import { api } from '../api/client';
import type { Invoice } from '../types';
import ConfirmDialog from './ConfirmDialog';
import ContextMenu from './ContextMenu';
import EditInvoiceModal from './EditInvoiceModal';
import MonthFolderCard from './MonthFolderCard';
import ReceiptFileCard from './ReceiptFileCard';
import ReceiptLightboxModal from './ReceiptLightboxModal';
import SendToAccountantModal from './SendToAccountantModal';
import UnrecognizedFileCard from './UnrecognizedFileCard';
import UnrecognizedFolderCard from './UnrecognizedFolderCard';
import UnrecognizedReviewModal from './UnrecognizedReviewModal';

const HEBREW_MONTHS = [
  'ינואר',
  'פברואר',
  'מרץ',
  'אפריל',
  'מאי',
  'יוני',
  'יולי',
  'אוגוסט',
  'ספטמבר',
  'אוקטובר',
  'נובמבר',
  'דצמבר',
];

const ENGLISH_MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export default function InvoiceExplorer({ refreshKey }: { refreshKey: number }) {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<number | null>(null);
  const [lightboxInvoice, setLightboxInvoice] = useState<Invoice | null>(null);
  const [showExportModal, setShowExportModal] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ invoice: Invoice; x: number; y: number } | null>(
    null,
  );
  const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null);
  const [deletingInvoice, setDeletingInvoice] = useState<Invoice | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // "לא מזוהים" - files OCR couldn't read, persistent regardless of Year/Month filter.
  const [unrecognized, setUnrecognized] = useState<Invoice[]>([]);
  const [showUnrecognized, setShowUnrecognized] = useState(false);
  const [reviewingInvoice, setReviewingInvoice] = useState<Invoice | null>(null);

  function fetchInvoices() {
    setLoading(true);
    return api
      .get<Invoice[]>('/invoices')
      .then(({ data }) => setInvoices(data))
      .finally(() => setLoading(false));
  }

  function fetchUnrecognized() {
    return api
      .get<Invoice[]>('/invoices/unrecognized')
      .then(({ data }) => setUnrecognized(data))
      .catch(() => {});
  }

  useEffect(() => {
    fetchInvoices();
    fetchUnrecognized();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const availableYears = useMemo(() => {
    const years = new Set(invoices.map((inv) => new Date(inv.date).getFullYear()));
    years.add(new Date().getFullYear());
    return Array.from(years).sort((a, b) => b - a);
  }, [invoices]);

  const monthStats = useMemo(() => {
    const stats = Array.from({ length: 12 }, () => ({ count: 0, total: 0 }));
    for (const inv of invoices) {
      const invDate = new Date(inv.date);
      if (invDate.getFullYear() !== selectedYear) continue;
      const monthIndex = invDate.getMonth();
      stats[monthIndex].count += 1;
      stats[monthIndex].total += inv.amount;
    }
    return stats;
  }, [invoices, selectedYear]);

  const filesInMonth = useMemo(() => {
    if (selectedMonth === null) return [];
    return invoices
      .filter((inv) => {
        const invDate = new Date(inv.date);
        return invDate.getFullYear() === selectedYear && invDate.getMonth() + 1 === selectedMonth;
      })
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [invoices, selectedYear, selectedMonth]);

  function openYearView() {
    setShowUnrecognized(false);
    setSelectedMonth(null);
    setSelectedInvoiceId(null);
  }

  function openMonth(monthIndex: number) {
    setShowUnrecognized(false);
    setSelectedMonth(monthIndex + 1);
    setSelectedInvoiceId(null);
  }

  function openUnrecognized() {
    setShowUnrecognized(true);
    setSelectedInvoiceId(null);
  }

  function handleCardContextMenu(e: MouseEvent<HTMLDivElement>, invoice: Invoice) {
    e.preventDefault();
    setSelectedInvoiceId(invoice.id);
    setContextMenu({ invoice, x: e.clientX, y: e.clientY });
  }

  function handleInvoiceUpdated(updated: Invoice) {
    setInvoices((prev) => prev.map((inv) => (inv.id === updated.id ? updated : inv)));
    setLightboxInvoice((prev) => (prev && prev.id === updated.id ? updated : prev));
    setEditingInvoice(null);
  }

  function handleInvoiceSorted(sorted: Invoice) {
    setUnrecognized((prev) => prev.filter((inv) => inv.id !== sorted.id));
    setInvoices((prev) => [sorted, ...prev]);
    setReviewingInvoice(null);
  }

  async function handleDeleteConfirmed() {
    if (!deletingInvoice) return;
    try {
      await api.delete(`/invoices/${deletingInvoice.id}`);
      setInvoices((prev) => prev.filter((inv) => inv.id !== deletingInvoice.id));
      setUnrecognized((prev) => prev.filter((inv) => inv.id !== deletingInvoice.id));
      setSelectedInvoiceId((prev) => (prev === deletingInvoice.id ? null : prev));
      setLightboxInvoice((prev) => (prev && prev.id === deletingInvoice.id ? null : prev));
      setDeletingInvoice(null);
      setDeleteError(null);
    } catch (err: any) {
      setDeleteError(err?.response?.data?.detail ?? 'מחיקת החשבונית נכשלה. נסה שוב.');
    }
  }

  async function handleDownload(invoice: Invoice) {
    try {
      const { data } = await api.get(`/invoices/${invoice.id}/file`, { responseType: 'blob' });
      const extension = invoice.file_path.split('.').pop() || 'bin';
      const safeVendor = invoice.vendor_name.replace(/[^\p{L}\p{N}_-]+/gu, '_') || 'receipt';
      const dateStr = new Date(invoice.date).toISOString().slice(0, 10);
      const url = URL.createObjectURL(data);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${safeVendor}-${dateStr}.${extension}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      // Best-effort download — the receipt remains viewable in the lightbox regardless.
    }
  }

  return (
    <div className="space-y-4">
      {/* Top control bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <nav className="flex flex-wrap items-center gap-1.5 text-sm text-slate-500">
          <button type="button" onClick={openYearView} className="hover:text-brand-700 font-medium">
            Root
          </button>
          <ChevronRight size={14} className="text-slate-300" />
          {showUnrecognized ? (
            <span className="font-semibold text-slate-800" dir="rtl">
              לא מזוהים
            </span>
          ) : (
            <>
              <button
                type="button"
                onClick={openYearView}
                className={
                  selectedMonth === null
                    ? 'font-semibold text-slate-800'
                    : 'hover:text-brand-700 font-medium'
                }
              >
                {selectedYear}
              </button>
              {selectedMonth !== null && (
                <>
                  <ChevronRight size={14} className="text-slate-300" />
                  <span className="font-semibold text-slate-800">
                    {ENGLISH_MONTHS[selectedMonth - 1]}
                  </span>
                </>
              )}
            </>
          )}
        </nav>

        <div className="flex items-center gap-3">
          <UnrecognizedFolderCard
            count={unrecognized.length}
            active={showUnrecognized}
            onOpen={openUnrecognized}
          />
          <select
            value={selectedYear}
            onChange={(e) => {
              setSelectedYear(Number(e.target.value));
              openYearView();
            }}
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            {availableYears.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <p className="text-center text-slate-400 py-16">Loading...</p>
      ) : showUnrecognized ? (
        <div className="space-y-4">
          <p className="text-sm text-slate-400" dir="rtl">
            {unrecognized.length} קבצים ממתינים למיון ידני
          </p>

          {unrecognized.length === 0 ? (
            <div className="text-center py-16 bg-white rounded-2xl border border-slate-200">
              <p className="text-slate-500" dir="rtl">
                אין קבצים לא מזוהים.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {unrecognized.map((inv) => (
                <UnrecognizedFileCard
                  key={inv.id}
                  invoice={inv}
                  selected={selectedInvoiceId === inv.id}
                  onSelect={() => setSelectedInvoiceId(inv.id)}
                  onOpen={() => setReviewingInvoice(inv)}
                  onContextMenu={(e) => handleCardContextMenu(e, inv)}
                />
              ))}
            </div>
          )}
        </div>
      ) : selectedMonth === null ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {HEBREW_MONTHS.map((label, idx) => (
            <MonthFolderCard
              key={label}
              monthLabel={label}
              count={monthStats[idx].count}
              total={monthStats[idx].total}
              onOpen={() => openMonth(idx)}
            />
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-400">
              {filesInMonth.length} {filesInMonth.length === 1 ? 'receipt' : 'receipts'}
            </p>
            <button
              type="button"
              onClick={() => setShowExportModal(true)}
              className="inline-flex items-center gap-2 bg-white border border-slate-200 hover:border-brand-300 hover:text-brand-700 text-slate-600 text-sm font-medium px-4 py-2 rounded-lg shadow-sm transition"
            >
              <Mail size={16} />
              Send Month to Accountant
              <span className="text-slate-400" dir="rtl">
                שלח חודש זה לרואה חשבון
              </span>
            </button>
          </div>

          {filesInMonth.length === 0 ? (
            <div className="text-center py-16 bg-white rounded-2xl border border-slate-200">
              <p className="text-slate-500">
                No receipts in {ENGLISH_MONTHS[selectedMonth - 1]} {selectedYear}.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {filesInMonth.map((inv) => (
                <ReceiptFileCard
                  key={inv.id}
                  invoice={inv}
                  selected={selectedInvoiceId === inv.id}
                  onSelect={() => setSelectedInvoiceId(inv.id)}
                  onOpen={() => setLightboxInvoice(inv)}
                  onContextMenu={(e) => handleCardContextMenu(e, inv)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {lightboxInvoice && (
        <ReceiptLightboxModal invoice={lightboxInvoice} onClose={() => setLightboxInvoice(null)} />
      )}

      {showExportModal && (
        <SendToAccountantModal
          onClose={() => setShowExportModal(false)}
          initialMonth={selectedMonth ?? undefined}
          initialYear={selectedYear}
        />
      )}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          items={
            contextMenu.invoice.is_unrecognized
              ? [
                  {
                    label: 'מיין לתקייה / עדכן פרטים',
                    icon: <FolderInput size={15} />,
                    onClick: () => setReviewingInvoice(contextMenu.invoice),
                  },
                  {
                    label: 'הורד קובץ מקורי',
                    icon: <Download size={15} />,
                    onClick: () => handleDownload(contextMenu.invoice),
                  },
                  {
                    label: 'מחק קובץ',
                    icon: <Trash2 size={15} />,
                    danger: true,
                    onClick: () => setDeletingInvoice(contextMenu.invoice),
                  },
                ]
              : [
                  {
                    label: 'ערוך פרטים',
                    icon: <Pencil size={15} />,
                    onClick: () => setEditingInvoice(contextMenu.invoice),
                  },
                  {
                    label: 'הורד קובץ מקורי',
                    icon: <Download size={15} />,
                    onClick: () => handleDownload(contextMenu.invoice),
                  },
                  {
                    label: 'מחק חשבונית',
                    icon: <Trash2 size={15} />,
                    danger: true,
                    onClick: () => setDeletingInvoice(contextMenu.invoice),
                  },
                ]
          }
        />
      )}

      {editingInvoice && (
        <EditInvoiceModal
          invoice={editingInvoice}
          onSaved={handleInvoiceUpdated}
          onCancel={() => setEditingInvoice(null)}
        />
      )}

      {reviewingInvoice && (
        <UnrecognizedReviewModal
          invoice={reviewingInvoice}
          onSorted={handleInvoiceSorted}
          onClose={() => setReviewingInvoice(null)}
        />
      )}

      {deletingInvoice && (
        <ConfirmDialog
          title="מחיקת חשבונית"
          message={`האם למחוק את החשבונית מ-${deletingInvoice.vendor_name}? לא ניתן לשחזר פעולה זו.`}
          confirmLabel="מחק"
          danger
          error={deleteError}
          onConfirm={handleDeleteConfirmed}
          onCancel={() => {
            setDeletingInvoice(null);
            setDeleteError(null);
          }}
        />
      )}
    </div>
  );
}
