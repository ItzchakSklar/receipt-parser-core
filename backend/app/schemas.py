from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field


# ---------- Auth / Business / User ----------

class BusinessCreate(BaseModel):
    name: str
    tax_id: str


class BusinessOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    tax_id: str


class RegisterRequest(BaseModel):
    business_name: str
    business_tax_id: str
    email: EmailStr
    password: str = Field(min_length=6)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    business_id: int
    email: EmailStr
    role: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut
    business: BusinessOut


# ---------- Category ----------

class CategoryCreate(BaseModel):
    name: str


class CategoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    business_id: int
    name: str


# ---------- Invoice ----------

class InvoiceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    business_id: int
    vendor_name: str
    amount: float
    date: datetime
    tax_id: str | None
    category_id: int | None
    category_name: str | None = None
    file_path: str
    ocr_source: str
    uploaded_at_external_time: datetime
    created_at: datetime


class InvoiceUpdate(BaseModel):
    vendor_name: str | None = Field(default=None, min_length=1)
    amount: float | None = Field(default=None, gt=0)
    date: datetime | None = None
    tax_id: str | None = None
    category_id: int | None = None


class InvoiceConfirmRequest(BaseModel):
    """Submitted after an upload fails OCR validation (422 INVALID_OCR_DATA) to
    finalize the invoice with user-confirmed, non-fabricated data."""

    file_reference: str
    vendor_name: str = Field(min_length=1)
    amount: float = Field(gt=0)
    date: datetime
    tax_id: str | None = None
    category_id: int | None = None


# ---------- Dashboard ----------

class CategoryBreakdown(BaseModel):
    category_id: int | None
    category_name: str
    total: float
    count: int


class MonthlyTotal(BaseModel):
    month: str
    total: float


class DashboardStats(BaseModel):
    total_spent: float
    invoice_count: int
    average_invoice: float
    category_breakdown: list[CategoryBreakdown]
    monthly_totals: list[MonthlyTotal]


# ---------- Monthly export ----------

class MonthlyExportRequest(BaseModel):
    email: EmailStr
    month: int = Field(ge=1, le=12)
    year: int = Field(ge=2000, le=2100)


class MonthlyExportResponse(BaseModel):
    status: str
    mode: str
    invoice_count: int
    total: float
    recipient: EmailStr


# ---------- External time ----------

class ExternalTime(BaseModel):
    datetime: str
    timezone: str
    utc_offset: str | None = None
    source: str = "worldtimeapi"
