import { Banknote, Hash, Share2, TrendingUp } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { cachedGet } from '../api/cache';
import type { DashboardStats } from '../types';
import { formatILS } from '../utils/currency';
import SendToAccountantModal from './SendToAccountantModal';

const CHART_COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ec4899', '#06b6d4', '#8b5cf6', '#ef4444'];

interface StatCardProps {
  icon: ReactNode;
  label: string;
  value: string;
}

function StatCard({ icon, label, value }: StatCardProps) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 flex items-center gap-4">
      <div className="bg-brand-50 text-brand-600 p-3 rounded-xl">{icon}</div>
      <div>
        <p className="text-sm text-slate-400">{label}</p>
        <p className="text-xl font-bold text-slate-800">{value}</p>
      </div>
    </div>
  );
}

export default function Dashboard({ refreshKey }: { refreshKey: number }) {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [showExportModal, setShowExportModal] = useState(false);

  useEffect(() => {
    setLoading(true);
    cachedGet<DashboardStats>('/dashboard/stats')
      .then(setStats)
      .finally(() => setLoading(false));
  }, [refreshKey]);

  const exportButton = (
    <div className="flex items-center justify-end">
      <button
        type="button"
        onClick={() => setShowExportModal(true)}
        className="inline-flex items-center gap-2 bg-white border border-slate-200 hover:border-brand-300 hover:text-brand-700 text-slate-600 text-sm font-medium px-4 py-2 rounded-lg shadow-sm transition"
      >
        <Share2 size={16} />
        שלח לרואה חשבון
      </button>
    </div>
  );

  if (loading) {
    return <div className="text-center py-16 text-slate-400">טוען נתונים...</div>;
  }

  if (!stats || stats.invoice_count === 0) {
    return (
      <div className="space-y-4">
        {exportButton}
        <div className="text-center py-16 bg-white rounded-2xl border border-slate-200">
          <p className="text-slate-500">עדיין אין חשבוניות. העלה קבלה כדי לראות את הנתונים שלך.</p>
        </div>
        {showExportModal && <SendToAccountantModal onClose={() => setShowExportModal(false)} />}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {exportButton}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          icon={<Banknote size={22} />}
          label="סך ההוצאות"
          value={formatILS(stats.total_spent)}
        />
        <StatCard icon={<Hash size={22} />} label="חשבוניות" value={String(stats.invoice_count)} />
        <StatCard
          icon={<TrendingUp size={22} />}
          label="ממוצע לחשבונית"
          value={formatILS(stats.average_invoice)}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
          <h3 className="font-semibold text-slate-800 mb-4">הוצאות לפי קטגוריה</h3>
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie
                data={stats.category_breakdown}
                dataKey="total"
                nameKey="category_name"
                innerRadius={60}
                outerRadius={100}
                paddingAngle={2}
              >
                {stats.category_breakdown.map((entry, index) => (
                  <Cell
                    key={entry.category_id ?? 'none'}
                    fill={CHART_COLORS[index % CHART_COLORS.length]}
                  />
                ))}
              </Pie>
              <Tooltip formatter={(value) => formatILS(Number(value))} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
          <h3 className="font-semibold text-slate-800 mb-4">הוצאות חודשיות</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={stats.monthly_totals}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} tickFormatter={(value) => `₪${value}`} />
              <Tooltip formatter={(value) => [formatILS(Number(value)), 'סה"כ']} />
              <Bar dataKey="total" fill="#6366f1" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
        <h3 className="font-semibold text-slate-800 mb-4">פירוט לפי קטגוריה</h3>
        <div className="space-y-2">
          {stats.category_breakdown.map((cat, index) => (
            <div
              key={cat.category_id ?? 'none'}
              className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0"
            >
              <div className="flex items-center gap-2">
                <span
                  className="w-2.5 h-2.5 rounded-full"
                  style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }}
                />
                <span className="text-sm text-slate-700">{cat.category_name}</span>
                <span className="text-xs text-slate-400">({cat.count})</span>
              </div>
              <span className="text-sm font-semibold text-slate-800">{formatILS(cat.total)}</span>
            </div>
          ))}
        </div>
      </div>

      {showExportModal && <SendToAccountantModal onClose={() => setShowExportModal(false)} />}
    </div>
  );
}
