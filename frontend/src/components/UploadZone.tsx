import { CheckCircle2, FileText, Loader2, UploadCloud, XCircle } from "lucide-react";
import { useCallback, useRef, useState, type DragEvent } from "react";

import { api } from "../api/client";
import type { Invoice, OCRErrorDetail } from "../types";
import ManualEntryModal from "./ManualEntryModal";

interface UploadZoneProps {
  onUploaded: (invoice: Invoice) => void;
}

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

type UploadState = "idle" | "uploading" | "success" | "error";

export default function UploadZone({ onUploaded }: UploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [state, setState] = useState<UploadState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [ocrError, setOcrError] = useState<OCRErrorDetail | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;

    if (!ACCEPTED_TYPES.includes(file.type)) {
      setState("error");
      setMessage("Unsupported file type. Please upload a JPEG, PNG, WEBP or PDF.");
      return;
    }

    setState("uploading");
    setMessage(null);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const { data } = await api.post<Invoice>("/invoices/upload", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setState("success");
      setMessage(`Extracted: ${data.vendor_name} — ${data.amount.toFixed(2)}`);
      onUploaded(data);
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      if (err?.response?.status === 422 && detail?.error === "INVALID_OCR_DATA") {
        // Zero-hallucination policy: the backend refused to guess. Ask the user to
        // confirm the fields instead of showing a plain error.
        setState("idle");
        setMessage(null);
        setOcrError(detail as OCRErrorDetail);
        return;
      }
      setState("error");
      setMessage(typeof detail === "string" ? detail : "Upload failed. Please try again.");
    }
  }, [onUploaded]);

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    handleFiles(e.dataTransfer.files);
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
          isDragging ? "border-brand-500 bg-brand-50" : "border-slate-300 hover:border-brand-400 hover:bg-slate-50"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          accept={ACCEPTED_TYPES.join(",")}
          onChange={(e) => handleFiles(e.target.files)}
        />

        {state === "uploading" ? (
          <Loader2 className="animate-spin text-brand-600" size={40} />
        ) : (
          <UploadCloud className="text-brand-500" size={40} />
        )}

        <div className="text-center">
          <p className="font-medium text-slate-700">
            {state === "uploading" ? "Processing receipt with OCR..." : "Drag & drop a receipt here"}
          </p>
          <p className="text-sm text-slate-400 mt-1">or click to browse — JPEG, PNG, WEBP, PDF (max 10MB)</p>
        </div>
      </div>

      {message && (
        <div
          className={`mt-4 flex items-start gap-2 rounded-lg px-3 py-2.5 text-sm ${
            state === "success" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
          }`}
        >
          {state === "success" ? <CheckCircle2 size={18} className="shrink-0 mt-0.5" /> : <XCircle size={18} className="shrink-0 mt-0.5" />}
          <span>{message}</span>
        </div>
      )}

      <div className="mt-4 flex items-center gap-2 text-xs text-slate-400">
        <FileText size={14} />
        <span>Vendor, total, date, and tax ID (ח"פ) are extracted automatically.</span>
      </div>

      {ocrError && (
        <ManualEntryModal
          errorDetail={ocrError}
          onCancel={() => setOcrError(null)}
          onConfirmed={(invoice) => {
            setOcrError(null);
            setState("success");
            setMessage(`Saved: ${invoice.vendor_name} — ${invoice.amount.toFixed(2)}`);
            onUploaded(invoice);
          }}
        />
      )}
    </div>
  );
}
