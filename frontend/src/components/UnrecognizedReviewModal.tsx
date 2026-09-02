import { X } from 'lucide-react';
import { useEffect, useState, type FormEvent, type MouseEvent } from 'react';

import { api } from '../api/client';
import type { Category, Invoice } from '../types';

interface UnrecognizedReviewModalProps {
  invoice: Invoice;
  onSorted: (invoice: Invoice) => void;
  onClose: () => void;
}

/** Preview + "מיין לתקייה / עדכן פרטים" form for one receipt in the "לא מזוהים"
 * folder. Submitting confirms the real vendor/amount/date, which moves the file
 * into its proper Year/Month folder on the backend. */
export default function UnrecognizedReviewModal({
  invoice,
  onSorted,
  onClose,
}: UnrecognizedReviewModalProps) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState(false);
  const isPdf = invoice.file_path.toLowerCase().endsWith('.pdf');

  const [vendorName, setVendorName] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [taxId, setTaxId] = useState('');
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;

    api
      .get(`/invoices/${invoice.id}/file`, { responseType: 'blob' })
      .then(({ data }) => {
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

  useEffect(() => {
    api
      .get<Category[]>('/categories')
      .then(({ data }) => setCategories(data))
      .catch(() => {});
  }, []);

  function stopPropagation(e: MouseEvent) {
    e.stopPropagation();
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const { data } = await api.post<Invoice>(`/invoices/unrecognized/${invoice.id}/sort`, {
        vendor_name: vendorName,
        amount: parseFloat(amount),
        date: new Date(date).toISOString(),
        tax_id: taxId.trim() || null,
        category_id: categoryId,
      });
      onSorted(data);
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? 'לא ניתן היה למיין את הקובץ. נסה שוב.');
    } finally {
      setSubmitting(false);
    }
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

        <form
          onSubmit={handleSubmit}
          className="w-full shrink-0 space-y-3 overflow-y-auto p-6 md:w-96"
        >
          <div>
            <h3 className="text-lg font-semibold text-slate-800">מיין לתקייה / עדכן פרטים</h3>
            <p className="mt-1 text-xs text-slate-400">
              אשר את הפרטים האמיתיים כדי שהקובץ יעבור לתקיית החודש/שנה המתאימה.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">שם ספק</label>
            <input
              required
              value={vendorName}
              onChange={(e) => setVendorName(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1">סכום כולל</label>
              <input
                required
                type="number"
                step="0.01"
                min="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1">תאריך</label>
              <input
                required
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">
              ח.פ / עוסק (לא חובה)
            </label>
            <input
              value={taxId}
              onChange={(e) => setTaxId(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">קטגוריה</label>
            <select
              value={categoryId ?? ''}
              onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : null)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="">ללא קטגוריה</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white font-medium py-2.5 rounded-lg transition"
          >
            {submitting ? 'שומר...' : 'מיין לתקייה / עדכן פרטים'}
          </button>
        </form>
      </div>
    </div>
  );
}
