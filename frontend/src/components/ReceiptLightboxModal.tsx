import { Calendar, DollarSign, Hash, Store, X } from "lucide-react";
import { useEffect, useState, type MouseEvent, type ReactNode } from "react";

import { api } from "../api/client";
import type { Invoice } from "../types";
import { formatILS } from "../utils/currency";

interface ReceiptLightboxModalProps {
  invoice: Invoice;
  onClose: () => void;
}

interface MetaRowProps {
  icon: ReactNode;
  label: string;
  value: string;
}

function MetaRow({ icon, label, value }: MetaRowProps) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 text-slate-400">{icon}</div>
      <div>
        <p className="text-xs text-slate-400">{label}</p>
        <p className="text-sm font-medium text-slate-800">{value}</p>
      </div>
    </div>
  );
}

export default function ReceiptLightboxModal({ invoice, onClose }: ReceiptLightboxModalProps) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const isPdf = invoice.file_path.toLowerCase().endsWith(".pdf");

  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;

    api
      .get(`/invoices/${invoice.id}/file`, { responseType: "blob" })
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
  }, [invoice.id]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  function stopPropagation(e: MouseEvent) {
    e.stopPropagation();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-4" onClick={onClose}>
      <div
        className="flex h-full max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl md:flex-row"
        onClick={stopPropagation}
      >
        <div className="relative flex flex-1 items-center justify-center bg-slate-900 min-h-[300px]">
          <button
            type="button"
            onClick={onClose}
            className="absolute right-3 top-3 z-10 rounded-full bg-black/40 p-2 text-white hover:bg-black/60 transition"
          >
            <X size={20} />
          </button>

          {error && <p className="px-4 text-center text-sm text-red-300">Could not load the receipt file.</p>}
          {!error && !objectUrl && <p className="text-sm text-slate-400">Loading...</p>}
          {objectUrl && isPdf && <iframe src={objectUrl} title="Receipt PDF" className="h-full w-full" />}
          {objectUrl && !isPdf && (
            <img
              src={objectUrl}
              alt={`Receipt from ${invoice.vendor_name}`}
              className="max-h-full max-w-full object-contain"
            />
          )}
        </div>

        <div className="w-full shrink-0 space-y-5 overflow-y-auto p-6 md:w-80">
          <div>
            <h3 className="text-lg font-semibold text-slate-800">{invoice.vendor_name}</h3>
            {invoice.ocr_source === "manual" && (
              <span className="mt-1 inline-block rounded bg-amber-50 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-600">
                Manually confirmed
              </span>
            )}
          </div>

          <div className="space-y-4">
            <MetaRow icon={<Store size={16} />} label="Vendor" value={invoice.vendor_name} />
            <MetaRow icon={<DollarSign size={16} />} label="Total" value={formatILS(invoice.amount)} />
            <MetaRow icon={<Calendar size={16} />} label="Date" value={new Date(invoice.date).toLocaleDateString()} />
            <MetaRow icon={<Hash size={16} />} label="Tax ID" value={invoice.tax_id ?? "—"} />
            <MetaRow icon={<Hash size={16} />} label="Invoice #" value={invoice.invoice_number ?? "—"} />
            <MetaRow
              icon={<Store size={16} />}
              label="Category"
              value={invoice.category_name ?? "Uncategorized"}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
