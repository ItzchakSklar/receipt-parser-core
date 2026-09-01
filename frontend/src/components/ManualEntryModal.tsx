import { useState, type FormEvent } from "react";

import { api } from "../api/client";
import type { Invoice, OCRErrorDetail } from "../types";
import Modal from "./Modal";

interface ManualEntryModalProps {
  errorDetail: OCRErrorDetail;
  onConfirmed: (invoice: Invoice) => void;
  onCancel: () => void;
}

export default function ManualEntryModal({ errorDetail, onConfirmed, onCancel }: ManualEntryModalProps) {
  const { extracted } = errorDetail;
  const [vendorName, setVendorName] = useState(extracted.vendor_name ?? "");
  const [amount, setAmount] = useState(extracted.amount != null ? String(extracted.amount) : "");
  const [date, setDate] = useState(extracted.date ? extracted.date.slice(0, 10) : "");
  const [taxId, setTaxId] = useState(extracted.tax_id ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const { data } = await api.post<Invoice>("/invoices/confirm", {
        file_reference: errorDetail.file_reference,
        vendor_name: vendorName,
        amount: parseFloat(amount),
        date: new Date(date).toISOString(),
        tax_id: taxId || null,
      });
      onConfirmed(data);
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? "Could not save the invoice. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="Confirm Receipt Details" onClose={onCancel}>
      <p className="text-sm text-slate-500 mb-4">{errorDetail.message}</p>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="block text-sm font-medium text-slate-600 mb-1">Vendor Name</label>
          <input
            required
            value={vendorName}
            onChange={(e) => setVendorName(e.target.value)}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">Amount</label>
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
            <label className="block text-sm font-medium text-slate-600 mb-1">Date</label>
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
          <label className="block text-sm font-medium text-slate-600 mb-1">Tax ID / ח"פ (optional)</label>
          <input
            value={taxId}
            onChange={(e) => setTaxId(e.target.value)}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>

        {errorDetail.missing_fields.length > 0 && (
          <p className="text-xs text-amber-600">
            Could not read automatically: {errorDetail.missing_fields.join(", ")}
          </p>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="w-full bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white font-medium py-2.5 rounded-lg transition"
        >
          {submitting ? "Saving..." : "Save Invoice"}
        </button>
      </form>
    </Modal>
  );
}
