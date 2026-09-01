import { useEffect, useState } from "react";

import { api } from "../api/client";
import type { Invoice } from "../types";
import Modal from "./Modal";

interface ReceiptPreviewModalProps {
  invoice: Invoice;
  onClose: () => void;
}

export default function ReceiptPreviewModal({ invoice, onClose }: ReceiptPreviewModalProps) {
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

  return (
    <Modal title={`Receipt — ${invoice.vendor_name}`} onClose={onClose}>
      <div className="h-[65vh] flex items-center justify-center bg-slate-50 rounded-lg overflow-hidden">
        {error && <p className="text-sm text-red-600 px-4 text-center">Could not load the receipt file.</p>}
        {!error && !objectUrl && <p className="text-sm text-slate-400">Loading...</p>}
        {objectUrl && isPdf && <iframe src={objectUrl} title="Receipt PDF" className="w-full h-full" />}
        {objectUrl && !isPdf && (
          <img
            src={objectUrl}
            alt={`Receipt from ${invoice.vendor_name}`}
            className="max-h-full max-w-full object-contain"
          />
        )}
      </div>
    </Modal>
  );
}
