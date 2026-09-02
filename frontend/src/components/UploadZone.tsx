import { CheckCircle2, Camera, FileText, Info, Loader2, UploadCloud, XCircle } from 'lucide-react';
import { useCallback, useRef, useState, type DragEvent } from 'react';

import { api } from '../api/client';
import type { DuplicateConflictDetail, Invoice } from '../types';
import ConflictResolutionModal from './ConflictResolutionModal';
import Toast from './Toast';

interface UploadZoneProps {
  onUploaded: (invoice: Invoice) => void;
}

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

type UploadState = 'idle' | 'uploading' | 'success' | 'error' | 'unrecognized' | 'duplicate';

export default function UploadZone({ onUploaded }: UploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [state, setState] = useState<UploadState>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [conflict, setConflict] = useState<DuplicateConflictDetail | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      const file = files?.[0];
      if (!file) return;

      if (!ACCEPTED_TYPES.includes(file.type)) {
        setState('error');
        setMessage('Unsupported file type. Please upload a JPEG, PNG, WEBP or PDF.');
        return;
      }

      setState('uploading');
      setMessage(null);

      const formData = new FormData();
      formData.append('file', file);

      try {
        // Do NOT set Content-Type here — axios/the browser must generate it
        // itself so it can include the multipart boundary. Overriding it
        // strips the boundary and the backend receives an unparsable body,
        // which FastAPI reports as a 422 "file field required" error.
        const { data } = await api.post<Invoice>('/invoices/upload', formData);
        if (data.is_unrecognized) {
          // OCR couldn't read this one reliably. The file is never discarded — it's
          // saved under the "לא מזוהים" folder for manual review instead of showing
          // fabricated-looking vendor/amount values here.
          setState('unrecognized');
          setMessage(null);
          setToast("הקובץ נשמר בתיקיית 'לא מזוהים' לבחינה ידנית.");
        } else {
          setState('success');
          setMessage(`Extracted: ${data.vendor_name} — ${data.amount.toFixed(2)}`);
        }
        onUploaded(data);
      } catch (err: any) {
        const detail = err?.response?.data?.detail;
        if (err?.response?.status === 409 && detail?.error === 'DUPLICATE_EXISTS') {
          setState('duplicate');
          setMessage(null);
          return;
        }
        if (err?.response?.status === 409 && detail?.error === 'DUPLICATE_CONFLICT') {
          setState('idle');
          setMessage(null);
          setConflict(detail as DuplicateConflictDetail);
          return;
        }
        setState('error');
        setMessage(typeof detail === 'string' ? detail : 'Upload failed. Please try again.');
      }
    },
    [onUploaded],
  );

  function handleConflictResolved({
    action,
    invoice,
  }: {
    action: 'keep_existing' | 'update_with_new';
    invoice: Invoice;
  }) {
    setConflict(null);
    if (action === 'keep_existing') {
      setState('idle');
      setMessage(null);
      return;
    }
    setState('success');
    setMessage(`Updated: ${invoice.vendor_name} — ${invoice.amount.toFixed(2)}`);
    onUploaded(invoice);
  }

  async function resolveConflictAsKeepExisting() {
    if (!conflict) return;
    try {
      await api.post('/invoices/resolve-conflict', {
        action: 'keep_existing',
        existing_invoice_id: conflict.existing_invoice.id,
        file_reference: conflict.new_data.file_reference,
        vendor_name: conflict.new_data.vendor_name,
        amount: conflict.new_data.amount,
        date: conflict.new_data.date,
        tax_id: conflict.new_data.tax_id,
        invoice_number: conflict.new_data.invoice_number,
      });
    } catch {
      // Best-effort cleanup — a leftover file on disk is a cleanup miss, not a
      // data-integrity issue, since the existing invoice was never touched.
    } finally {
      setConflict(null);
      setState('idle');
      setMessage(null);
    }
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    handleFiles(e.dataTransfer.files);
  }

  function handleRetry() {
    setState('idle');
    setMessage(null);
    inputRef.current?.click();
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
      <h2 className="text-lg font-semibold text-slate-800 mb-4">Upload Receipt</h2>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={`flex flex-col items-center justify-center gap-3 border-2 border-dashed rounded-xl py-14 px-6 cursor-pointer transition ${
          isDragging
            ? 'border-brand-500 bg-brand-50'
            : 'border-slate-300 hover:border-brand-400 hover:bg-slate-50'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          accept={ACCEPTED_TYPES.join(',')}
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = '';
          }}
        />

        {state === 'uploading' ? (
          <Loader2 className="animate-spin text-brand-600" size={40} />
        ) : (
          <UploadCloud className="text-brand-500" size={40} />
        )}

        <div className="text-center">
          <p className="font-medium text-slate-700">
            {state === 'uploading'
              ? 'Processing receipt with OCR...'
              : 'Drag & drop a receipt here'}
          </p>
          <p className="text-sm text-slate-400 mt-1">
            or click to browse — JPEG, PNG, WEBP, PDF (max 10MB)
          </p>
        </div>
      </div>

      {message && (
        <div
          className={`mt-4 flex items-start gap-2 rounded-lg px-3 py-2.5 text-sm ${
            state === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
          }`}
        >
          {state === 'success' ? (
            <CheckCircle2 size={18} className="shrink-0 mt-0.5" />
          ) : (
            <XCircle size={18} className="shrink-0 mt-0.5" />
          )}
          <span>{message}</span>
        </div>
      )}

      {state === 'unrecognized' && (
        <div
          dir="rtl"
          className="mt-4 flex flex-col items-center gap-3 rounded-lg bg-amber-50 border border-amber-200 px-4 py-4 text-center"
        >
          <p className="text-sm font-medium text-amber-800">
            התמונה לא הייתה ברורה מספיק לקריאה אוטומטית. הקובץ נשמר בתיקיית "לא מזוהים" — ניתן למיין
            אותו ידנית משם.
          </p>
          <button
            type="button"
            onClick={handleRetry}
            className="inline-flex items-center gap-2 bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
          >
            <Camera size={16} />
            העלה קובץ נוסף
          </button>
        </div>
      )}

      {state === 'duplicate' && (
        <div
          dir="rtl"
          className="mt-4 flex flex-col items-center gap-3 rounded-lg bg-blue-50 border border-blue-200 px-4 py-4 text-center"
        >
          <p className="flex items-center gap-2 text-sm font-medium text-blue-800">
            <Info size={16} className="shrink-0" />
            החשבונית הזו כבר קיימת במערכת.
          </p>
          <button
            type="button"
            onClick={handleRetry}
            className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
          >
            <Camera size={16} />
            העלה קובץ אחר
          </button>
        </div>
      )}

      <div className="mt-4 flex items-center gap-2 text-xs text-slate-400">
        <FileText size={14} />
        <span>
          Vendor, total, and date are extracted automatically. Category defaults to Uncategorized.
        </span>
      </div>

      {conflict && (
        <ConflictResolutionModal
          conflict={conflict}
          onResolved={handleConflictResolved}
          onClose={() => {
            // Closing without a choice defaults to keeping the existing record, so
            // the newly-uploaded file never sits around unresolved.
            resolveConflictAsKeepExisting();
          }}
        />
      )}

      {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}
