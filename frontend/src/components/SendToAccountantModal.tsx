import { useState, type FormEvent } from "react";

import { api } from "../api/client";
import type { MonthlyExportResponse } from "../types";
import Modal from "./Modal";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

interface SendToAccountantModalProps {
  onClose: () => void;
  initialMonth?: number;
  initialYear?: number;
}

export default function SendToAccountantModal({ onClose, initialMonth, initialYear }: SendToAccountantModalProps) {
  const now = new Date();
  const [month, setMonth] = useState(initialMonth ?? now.getMonth() + 1);
  const [year, setYear] = useState(initialYear ?? now.getFullYear());
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<MonthlyExportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const { data } = await api.post<MonthlyExportResponse>("/invoices/export-monthly", {
        email,
        month,
        year,
      });
      setResult(data);
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? "Could not send the report. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="Send to Accountant" onClose={onClose}>
      {result ? (
        <div className="space-y-3">
          <p className="text-sm text-slate-700">
            {result.invoice_count} invoice(s) totaling ${result.total.toFixed(2)} sent to{" "}
            <span className="font-medium">{result.recipient}</span>.
          </p>
          {result.mode === "mock" && (
            <p className="text-xs text-amber-600">
              SMTP is not configured in this environment — the report was saved locally instead of emailed.
            </p>
          )}
          <button
            onClick={onClose}
            type="button"
            className="w-full bg-brand-600 hover:bg-brand-700 text-white font-medium py-2.5 rounded-lg transition"
          >
            Done
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1">Month</label>
              <select
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                {MONTH_NAMES.map((name, idx) => (
                  <option key={name} value={idx + 1}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1">Year</label>
              <input
                type="number"
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">Accountant Email</label>
            <input
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="accountant@example.com"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white font-medium py-2.5 rounded-lg transition"
          >
            {submitting ? "Sending..." : "Send Report"}
          </button>
        </form>
      )}
    </Modal>
  );
}
