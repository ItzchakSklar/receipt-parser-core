import { createContext, useContext, useState, type ReactNode } from 'react';

import { api } from '../api/client';
import type { Business, User } from '../types';

interface AuthContextValue {
  user: User | null;
  business: Business | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (
    businessName: string,
    businessTaxId: string,
    email: string,
    password: string,
  ) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function readStored<T>(key: string): T | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => readStored<User>('smartreceipt_user'));
  const [business, setBusiness] = useState<Business | null>(() =>
    readStored<Business>('smartreceipt_business'),
  );

  function persistSession(token: string, nextUser: User, nextBusiness: Business) {
    localStorage.setItem('smartreceipt_token', token);
    localStorage.setItem('smartreceipt_user', JSON.stringify(nextUser));
    localStorage.setItem('smartreceipt_business', JSON.stringify(nextBusiness));
    setUser(nextUser);
    setBusiness(nextBusiness);
  }

  async function login(email: string, password: string) {
    const { data } = await api.post('/auth/login', { email, password });
    persistSession(data.access_token, data.user, data.business);
  }

  async function register(
    businessName: string,
    businessTaxId: string,
    email: string,
    password: string,
  ) {
    const { data } = await api.post('/auth/register', {
      business_name: businessName,
      business_tax_id: businessTaxId,
      email,
      password,
    });
    persistSession(data.access_token, data.user, data.business);
  }

  function logout() {
    localStorage.removeItem('smartreceipt_token');
    localStorage.removeItem('smartreceipt_user');
    localStorage.removeItem('smartreceipt_business');
    setUser(null);
    setBusiness(null);
  }

  return (
    <AuthContext.Provider
      value={{ user, business, isAuthenticated: !!user, login, register, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
