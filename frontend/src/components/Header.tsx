import { LogOut, Receipt } from "lucide-react";

import { useAuth } from "../context/AuthContext";
import LiveClock from "./LiveClock";

const TABS = [
  { id: "dashboard", label: "Dashboard" },
  { id: "upload", label: "Upload" },
  { id: "invoices", label: "Invoices" },
] as const;

export type TabId = (typeof TABS)[number]["id"];

interface HeaderProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}

export default function Header({ activeTab, onTabChange }: HeaderProps) {
  const { business, user, logout } = useAuth();

  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <div className="bg-brand-600 text-white p-2 rounded-xl">
            <Receipt size={20} />
          </div>
          <div className="leading-tight">
            <div className="font-bold text-slate-800">SmartReceipt</div>
            <div className="text-xs text-slate-400">{business?.name}</div>
          </div>
        </div>

        <nav className="hidden sm:flex items-center gap-1 bg-slate-100 rounded-lg p-1">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition ${
                activeTab === tab.id ? "bg-white shadow text-brand-700" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <LiveClock />
          <div className="hidden md:block text-right leading-tight">
            <div className="text-sm font-medium text-slate-700">{user?.email}</div>
            <div className="text-xs text-slate-400 capitalize">{user?.role}</div>
          </div>
          <button
            onClick={logout}
            className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
            title="Log out"
          >
            <LogOut size={18} />
          </button>
        </div>
      </div>

      <nav className="flex sm:hidden border-t border-slate-200">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`flex-1 py-2 text-sm font-medium ${
              activeTab === tab.id ? "text-brand-700 border-b-2 border-brand-600" : "text-slate-500"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </nav>
    </header>
  );
}
