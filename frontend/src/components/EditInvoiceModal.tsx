import { useEffect, useState, type FormEvent } from 'react';

import { api } from '../api/client';
import type { Category, Invoice } from '../types';
import Modal from './Modal';

interface EditInvoiceModalProps {
  invoice: Invoice;
  onSaved: (invoice: Invoice) => void;
  onCancel: () => void;
}

export default function EditInvoiceModal({ invoice, onSaved, onCancel }: EditInvoiceModalProps) {
  const [vendorName, setVendorName] = useState(invoice.vendor_name);
  const [amount, setAmount] = useState(String(invoice.amount));
  const [date, setDate] = useState(invoice.date.slice(0, 10));
  const [categoryId, setCategoryId] = useState<number | null>(invoice.category_id);
  const [categories, setCategories] = useState<Category[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Category[]>('/categories')
      .then(({ data }) => setCategories(data))
      .catch(() => {});
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const { data } = await api.put<Invoice>(`/invoices/${invoice.id}`, {
        vendor_name: vendorName,
        amount: parseFloat(amount),
        date: new Date(date).toISOString(),
        category_id: categoryId,
      });
      onSaved(data);
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? 'לא ניתן היה לשמור את השינויים. נסה שוב.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="ערוך פרטי חשבונית" onClose={onCancel}>
      <form onSubmit={handleSubmit} dir="rtl" className="space-y-3">
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
          {submitting ? 'שומר...' : 'שמור שינויים'}
        </button>
      </form>
    </Modal>
  );
}
