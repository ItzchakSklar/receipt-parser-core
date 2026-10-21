import { CheckCircle2, Download, FileText, Loader2, Share2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { cachedGet } from '../api/cache';
import { useAuth } from '../context/AuthContext';
import type { Invoice } from '../types';
import {
  buildAccountantReport,
  downloadFile,
  invoicesInMonth,
  shareableFiles,
  type AccountantReport,
} from '../utils/accountantReport';
import { formatILS } from '../utils/currency';
import Modal from './Modal';

const HEBREW_MONTHS = [
  'ינואר',
  'פברואר',
  'מרץ',
  'אפריל',
  'מאי',
  'יוני',
  'יולי',
  'אוגוסט',
  'ספטמבר',
  'אוקטובר',
  'נובמבר',
  'דצמבר',
];

const SELECT_CLASS =
  'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500';

interface SendToAccountantModalProps {
  onClose: () => void;
  initialMonth?: number;
  initialYear?: number;
}

export default function SendToAccountantModal({
  onClose,
  initialMonth,
  initialYear,
}: SendToAccountantModalProps) {
  const { business } = useAuth();
  const now = new Date();
  const [month, setMonth] = useState(initialMonth ?? now.getMonth() + 1);
  const [year, setYear] = useState(initialYear ?? now.getFullYear());
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [report, setReport] = useState<AccountantReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    cachedGet<Invoice[]>('/invoices')
      .then(setInvoices)
      .catch(() => setError('לא ניתן היה לטעון את הקבלות. נסה שוב.'));
  }, []);

  const years = useMemo(() => {
    const set = new Set((invoices ?? []).map((inv) => new Date(inv.date).getFullYear()));
    set.add(now.getFullYear());
    set.add(year);
    return Array.from(set).sort((a, b) => b - a);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoices]);

  const selected = useMemo(
    () => invoicesInMonth(invoices ?? [], month, year),
    [invoices, month, year],
  );
  const selectedTotal = selected.reduce((sum, inv) => sum + inv.amount, 0);
  const building = progress !== null && !report;

  async function handlePrepare() {
    setError(null);
    setProgress(0);
    try {
      setReport(await buildAccountantReport(business, selected, month, year, setProgress));
    } catch {
      setError('הכנת הדוח נכשלה. נסה שוב.');
      setProgress(null);
    }
  }

  async function handleShare(files: File[]) {
    if (!report) return;
    try {
      await navigator.share({ files, title: report.zip.name, text: report.shareText });
    } catch (err) {
      const name = (err as DOMException)?.name;
      if (name !== 'AbortError') {
        console.error('navigator.share failed', err, files);
        setError(`השיתוף נכשל. אפשר להוריד את הקובץ ולצרף אותו ידנית.`);
      }
    }
  }

  const filesToShare = report ? shareableFiles(report) : null;

  return (
    <Modal title="שליחה לרואה חשבון" onClose={onClose}>
      <div dir="rtl" className="space-y-4">
        {report ? (
          <>
            <div className="flex flex-col items-center text-center gap-2 py-2">
              <CheckCircle2 size={40} className="text-green-500" />
              <p className="font-semibold text-slate-800">
                הדוח ל{HEBREW_MONTHS[month - 1]} {year} מוכן
              </p>
              <p className="text-sm text-slate-500">
                {report.invoiceCount} קבלות · {formatILS(report.total)} · קובץ סיכום לאקסל
              </p>
            </div>

            {filesToShare && (
              <button
                type="button"
                onClick={() => handleShare(filesToShare)}
                className="w-full inline-flex items-center justify-center gap-2 bg-brand-600 hover:bg-brand-700 text-white font-medium py-2.5 rounded-lg transition"
              >
                <Share2 size={18} />
                שתף (וואטסאפ, מייל...)
              </button>
            )}
            <button
              type="button"
              onClick={() => downloadFile(report.zip)}
              className={`w-full inline-flex items-center justify-center gap-2 font-medium py-2.5 rounded-lg transition ${
                filesToShare
                  ? 'bg-white border border-slate-200 hover:border-brand-300 hover:text-brand-700 text-slate-600'
                  : 'bg-brand-600 hover:bg-brand-700 text-white'
              }`}
            >
              <Download size={18} />
              הורד קובץ ZIP
            </button>
            {!filesToShare && (
              <p className="text-xs text-slate-400 text-center">
                שיתוף ישיר לא זמין כאן (דפדפן לא תומך, או יותר מ-9 קבלות / 50MB). הורד את קובץ ה-ZIP
                וצרף אותו למייל או לוואטסאפ.
              </p>
            )}
          </>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">חודש</label>
                <select
                  value={month}
                  disabled={building}
                  onChange={(e) => setMonth(Number(e.target.value))}
                  className={SELECT_CLASS}
                >
                  {HEBREW_MONTHS.map((name, idx) => (
                    <option key={name} value={idx + 1}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">שנה</label>
                <select
                  value={year}
                  disabled={building}
                  onChange={(e) => setYear(Number(e.target.value))}
                  className={SELECT_CLASS}
                >
                  {years.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex items-center gap-3 rounded-xl bg-slate-50 border border-slate-200 p-4">
              <div className="bg-brand-50 text-brand-600 p-2.5 rounded-lg">
                <FileText size={20} />
              </div>
              {invoices === null ? (
                <p className="text-sm text-slate-400">טוען...</p>
              ) : selected.length === 0 ? (
                <p className="text-sm text-slate-500">אין קבלות מזוהות בחודש הזה.</p>
              ) : (
                <div>
                  <p className="text-sm font-semibold text-slate-800">
                    {selected.length} קבלות · {formatILS(selectedTotal)}
                  </p>
                  <p className="text-xs text-slate-400">קובץ סיכום לאקסל + כל קבצי הקבלות</p>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={handlePrepare}
              disabled={building || selected.length === 0}
              className="w-full inline-flex items-center justify-center gap-2 bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white font-medium py-2.5 rounded-lg transition"
            >
              {building ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  מכין דוח... {progress}/{selected.length}
                </>
              ) : (
                'הכן דוח'
              )}
            </button>
          </>
        )}

        {error && <p className="text-sm text-red-600 text-center">{error}</p>}
      </div>
    </Modal>
  );
}
