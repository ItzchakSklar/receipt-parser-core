import type { MouseEvent } from "react";

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel = "ביטול",
  danger,
  error,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  function stopPropagation(e: MouseEvent) {
    e.stopPropagation();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4" onClick={onCancel}>
      <div dir="rtl" className="w-full max-w-sm bg-white rounded-2xl shadow-xl p-6" onClick={stopPropagation}>
        <h3 className="text-lg font-semibold text-slate-800 mb-2">{title}</h3>
        <p className="text-sm text-slate-500 mb-4">{message}</p>

        {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 border border-slate-300 text-slate-600 hover:bg-slate-50 font-medium py-2.5 rounded-lg transition"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`flex-1 text-white font-medium py-2.5 rounded-lg transition ${
              danger ? "bg-red-600 hover:bg-red-700" : "bg-brand-600 hover:bg-brand-700"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
