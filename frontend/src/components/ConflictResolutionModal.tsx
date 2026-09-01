import { AlertTriangle, X } from 'lucide-react';
import { useEffect, useState, type MouseEvent } from 'react';

import { api } from '../api/client';
import type { DuplicateConflictDetail, Invoice } from '../types';
import { formatILS } from '../utils/currency';

interface ConflictResolutionModalProps {
  conflict: DuplicateConflictDetail;
  onResolved: (result: { action: 'keep_existing' | 'update_with_new'; invoice: Invoice }) => void;
  onClose: () => void;
}

/** Loads a receipt file as an authenticated blob object URL. `key` identifies the
 * source so the effect only re-fetches when it actually changes. */
function useReceiptPreview(key: string, load: () => Promise<{ data: Blob }>) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    setObjectUrl(null);
    setError(false);

    load()
      .then(({ data }) => {
        if (cancelled) return;
        url = URL.createObjectURL(data);
        setObjectUrl(url);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });

    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { objectUrl, error };
}

interface ReceiptPaneProps {
  label: string;
  isPdf: boolean;
  objectUrl: string | null;
  error: boolean;
}

function ReceiptPane({ label, isPdf, objectUrl, error }: ReceiptPaneProps) {
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-slate-900">
      <p className="bg-slate-800 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-300">
        {label}
      </p>
      <div className="flex h-56 items-center justify-center">
        {error && <p className="px-4 text-center text-xs text-red-300">לא ניתן לטעון את הקובץ.</p>}
        {!error && !objectUrl && <p className="text-xs text-slate-400">טוען...</p>}
        {objectUrl && isPdf && <iframe src={objectUrl} title={label} className="h-full w-full" />}
        {objectUrl && !isPdf && (
          <img src={objectUrl} alt={label} className="max-h-full max-w-full object-contain" />
        )}
      </div>
    </div>
  );
}

interface DataRowProps {
  label: string;
  existingValue: string;
  newValue: string;
  differs: boolean;
}

function DataRow({ label, existingValue, newValue, differs }: DataRowProps) {
  const highlight = differs ? 'bg-amber-50 text-amber-800 font-semibold' : 'text-slate-700';
  return (
    <div className="grid grid-cols-[80px_1fr_1fr] items-center gap-2 py-1.5 text-sm">
      <span className="text-xs text-slate-400">{label}</span>
      <span className={`rounded px-2 py-1 ${highlight}`}>{existingValue}</span>
      <span className={`rounded px-2 py-1 ${highlight}`}>{newValue}</span>
    </div>
  );
}

export default function ConflictResolutionModal({
  conflict,
  onResolved,
  onClose,
}: ConflictResolutionModalProps) {
  const { existing_invoice: existing, new_data: newData } = conflict;
  const [submitting, setSubmitting] = useState<'keep_existing' | 'update_with_new' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const existingIsPdf = existing.file_path.toLowerCase().endsWith('.pdf');
  const newIsPdf = newData.file_reference.toLowerCase().endsWith('.pdf');

  const existingImage = useReceiptPreview(`existing-${existing.id}`, () =>
    api.get(`/invoices/${existing.id}/file`, { responseType: 'blob' }),
  );
  const newImage = useReceiptPreview(`new-${newData.file_reference}`, () =>
    api.get('/invoices/file-preview', {
      params: { file_reference: newData.file_reference },
      responseType: 'blob',
    }),
  );

  function stopPropagation(e: MouseEvent) {
    e.stopPropagation();
  }

  async function resolve(action: 'keep_existing' | 'update_with_new') {
    setSubmitting(action);
    setError(null);
    try {
      const { data } = await api.post<Invoice>('/invoices/resolve-conflict', {
        action,
        existing_invoice_id: existing.id,
        file_reference: newData.file_reference,
        vendor_name: newData.vendor_name,
        amount: newData.amount,
        date: newData.date,
        tax_id: newData.tax_id,
        invoice_number: newData.invoice_number,
      });
      onResolved({ action, invoice: data });
    } catch {
      setError('הפעולה נכשלה. נסה שוב.');
      setSubmitting(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4"
      onClick={onClose}
    >
      <div
        dir="rtl"
        className="flex h-full max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={stopPropagation}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div className="flex items-center gap-2">
            <AlertTriangle size={20} className="text-amber-500" />
            <h3 className="text-lg font-semibold text-slate-800">
              אותה חשבונית נמצאה עם נתונים שונים
            </h3>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <p className="mb-4 text-sm text-slate-500">
            נמצאה חשבונית קיימת מאותו ספק ועם אותו מספר חשבונית, אך הנתונים שחולצו מהקובץ החדש
            שונים. בחר איזו גרסה לשמור.
          </p>

          <div className="grid grid-cols-2 gap-4">
            <ReceiptPane
              label="קיים במערכת"
              isPdf={existingIsPdf}
              objectUrl={existingImage.objectUrl}
              error={existingImage.error}
            />
            <ReceiptPane
              label="הועלה כעת"
              isPdf={newIsPdf}
              objectUrl={newImage.objectUrl}
              error={newImage.error}
            />
          </div>

          <div className="mt-5">
            <div className="grid grid-cols-[80px_1fr_1fr] gap-2 border-b border-slate-100 pb-1.5 text-xs font-semibold text-slate-400">
              <span></span>
              <span>קיים</span>
              <span>חדש</span>
            </div>
            <DataRow
              label="ספק"
              existingValue={existing.vendor_name}
              newValue={newData.vendor_name}
              differs={existing.vendor_name !== newData.vendor_name}
            />
            <DataRow
              label="מס' חשבונית"
              existingValue={existing.invoice_number ?? '—'}
              newValue={newData.invoice_number ?? '—'}
              differs={(existing.invoice_number ?? '') !== (newData.invoice_number ?? '')}
            />
            <DataRow
              label="סכום"
              existingValue={formatILS(existing.amount)}
              newValue={formatILS(newData.amount)}
              differs={Math.abs(existing.amount - newData.amount) >= 0.01}
            />
            <DataRow
              label="תאריך"
              existingValue={new Date(existing.date).toLocaleDateString()}
              newValue={new Date(newData.date).toLocaleDateString()}
              differs={
                new Date(existing.date).toDateString() !== new Date(newData.date).toDateString()
              }
            />
            <DataRow
              label="ח.פ / עוסק"
              existingValue={existing.tax_id ?? '—'}
              newValue={newData.tax_id ?? '—'}
              differs={(existing.tax_id ?? '') !== (newData.tax_id ?? '')}
            />
          </div>

          {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
        </div>

        <div className="flex gap-3 border-t border-slate-100 px-6 py-4">
          <button
            type="button"
            disabled={submitting !== null}
            onClick={() => resolve('keep_existing')}
            className="flex-1 rounded-lg border border-slate-300 py-2.5 font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-60"
          >
            {submitting === 'keep_existing' ? 'שומר...' : 'שמור את הקיים'}
          </button>
          <button
            type="button"
            disabled={submitting !== null}
            onClick={() => resolve('update_with_new')}
            className="flex-1 rounded-lg bg-brand-600 py-2.5 font-medium text-white transition hover:bg-brand-700 disabled:opacity-60"
          >
            {submitting === 'update_with_new' ? 'מעדכן...' : 'עדכן לחשבונית החדשה'}
          </button>
        </div>
      </div>
    </div>
  );
}
