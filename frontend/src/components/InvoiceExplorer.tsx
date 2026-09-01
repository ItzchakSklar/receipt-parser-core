import { ChevronRight, Mail } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { api } from "../api/client";
import type { Invoice } from "../types";
import MonthFolderCard from "./MonthFolderCard";
import ReceiptFileCard from "./ReceiptFileCard";
import ReceiptLightboxModal from "./ReceiptLightboxModal";
import SendToAccountantModal from "./SendToAccountantModal";

const HEBREW_MONTHS = [
  "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
  "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר",
];

const ENGLISH_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export default function InvoiceExplorer({ refreshKey }: { refreshKey: number }) {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<number | null>(null);
  const [lightboxInvoice, setLightboxInvoice] = useState<Invoice | null>(null);
  const [showExportModal, setShowExportModal] = useState(false);

  useEffect(() => {
    setLoading(true);
    api
      .get<Invoice[]>("/invoices")
      .then(({ data }) => setInvoices(data))
      .finally(() => setLoading(false));
  }, [refreshKey]);

  const availableYears = useMemo(() => {
    const years = new Set(invoices.map((inv) => new Date(inv.date).getFullYear()));
    years.add(new Date().getFullYear());
    return Array.from(years).sort((a, b) => b - a);
  }, [invoices]);

  const monthStats = useMemo(() => {
    const stats = Array.from({ length: 12 }, () => ({ count: 0, total: 0 }));
    for (const inv of invoices) {
      const invDate = new Date(inv.date);
      if (invDate.getFullYear() !== selectedYear) continue;
      const monthIndex = invDate.getMonth();
      stats[monthIndex].count += 1;
      stats[monthIndex].total += inv.amount;
    }
    return stats;
  }, [invoices, selectedYear]);

  const filesInMonth = useMemo(() => {
    if (selectedMonth === null) return [];
    return invoices
      .filter((inv) => {
        const invDate = new Date(inv.date);
        return invDate.getFullYear() === selectedYear && invDate.getMonth() + 1 === selectedMonth;
      })
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [invoices, selectedYear, selectedMonth]);

  function openYearView() {
    setSelectedMonth(null);
    setSelectedInvoiceId(null);
  }

  function openMonth(monthIndex: number) {
    setSelectedMonth(monthIndex + 1);
    setSelectedInvoiceId(null);
  }

  return (
    <div className="space-y-4">
      {/* Top control bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <nav className="flex items-center gap-1.5 text-sm text-slate-500">
          <button type="button" onClick={openYearView} className="hover:text-brand-700 font-medium">
            Root
          </button>
          <ChevronRight size={14} className="text-slate-300" />
          <button
            type="button"
            onClick={openYearView}
            className={selectedMonth === null ? "font-semibold text-slate-800" : "hover:text-brand-700 font-medium"}
          >
            {selectedYear}
          </button>
          {selectedMonth !== null && (
            <>
              <ChevronRight size={14} className="text-slate-300" />
              <span className="font-semibold text-slate-800">{ENGLISH_MONTHS[selectedMonth - 1]}</span>
            </>
          )}
        </nav>

        <select
          value={selectedYear}
          onChange={(e) => {
            setSelectedYear(Number(e.target.value));
            openYearView();
          }}
          className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          {availableYears.map((year) => (
            <option key={year} value={year}>
              {year}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <p className="text-center text-slate-400 py-16">Loading...</p>
      ) : selectedMonth === null ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {HEBREW_MONTHS.map((label, idx) => (
            <MonthFolderCard
              key={label}
              monthLabel={label}
              count={monthStats[idx].count}
              total={monthStats[idx].total}
              onOpen={() => openMonth(idx)}
            />
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-400">
              {filesInMonth.length} {filesInMonth.length === 1 ? "receipt" : "receipts"}
            </p>
            <button
              type="button"
              onClick={() => setShowExportModal(true)}
              className="inline-flex items-center gap-2 bg-white border border-slate-200 hover:border-brand-300 hover:text-brand-700 text-slate-600 text-sm font-medium px-4 py-2 rounded-lg shadow-sm transition"
            >
              <Mail size={16} />
              Send Month to Accountant
              <span className="text-slate-400" dir="rtl">שלח חודש זה לרואה חשבון</span>
            </button>
          </div>

          {filesInMonth.length === 0 ? (
            <div className="text-center py-16 bg-white rounded-2xl border border-slate-200">
              <p className="text-slate-500">No receipts in {ENGLISH_MONTHS[selectedMonth - 1]} {selectedYear}.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {filesInMonth.map((inv) => (
                <ReceiptFileCard
                  key={inv.id}
                  invoice={inv}
                  selected={selectedInvoiceId === inv.id}
                  onSelect={() => setSelectedInvoiceId(inv.id)}
                  onOpen={() => setLightboxInvoice(inv)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {lightboxInvoice && (
        <ReceiptLightboxModal invoice={lightboxInvoice} onClose={() => setLightboxInvoice(null)} />
      )}

      {showExportModal && (
        <SendToAccountantModal
          onClose={() => setShowExportModal(false)}
          initialMonth={selectedMonth ?? undefined}
          initialYear={selectedYear}
        />
      )}
    </div>
  );
}
