import { ImageOff } from 'lucide-react';
import { useEffect, useState } from 'react';

import { api } from '../api/client';

interface ReceiptThumbnailProps {
  invoiceId: number;
  alt: string;
}

/** Loads an image receipt's bytes as an authenticated blob and renders it as a
 * thumbnail. The file endpoint requires a Bearer token, so a plain <img src> can't
 * be used directly. */
export default function ReceiptThumbnail({ invoiceId, alt }: ReceiptThumbnailProps) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;

    api
      .get(`/invoices/${invoiceId}/file`, { responseType: 'blob' })
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
  }, [invoiceId]);

  if (error) {
    return (
      <div className="w-full h-full flex items-center justify-center text-slate-300">
        <ImageOff size={28} />
      </div>
    );
  }

  if (!objectUrl) {
    return <div className="w-full h-full animate-pulse bg-slate-100" />;
  }

  return <img src={objectUrl} alt={alt} className="w-full h-full object-cover" />;
}
