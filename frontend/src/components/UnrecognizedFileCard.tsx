import { FileText } from 'lucide-react';
import type { MouseEvent } from 'react';

import type { Invoice } from '../types';
import ReceiptThumbnail from './ReceiptThumbnail';

interface UnrecognizedFileCardProps {
  invoice: Invoice;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onContextMenu: (e: MouseEvent<HTMLDivElement>) => void;
}

/** Grid tile for a receipt still awaiting manual review. Amount/date on the record
 * are placeholders, not real OCR reads, so this card deliberately shows neither -
 * only the original filename and when it was uploaded. */
export default function UnrecognizedFileCard({
  invoice,
  selected,
  onSelect,
  onOpen,
  onContextMenu,
}: UnrecognizedFileCardProps) {
  const isPdf = invoice.file_path.toLowerCase().endsWith('.pdf');
  const filename = invoice.vendor_name;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onDoubleClick={onOpen}
      onContextMenu={onContextMenu}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen();
      }}
      className={`group cursor-pointer select-none rounded-2xl border bg-white p-2 shadow-sm transition hover:shadow-md ${
        selected ? 'border-red-500 ring-2 ring-red-200' : 'border-slate-200 hover:border-red-300'
      }`}
    >
      <div className="h-28 w-full overflow-hidden rounded-xl bg-slate-100">
        {isPdf ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-gradient-to-b from-red-50 to-white px-2 text-center">
            <FileText size={30} className="text-red-400" strokeWidth={1.5} />
            <p className="w-full truncate text-[11px] font-medium text-slate-600">{filename}</p>
          </div>
        ) : (
          <ReceiptThumbnail invoiceId={invoice.id} alt={filename} />
        )}
      </div>

      <div className="px-1 pt-2 pb-1">
        <p className="truncate text-sm font-medium text-slate-800">{filename}</p>
        <p className="text-xs text-slate-400">
          {new Date(invoice.created_at).toLocaleDateString()}
        </p>
        <span
          dir="rtl"
          className="mt-1 inline-block rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-600"
        >
          ממתין למיון
        </span>
      </div>
    </div>
  );
}
