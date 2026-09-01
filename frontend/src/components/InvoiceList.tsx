import { Eye, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { api } from "../api/client";
import type { Invoice } from "../types";
import ReceiptPreviewModal from "./ReceiptPreviewModal";

export default function InvoiceList({ refreshKey }: { refreshKey: number }) {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [sortBy, setSortBy] = useState<"date" | "amount">("date");
  const [previewInvoice, setPreviewInvoice] = useState<Invoice | null>(null);

  useEffect(() => {
    setLoading(true);
    api
      .get<Invoice[]>("/invoices")
      .then(({ data }) => setInvoices(data))
      .finally(() => setLoading(false));
  }, [refreshKey]);

  const categories = useMemo(() => {
    const names = new Set(invoices.map((inv) => inv.category_name ?? "Uncategorized"));
    return ["all", ...Array.from(names)];
  }, [invoices]);

  const filtered = useMemo(() => {
    let result = invoices.filter((inv) => {
      const matchesSearch =
        inv.vendor_name.toLowerCase().includes(search.toLowerCase()) ||
        (inv.tax_id ?? "").includes(search);
      const matchesCategory = categoryFilter === "all" || (inv.category_name ?? "Uncategorized") === categoryFilter;
      return matchesSearch && matchesCategory;
    });

    result = [...result].sort((a, b) =>
      sortBy === "amount" ? b.amount - a.amount : new Date(b.date).getTime() - new Date(a.date).getTime(),
    );

    return result;
  }, [invoices, search, categoryFilter, sortBy]);

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by vendor or tax ID..."
            className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>

        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          {categories.map((c) => (
            <option key={c} value={c}>
              {c === "all" ? "All Categories" : c}
            </option>
          ))}
        </select>

        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as "date" | "amount")}
          className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          <option value="date">Sort by Date</option>
          <option value="amount">Sort by Amount</option>
        </select>
      </div>

      {loading ? (
        <p className="text-center text-slate-400 py-10">Loading invoices...</p>
      ) : filtered.length === 0 ? (
        <p className="text-center text-slate-400 py-10">No invoices match your filters.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-400 border-b border-slate-200">
                <th className="py-2 pr-4 font-medium">Vendor</th>
                <th className="py-2 pr-4 font-medium">Category</th>
                <th className="py-2 pr-4 font-medium">Date</th>
                <th className="py-2 pr-4 font-medium">Tax ID</th>
                <th className="py-2 pr-4 font-medium text-right">Amount</th>
                <th className="py-2 pr-4 font-medium text-center">Receipt</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((inv) => (
                <tr key={inv.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="py-3 pr-4 font-medium text-slate-800">
                    {inv.vendor_name}
                    {inv.ocr_source === "manual" && (
                      <span className="ml-2 text-[10px] uppercase tracking-wide text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">
                        Manual
                      </span>
                    )}
                  </td>
                  <td className="py-3 pr-4">
                    <span className="bg-brand-50 text-brand-700 text-xs px-2 py-1 rounded-full">
                      {inv.category_name ?? "Uncategorized"}
                    </span>
                  </td>
                  <td className="py-3 pr-4 text-slate-500">{new Date(inv.date).toLocaleDateString()}</td>
                  <td className="py-3 pr-4 text-slate-500 font-mono text-xs">{inv.tax_id ?? "—"}</td>
                  <td className="py-3 pr-4 text-right font-semibold text-slate-800">${inv.amount.toFixed(2)}</td>
                  <td className="py-3 pr-4 text-center">
                    <button
                      type="button"
                      onClick={() => setPreviewInvoice(inv)}
                      className="inline-flex items-center justify-center p-1.5 text-slate-400 hover:text-brand-600 hover:bg-brand-50 rounded-lg transition"
                      title="View receipt"
                    >
                      <Eye size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {previewInvoice && (
        <ReceiptPreviewModal invoice={previewInvoice} onClose={() => setPreviewInvoice(null)} />
      )}
    </div>
  );
}
