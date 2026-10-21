import { Info } from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';

import { cachedGet, dropReceiptFile } from '../api/cache';
import { api } from '../api/client';
import type { Category, DuplicateConflictDetail, Invoice } from '../types';
import { formatILS } from '../utils/currency';
import ConflictResolutionModal from './ConflictResolutionModal';

interface CompleteReceiptFormProps {
  /** An unrecognized invoice row - its vendor/amount/date may be placeholders. */
  invoice: Invoice;
  /** Fields OCR didn't find, when known (only on the upload response). */
  missingFields?: string[];
  submitLabel?: string;
  /** The receipt was saved - either this row, or an existing invoice it replaced. */
  onSorted: (invoice: Invoice) => void;
  /** This row was removed, because it duplicates an invoice the user kept. */
  onDeleted: () => void;
}

const inputClass =
  'w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500';

function Field({
  label,
  missing,
  children,
}: {
  label: string;
  missing?: boolean;
  children: ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 flex items-center justify-between text-sm font-medium text-slate-600">
        {label}
        {missing && <span className="text-xs font-normal text-amber-600">לא זוהה — יש להשלים</span>}
      </label>
      {children}
    </div>
  );
}

/** Lets the user fill in what OCR couldn't read and save the receipt, running the
 * same duplicate check as an upload: an identical receipt is reported, and a
 * same-number/similar-vendor receipt with different data opens the comparison. */
export default function CompleteReceiptForm({
  invoice,
  missingFields,
  submitLabel = 'שמור קבלה',
  onSorted,
  onDeleted,
}: CompleteReceiptFormProps) {
  // Without missingFields (e.g. reopened from the "לא מזוהים" folder) the placeholders
  // _save_as_unrecognized writes are recognizable: vendor = file name, amount = 0.
  const missing = new Set(missingFields ?? []);
  const vendorKnown = !missing.has('vendor_name') && invoice.vendor_name !== invoice.file_name;
  const amountKnown = !missing.has('amount') && invoice.amount > 0;
  const dateKnown = !missing.has('date');

  const [vendorName, setVendorName] = useState(vendorKnown ? invoice.vendor_name : '');
  const [amount, setAmount] = useState(amountKnown ? String(invoice.amount) : '');
  const [date, setDate] = useState(
    (dateKnown ? new Date(invoice.date) : new Date()).toISOString().slice(0, 10),
  );
  const [taxId, setTaxId] = useState(invoice.tax_id ?? '');
  const [invoiceNumber, setInvoiceNumber] = useState(invoice.invoice_number ?? '');
  const [categoryId, setCategoryId] = useState<number | null>(invoice.category_id);
  const [categories, setCategories] = useState<Category[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState<Invoice | null>(null);
  const [conflict, setConflict] = useState<DuplicateConflictDetail | null>(null);

  useEffect(() => {
    cachedGet<Category[]>('/categories')
      .then(setCategories)
      .catch(() => {});
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setExisting(null);
    try {
      const { data } = await api.post<Invoice>(`/invoices/unrecognized/${invoice.id}/sort`, {
        vendor_name: vendorName.trim(),
        amount: parseFloat(amount),
        date: new Date(date).toISOString(),
        tax_id: taxId.trim() || null,
        invoice_number: invoiceNumber.trim() || null,
        category_id: categoryId,
      });
      onSorted(data);
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      if (err?.response?.status === 409 && detail?.error === 'DUPLICATE_EXISTS') {
        setExisting(detail.existing_invoice);
      } else if (err?.response?.status === 409 && detail?.error === 'DUPLICATE_CONFLICT') {
        setConflict(detail as DuplicateConflictDetail);
      } else {
        setError(typeof detail === 'string' ? detail : 'השמירה נכשלה. נסה שוב.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function deleteThisCopy() {
    setSubmitting(true);
    try {
      await api.delete(`/invoices/${invoice.id}`);
      await dropReceiptFile(invoice.id);
      onDeleted();
    } catch {
      setError('המחיקה נכשלה. נסה שוב.');
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <Field label="שם ספק" missing={!vendorKnown}>
        <input
          required
          value={vendorName}
          onChange={(e) => setVendorName(e.target.value)}
          className={`${inputClass} ${vendorKnown ? 'border-slate-300' : 'border-amber-400'}`}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="סכום כולל" missing={!amountKnown}>
          <input
            required
            type="number"
            step="0.01"
            min="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={`${inputClass} ${amountKnown ? 'border-slate-300' : 'border-amber-400'}`}
          />
        </Field>
        <Field label="תאריך" missing={!dateKnown}>
          <input
            required
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={`${inputClass} ${dateKnown ? 'border-slate-300' : 'border-amber-400'}`}
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="ח.פ / עוסק">
          <input
            value={taxId}
            onChange={(e) => setTaxId(e.target.value)}
            className={`${inputClass} border-slate-300`}
          />
        </Field>
        <Field label="מספר חשבונית">
          <input
            value={invoiceNumber}
            onChange={(e) => setInvoiceNumber(e.target.value)}
            className={`${inputClass} border-slate-300`}
          />
        </Field>
      </div>

      <Field label="קטגוריה">
        <select
          value={categoryId ?? ''}
          onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : null)}
          className={`${inputClass} border-slate-300 bg-white`}
        >
          <option value="">ללא קטגוריה</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>

      {existing && (
        <div className="space-y-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5 text-sm text-blue-800">
          <p className="flex items-center gap-2 font-medium">
            <Info size={16} className="shrink-0" />
            קבלה זהה כבר קיימת במערכת:
          </p>
          <p>
            {existing.vendor_name} — {formatILS(existing.amount)} —{' '}
            {new Date(existing.date).toLocaleDateString('he-IL')}
            {existing.invoice_number && ` (חשבונית ${existing.invoice_number})`}
          </p>
          <button
            type="button"
            onClick={deleteThisCopy}
            disabled={submitting}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-60"
          >
            מחק את העותק החדש
          </button>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-lg bg-brand-600 py-2.5 font-medium text-white transition hover:bg-brand-700 disabled:opacity-60"
      >
        {submitting ? 'שומר...' : submitLabel}
      </button>

      {conflict && (
        <ConflictResolutionModal
          conflict={conflict}
          onResolved={({ action, invoice: resolved }) => {
            setConflict(null);
            if (action === 'keep_existing') onDeleted();
            else onSorted(resolved);
          }}
          // Closing without a choice leaves this receipt in "לא מזוהים" untouched.
          onClose={() => setConflict(null)}
        />
      )}
    </form>
  );
}
