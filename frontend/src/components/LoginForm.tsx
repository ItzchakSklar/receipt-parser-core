import { Receipt } from "lucide-react";
import { useState, type FormEvent } from "react";

import { useAuth } from "../context/AuthContext";

export default function LoginForm() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("owner@acme.demo");
  const [password, setPassword] = useState("password123");
  const [businessName, setBusinessName] = useState("");
  const [businessTaxId, setBusinessTaxId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === "login") {
        await login(email, password);
      } else {
        await register(businessName, businessTaxId, email, password);
      }
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-brand-50 to-slate-100 px-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-8">
        <div className="flex items-center gap-2 mb-6">
          <div className="bg-brand-600 text-white p-2 rounded-xl">
            <Receipt size={24} />
          </div>
          <h1 className="text-2xl font-bold text-slate-800">SmartReceipt</h1>
        </div>

        <div className="flex mb-6 bg-slate-100 rounded-lg p-1">
          <button
            className={`flex-1 py-2 text-sm font-medium rounded-md transition ${
              mode === "login" ? "bg-white shadow text-brand-700" : "text-slate-500"
            }`}
            onClick={() => setMode("login")}
            type="button"
          >
            Sign In
          </button>
          <button
            className={`flex-1 py-2 text-sm font-medium rounded-md transition ${
              mode === "register" ? "bg-white shadow text-brand-700" : "text-slate-500"
            }`}
            onClick={() => setMode("register")}
            type="button"
          >
            New Business
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === "register" && (
            <>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Business Name</label>
                <input
                  required
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Tax ID (ח"פ)</label>
                <input
                  required
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  value={businessTaxId}
                  onChange={(e) => setBusinessTaxId(e.target.value)}
                />
              </div>
            </>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">Email</label>
            <input
              required
              type="email"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">Password</label>
            <input
              required
              type="password"
              minLength={6}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white font-medium py-2.5 rounded-lg transition"
          >
            {loading ? "Please wait..." : mode === "login" ? "Sign In" : "Create Business"}
          </button>
        </form>

        {mode === "login" && (
          <p className="text-xs text-slate-400 mt-4 text-center">
            Demo: owner@acme.demo / password123 (run backend seed.py first)
          </p>
        )}
      </div>
    </div>
  );
}
