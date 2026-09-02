import { FileQuestion } from 'lucide-react';

interface UnrecognizedFolderCardProps {
  count: number;
  active: boolean;
  onOpen: () => void;
}

/** Always-visible top-level folder for receipts OCR couldn't read - unlike the
 * Year/Month folders, this one never depends on the currently selected filter. */
export default function UnrecognizedFolderCard({
  count,
  active,
  onOpen,
}: UnrecognizedFolderCardProps) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`group relative flex items-center gap-2 rounded-xl border px-3 py-2 text-right shadow-sm transition ${
        active
          ? 'border-red-300 bg-red-50'
          : 'border-slate-200 bg-white hover:border-red-300 hover:bg-red-50/50'
      }`}
    >
      <FileQuestion
        size={24}
        className="text-red-400 fill-red-100 transition group-hover:text-red-500"
        strokeWidth={1.5}
      />
      <span className="text-sm font-medium text-slate-700" dir="rtl">
        לא מזוהים
      </span>
      {count > 0 && (
        <span className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-red-500 px-1.5 py-0.5 text-[11px] font-bold leading-none text-white">
          {count}
        </span>
      )}
    </button>
  );
}
