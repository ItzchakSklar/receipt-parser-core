export interface Business {
  id: number;
  name: string;
  tax_id: string;
}

export interface User {
  id: number;
  business_id: number;
  email: string;
  role: string;
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
  user: User;
  business: Business;
}

export interface Category {
  id: number;
  business_id: number;
  name: string;
}

export interface Invoice {
  id: number;
  business_id: number;
  vendor_name: string;
  amount: number;
  date: string;
  tax_id: string | null;
  category_id: number | null;
  category_name: string | null;
  file_path: string;
  ocr_source: "ocr" | "manual";
  uploaded_at_external_time: string;
  created_at: string;
}

export interface OCRErrorDetail {
  error: string;
  message: string;
  missing_fields: string[];
  extracted: {
    vendor_name?: string;
    amount?: number;
    date?: string;
    tax_id?: string;
  };
  file_reference: string;
}

export interface MonthlyExportResponse {
  status: string;
  mode: "smtp" | "mock";
  invoice_count: number;
  total: number;
  recipient: string;
}

export interface CategoryBreakdown {
  category_id: number | null;
  category_name: string;
  total: number;
  count: number;
}

export interface MonthlyTotal {
  month: string;
  total: number;
}

export interface DashboardStats {
  total_spent: number;
  invoice_count: number;
  average_invoice: number;
  category_breakdown: CategoryBreakdown[];
  monthly_totals: MonthlyTotal[];
}

export interface ExternalTime {
  datetime: string;
  timezone: string;
  utc_offset: string | null;
  source: string;
}
