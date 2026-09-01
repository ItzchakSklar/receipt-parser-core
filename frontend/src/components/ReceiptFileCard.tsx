import { FileText } from "lucide-react";
import type { MouseEvent } from "react";

import type { Invoice } from "../types";
import { formatILS } from "../utils/currency";
import ReceiptThumbnail from "./ReceiptThumbnail";

interface ReceiptFileCardProps {
  invoice: Invoice;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onContextMenu: (e: MouseEvent<HTMLDivElement>) => void;
}

export default function ReceiptFileCard({ invoice, selected, onSelect, onOpen, onContextMenu }: ReceiptFileCardProps) {
  const isPdf = invoice.file_path.toLowerCase().endsWith(".pdf");

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onDoubleClick={onOpen}
      onContextMenu={onContextMenu}
      onKeyDown={(e) => {
        if (e.key === "Enter") onOpen();
      }}
      className={`group cursor-pointer select-none rounded-2xl border bg-white p-2 shadow-sm transition hover:shadow-md ${
        selected ? "border-brand-500 ring-2 ring-brand-200" : "border-slate-200 hover:border-brand-300"
      }`}
    >
      <div className="h-28 w-full overflow-hidden rounded-xl bg-slate-100">
        {isPdf ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-gradient-to-b from-red-50 to-white px-2 text-center">
            <FileText size={30} className="text-red-400" strokeWidth={1.5} />
            <p className="w-full truncate text-[11px] font-medium text-slate-600">{invoice.vendor_name}</p>
            <p className="text-[11px] font-semibold text-slate-800">{formatILS(invoice.amount)}</p>
          </div>
        ) : (
          <ReceiptThumbnail invoiceId={invoice.id} alt={`Receipt from ${invoice.vendor_name}`} />
        )}
      </div>

      <div className="px-1 pt-2 pb-1">
        <p className="truncate text-sm font-medium text-slate-800">{invoice.vendor_name}</p>
        <div className="flex items-center justify-between">
          <p className="text-xs text-slate-400">{new Date(invoice.date).toLocaleDateString()}</p>
          <p className="text-xs font-semibold text-slate-700">{formatILS(invoice.amount)}</p>
        </div>
        {invoice.ocr_source === "manual" && (
          <span className="mt-1 inline-block rounded bg-amber-50 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-600">
            Manual
          </span>
        )}
      </div>
    </div>
  );
}
