import { Folder } from "lucide-react";

import { formatILSRounded } from "../utils/currency";

interface MonthFolderCardProps {
  monthLabel: string;
  count: number;
  total: number;
  onOpen: () => void;
}

export default function MonthFolderCard({ monthLabel, count, total, onOpen }: MonthFolderCardProps) {
  const isEmpty = count === 0;

  return (
    <button
      type="button"
      onClick={onOpen}
      className={`group flex flex-col items-center gap-2 rounded-2xl border border-slate-200 bg-white p-5 text-center shadow-sm transition hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md ${
        isEmpty ? "opacity-60" : ""
      }`}
    >
      <Folder
        size={52}
        className="text-amber-400 fill-amber-100 transition group-hover:text-amber-500 group-hover:fill-amber-200"
        strokeWidth={1.5}
      />
      <div className="leading-tight">
        <p className="font-semibold text-slate-800">{monthLabel}</p>
        <p className="text-xs text-slate-400 mt-0.5">{count} קבלות</p>
        <p className="text-xs font-medium text-slate-500">{formatILSRounded(total)}</p>
      </div>
    </button>
  );
}
