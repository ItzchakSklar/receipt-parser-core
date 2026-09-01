import { useState } from "react";

import Dashboard from "./components/Dashboard";
import Header, { type TabId } from "./components/Header";
import InvoiceExplorer from "./components/InvoiceExplorer";
import LoginForm from "./components/LoginForm";
import UploadZone from "./components/UploadZone";
import { useAuth } from "./context/AuthContext";

export default function App() {
  const { isAuthenticated } = useAuth();
  const [activeTab, setActiveTab] = useState<TabId>("dashboard");
  const [refreshKey, setRefreshKey] = useState(0);

  if (!isAuthenticated) {
    return <LoginForm />;
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <Header activeTab={activeTab} onTabChange={setActiveTab} />

      <main className="max-w-6xl mx-auto px-4 py-6">
        {activeTab === "dashboard" && <Dashboard refreshKey={refreshKey} />}

        {activeTab === "upload" && (
          <div className="max-w-xl mx-auto">
            <UploadZone
              onUploaded={() => {
                setRefreshKey((k) => k + 1);
                setActiveTab("invoices");
              }}
            />
          </div>
        )}

        {activeTab === "invoices" && <InvoiceExplorer refreshKey={refreshKey} />}
      </main>
    </div>
  );
}
