import { X } from 'lucide-react';
import { useEffect, useState, type MouseEvent } from 'react';

import { getReceiptFile } from '../api/cache';
import type { Invoice } from '../types';
import CompleteReceiptForm from './CompleteReceiptForm';

interface UnrecognizedReviewModalProps {
  invoice: Invoice;
  onSorted: (invoice: Invoice) => void;
  /** Removed as a duplicate of an invoice the user chose to keep. */
  onDeleted: () => void;
  onClose: () => void;
}

/** Preview + "מיין לתקייה / עדכן פרטים" form for one receipt in the "לא מזוהים"
 * folder. Submitting confirms the real vendor/amount/date, which moves the file
 * into its proper Year/Month folder on the backend. */
export default function UnrecognizedReviewModal({
  invoice,
  onSorted,
  onDeleted,
  onClose,
}: UnrecognizedReviewModalProps) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState(false);
  const isPdf = invoice.file_name.toLowerCase().endsWith('.pdf');

  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;

    getReceiptFile(invoice.id)
      .then((data) => {
        if (cancelled) return;
        url = URL.createObjectURL(data);
        setObjectUrl(url);
      })
      .catch(() => {
        if (!cancelled) setPreviewError(true);
      });

    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [invoice.id]);

  function stopPropagation(e: MouseEvent) {
    e.stopPropagation();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-4"
      onClick={onClose}
    >
      <div
        dir="rtl"
        className="flex h-full max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl md:flex-row"
        onClick={stopPropagation}
      >
        <div className="relative flex flex-1 items-center justify-center bg-slate-900 min-h-[300px]">
          <button
            type="button"
            onClick={onClose}
            className="absolute left-3 top-3 z-10 rounded-full bg-black/40 p-2 text-white hover:bg-black/60 transition"
          >
            <X size={20} />
          </button>

          {previewError && (
            <p className="px-4 text-center text-sm text-red-300">לא ניתן לטעון את הקובץ.</p>
          )}
          {!previewError && !objectUrl && <p className="text-sm text-slate-400">טוען...</p>}
          {objectUrl && isPdf && (
            <iframe src={objectUrl} title="תצוגה מקדימה" className="h-full w-full" />
          )}
          {objectUrl && !isPdf && (
            <img
              src={objectUrl}
              alt={invoice.vendor_name}
              className="max-h-full max-w-full object-contain"
            />
          )}
        </div>

        <div className="w-full shrink-0 space-y-3 overflow-y-auto p-6 md:w-96">
          <div>
            <h3 className="text-lg font-semibold text-slate-800">מיין לתקייה / עדכן פרטים</h3>
            <p className="mt-1 text-xs text-slate-400">
              אשר את הפרטים האמיתיים כדי שהקובץ יעבור לתקיית החודש/שנה המתאימה.
            </p>
          </div>
          <CompleteReceiptForm
            invoice={invoice}
            submitLabel="מיין לתקייה / עדכן פרטים"
            onSorted={onSorted}
            onDeleted={onDeleted}
          />
        </div>
      </div>
    </div>
  );
}
