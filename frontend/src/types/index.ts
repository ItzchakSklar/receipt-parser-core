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
  invoice_number: string | null;
  category_id: number | null;
  category_name: string | null;
  file_name: string;
  file_content_type: string;
  ocr_source: 'ocr' | 'manual';
  is_unrecognized: boolean;
  uploaded_at_external_time: string;
  created_at: string;
  /** Only on the POST /invoices/upload response for an unrecognized file. */
  ocr_reason?:
    | 'corrupt_file'
    | 'low_confidence'
    | 'missing_fields'
    | 'engine_error'
    | 'no_ocr_engine_available'
    | null;
  ocr_missing_fields?: string[];
}

/** Payload for POST /invoices/unrecognized/{id}/sort, submitted from the "לא מזוהים"
 * review modal to manually confirm the real fields for a receipt OCR couldn't read. */
export interface UnrecognizedSortPayload {
  vendor_name: string;
  amount: number;
  date: string;
  tax_id: string | null;
  invoice_number: string | null;
  category_id: number | null;
}

/** The new side of a DUPLICATE_CONFLICT response — not yet a saved invoice, just the
 * OCR read (or the user's completed fields) plus a reference to where its file is. */
export interface ExtractedReceiptData {
  vendor_name: string;
  amount: number;
  date: string;
  tax_id: string | null;
  invoice_number: string | null;
  file_name?: string;
  /** Set when the new side is an upload the server is holding in memory... */
  file_reference?: string;
  /** ...or when it's an unrecognized row whose manual completion collided. */
  new_invoice_id?: number;
}

export interface DuplicateExistsDetail {
  error: 'DUPLICATE_EXISTS';
  message: string;
  existing_invoice: Invoice;
}

export interface DuplicateConflictDetail {
  error: 'DUPLICATE_CONFLICT';
  message: string;
  existing_invoice: Invoice;
  new_data: ExtractedReceiptData;
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
