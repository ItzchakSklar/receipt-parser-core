import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  FileText,
  FolderOpen,
  Info,
  Loader2,
  RotateCcw,
  Send,
  UploadCloud,
  XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';

import { api } from '../api/client';
import type { DuplicateConflictDetail, Invoice } from '../types';
import { formatILS } from '../utils/currency';
import CompleteReceiptForm from './CompleteReceiptForm';
import ConflictResolutionModal, { type ConflictAction } from './ConflictResolutionModal';

interface UploadZoneProps {
  onUploaded: (invoice: Invoice) => void;
  onViewInvoices: () => void;
}

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MAX_BYTES = 10 * 1024 * 1024;

type UploadState = 'idle' | 'preview' | 'uploading' | 'result' | 'error' | 'duplicate';

const REASON_MESSAGES: Record<string, string> = {
  corrupt_file: 'הקובץ פגום או שלא ניתן לפתוח אותו.',
  low_confidence: 'התמונה מטושטשת או באיכות נמוכה מדי לקריאה אוטומטית.',
  missing_fields: 'חלק מהפרטים הנדרשים לא נמצאו בקבלה.',
  engine_error: 'מנוע הזיהוי נכשל בעיבוד הקובץ.',
  no_ocr_engine_available: 'מנוע הזיהוי אינו זמין כרגע בשרת.',
};

function formatSize(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.round(bytes / 1024)} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function FilePreview({ file, url }: { file: File; url: string }) {
  return (
    <div className="flex h-72 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
      {file.type === 'application/pdf' ? (
        <object data={url} type="application/pdf" className="h-full w-full">
          <div className="flex flex-col items-center gap-2 text-slate-500">
            <FileText size={40} />
            <span className="text-sm">{file.name}</span>
          </div>
        </object>
      ) : (
        <img src={url} alt={file.name} className="max-h-full max-w-full object-contain" />
      )}
    </div>
  );
}

function ExtractedDetails({ invoice }: { invoice: Invoice }) {
  const missing = new Set(invoice.ocr_missing_fields ?? []);
  const notFound = <span className="text-slate-400">לא זוהה</span>;
  const rows: [string, ReactNode][] = [
    ['ספק', missing.has('vendor_name') ? notFound : invoice.vendor_name],
    ['סכום', missing.has('amount') ? notFound : formatILS(invoice.amount)],
    ['תאריך', missing.has('date') ? notFound : new Date(invoice.date).toLocaleDateString('he-IL')],
    ['ח"פ / ע"מ', missing.has('tax_id') || !invoice.tax_id ? notFound : invoice.tax_id],
    ['מספר חשבונית', invoice.invoice_number || notFound],
  ];
  return (
    <dl className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-4 px-3 py-2">
          <dt className="text-slate-500">{label}</dt>
          <dd className="font-medium text-slate-800">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function UploadZone({ onUploaded, onViewInvoices }: UploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [state, setState] = useState<UploadState>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [result, setResult] = useState<Invoice | null>(null);
  const [existingInvoice, setExistingInvoice] = useState<Invoice | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [conflict, setConflict] = useState<DuplicateConflictDetail | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // OCR on a phone photo can take tens of seconds, so show a running counter rather
  // than a spinner that looks the same whether it's working or stuck.
  useEffect(() => {
    if (state !== 'uploading') return;
    setElapsed(0);
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [state]);

  const selectFile = useCallback((files: FileList | null) => {
    const picked = files?.[0];
    if (!picked) return;

    if (!ACCEPTED_TYPES.includes(picked.type)) {
      setState('error');
      setMessage('סוג קובץ לא נתמך. ניתן להעלות תמונה או קובץ PDF.');
      return;
    }
    if (picked.size > MAX_BYTES) {
      setState('error');
      setMessage('הקובץ חורג מהגודל המרבי של 10 מגה-בייט.');
      return;
    }

    setFile(picked);
    setResult(null);
    setMessage(null);
    setState('preview');
  }, []);

  async function submit() {
    if (!file) return;
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
      setResult(data);
      setState('result');
      onUploaded(data);
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      if (err?.response?.status === 409 && detail?.error === 'DUPLICATE_EXISTS') {
        setExistingInvoice(detail.existing_invoice);
        setState('duplicate');
        return;
      }
      if (err?.response?.status === 409 && detail?.error === 'DUPLICATE_CONFLICT') {
        setState('preview');
        setConflict(detail as DuplicateConflictDetail);
        return;
      }
      setState('error');
      setMessage(typeof detail === 'string' ? detail : 'ההעלאה נכשלה. נסה שוב.');
    }
  }

  function handleConflictResolved({
    action,
    invoice,
  }: {
    action: ConflictAction;
    invoice: Invoice;
  }) {
    setConflict(null);
    if (action === 'keep_existing') {
      reset();
      return;
    }
    setResult(invoice);
    setState('result');
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
      // Best-effort cleanup — the held upload expires on its own anyway, and it's not a
      // data-integrity issue, since the existing invoice was never touched.
    } finally {
      setConflict(null);
      reset();
    }
  }

  function reset() {
    setFile(null);
    setResult(null);
    setExistingInvoice(null);
    setMessage(null);
    setState('idle');
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    selectFile(e.dataTransfer.files);
  }

  const hiddenInputs = (
    <>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept={ACCEPTED_TYPES.join(',')}
        onChange={(e) => {
          selectFile(e.target.files);
          e.target.value = '';
        }}
      />
      {/* capture opens the rear camera directly on phones; desktops fall back to a file picker. */}
      <input
        ref={cameraRef}
        type="file"
        className="hidden"
        accept="image/*"
        capture="environment"
        onChange={(e) => {
          selectFile(e.target.files);
          e.target.value = '';
        }}
      />
    </>
  );

  const secondaryButton =
    'inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50';
  const primaryButton =
    'inline-flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:opacity-50';

  const showFileStep = file && previewUrl && state !== 'idle' && state !== 'error';
  const recognized = result && !result.is_unrecognized;
  const partlyRecognized =
    result?.ocr_reason !== 'corrupt_file' &&
    (result?.ocr_missing_fields?.length ?? 0) > 0 &&
    (result?.ocr_missing_fields?.length ?? 0) < 3;

  return (
    <div dir="rtl" className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
      <h2 className="text-lg font-semibold text-slate-800 mb-4">העלאת קבלה</h2>
      {hiddenInputs}

      {!showFileStep && (
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
          <UploadCloud className="text-brand-500" size={40} />
          <div className="text-center">
            <p className="font-medium text-slate-700">גרור קבלה לכאן</p>
            <p className="text-sm text-slate-400 mt-1">
              או לחץ לבחירת קובץ — תמונה או PDF (עד 10 מגה-בייט)
            </p>
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              cameraRef.current?.click();
            }}
            className={secondaryButton}
          >
            <Camera size={16} />
            צלם קבלה
          </button>
        </div>
      )}

      {showFileStep && (
        <div className="flex flex-col gap-4">
          {state === 'preview' && (
            <p className="text-sm font-medium text-slate-700">
              זה הקובץ שנבחר. לשלוח אותו לפענוח, או לצלם/להעלות שוב?
            </p>
          )}
          {state === 'uploading' && (
            <p className="flex items-center gap-2 text-sm font-medium text-brand-700">
              <Loader2 size={16} className="animate-spin" />
              מפענח את הקבלה... {elapsed} שניות
            </p>
          )}
          {state === 'result' && result && (
            <div
              className={`flex items-start gap-2 rounded-lg px-3 py-2.5 text-sm ${
                recognized
                  ? 'bg-green-50 text-green-800'
                  : 'bg-amber-50 border border-amber-200 text-amber-800'
              }`}
            >
              {recognized ? (
                <CheckCircle2 size={18} className="shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle size={18} className="shrink-0 mt-0.5" />
              )}
              <div>
                <p className="font-medium">
                  {!recognized
                    ? partlyRecognized
                      ? 'זיהינו רק חלק מהפרטים.'
                      : 'לא הצלחנו לזהות את הקבלה.'
                    : result.ocr_source === 'manual'
                      ? 'הקבלה נשמרה בהצלחה.'
                      : 'הקבלה זוהתה ונשמרה בהצלחה.'}
                </p>
                {!recognized && (
                  <p className="mt-1">
                    {partlyRecognized
                      ? 'השלם את הפרטים המסומנים ושמור.'
                      : (REASON_MESSAGES[result.ocr_reason ?? ''] ??
                        'לא ניתן היה לקרוא את הקבלה.')}{' '}
                    עד שתשמור, הקובץ ממתין בתיקיית "לא מזוהים".
                  </p>
                )}
              </div>
            </div>
          )}
          {state === 'duplicate' && (
            <p className="flex items-center gap-2 rounded-lg bg-blue-50 border border-blue-200 px-3 py-2.5 text-sm font-medium text-blue-800">
              <Info size={16} className="shrink-0" />
              {existingInvoice
                ? 'קבלה זהה כבר קיימת במערכת — היא לא נשמרה פעם נוספת.'
                : 'העותק החדש נמחק, החשבונית הקיימת נשארה במערכת.'}
            </p>
          )}

          <FilePreview file={file} url={previewUrl} />
          <p className="text-xs text-slate-500">
            {file.name} · {formatSize(file.size)}
          </p>

          {state === 'result' && result && recognized && <ExtractedDetails invoice={result} />}
          {state === 'result' && result && !recognized && (
            <CompleteReceiptForm
              invoice={result}
              missingFields={result.ocr_missing_fields}
              onSorted={(saved) => {
                setResult(saved);
                onUploaded(saved);
              }}
              onDeleted={() => {
                setResult(null);
                setExistingInvoice(null);
                setState('duplicate');
                onUploaded(result);
              }}
            />
          )}
          {state === 'duplicate' && existingInvoice && (
            <ExtractedDetails invoice={existingInvoice} />
          )}

          <div className="flex flex-wrap gap-2">
            {(state === 'preview' || state === 'uploading') && (
              <>
                <button
                  type="button"
                  onClick={submit}
                  disabled={state === 'uploading'}
                  className={primaryButton}
                >
                  <Send size={16} />
                  שלח לפענוח
                </button>
                <button
                  type="button"
                  onClick={() => cameraRef.current?.click()}
                  disabled={state === 'uploading'}
                  className={secondaryButton}
                >
                  <Camera size={16} />
                  צלם שוב
                </button>
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  disabled={state === 'uploading'}
                  className={secondaryButton}
                >
                  <RotateCcw size={16} />
                  העלה קובץ אחר
                </button>
              </>
            )}
            {(state === 'result' || state === 'duplicate') && (
              <>
                <button type="button" onClick={reset} className={primaryButton}>
                  <UploadCloud size={16} />
                  העלה קבלה נוספת
                </button>
                <button type="button" onClick={onViewInvoices} className={secondaryButton}>
                  <FolderOpen size={16} />
                  {result?.is_unrecognized ? 'לתיקיית "לא מזוהים"' : 'לרשימת החשבוניות'}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {state === 'error' && message && (
        <div className="mt-4 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700">
          <XCircle size={18} className="shrink-0 mt-0.5" />
          <span>{message}</span>
        </div>
      )}

      <div className="mt-4 flex items-center gap-2 text-xs text-slate-400">
        <FileText size={14} />
        <span>
          שם הספק, הסכום והתאריך מזוהים אוטומטית. הקטגוריה נקבעת כברירת מחדל ל"ללא קטגוריה".
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
    </div>
  );
}
