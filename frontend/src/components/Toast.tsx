import { FolderInput, X } from 'lucide-react';
import { useEffect } from 'react';

interface ToastProps {
  message: string;
  onDismiss: () => void;
}

const AUTO_DISMISS_MS = 5000;

export default function Toast({ message, onDismiss }: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return (
    <div
      dir="rtl"
      className="fixed bottom-6 left-1/2 z-[60] flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 items-start gap-3 rounded-xl border border-amber-200 bg-white px-4 py-3 shadow-lg"
      role="status"
    >
      <FolderInput size={20} className="mt-0.5 shrink-0 text-amber-500" />
      <p className="flex-1 text-sm font-medium text-slate-700">{message}</p>
      <button
        type="button"
        onClick={onDismiss}
        className="text-slate-400 hover:text-slate-600"
        aria-label="סגור"
      >
        <X size={16} />
      </button>
    </div>
  );
}
