import logging
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import extract
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.dependencies import get_current_business_id
from app.models import Business, Category, Invoice
from app.schemas import (
    InvoiceConfirmRequest,
    InvoiceOut,
    InvoiceUpdate,
    MonthlyExportRequest,
    MonthlyExportResponse,
)
from app.services.email_service import send_monthly_report
from app.services.external_time_service import fetch_external_time, parse_external_datetime
from app.services.ocr_service import OCRLowConfidenceError, parse_invoice
from app.services.report_service import build_monthly_csv, build_receipts_zip

router = APIRouter(prefix="/api/invoices", tags=["invoices"])

logger = logging.getLogger("smartreceipt.invoices")

ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp", "application/pdf"}
MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB


def _to_invoice_out(invoice: Invoice) -> InvoiceOut:
    data = InvoiceOut.model_validate(invoice)
    data.category_name = invoice.category.name if invoice.category else None
    return data


def _get_or_create_uncategorized(db: Session, business_id: int) -> Category:
    category = (
        db.query(Category)
        .filter(Category.business_id == business_id, Category.name == "Uncategorized")
        .first()
    )
    if category is None:
        category = Category(business_id=business_id, name="Uncategorized")
        db.add(category)
        db.flush()
    return category


def _serialize_extracted(extracted: dict) -> dict:
    """Makes the OCR partial-extraction dict JSON-safe for the 422 error body."""
    serialized = dict(extracted)
    if "date" in serialized and hasattr(serialized["date"], "isoformat"):
        serialized["date"] = serialized["date"].isoformat()
    return serialized


@router.post("/upload", response_model=InvoiceOut, status_code=status.HTTP_201_CREATED)
async def upload_invoice(
    file: UploadFile = File(...),
    business_id: int = Depends(get_current_business_id),
    db: Session = Depends(get_db),
):
    if file.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unsupported file type. Use JPEG, PNG, WEBP or PDF.")

    file_bytes = await file.read()
    if len(file_bytes) > MAX_UPLOAD_BYTES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "File exceeds 10MB limit.")

    # Persist to a per-tenant folder so files can never leak across businesses on disk.
    # The file is saved regardless of OCR outcome, so a failed extraction can still be
    # confirmed manually against the same uploaded receipt via POST /confirm.
    tenant_dir = settings.upload_path / str(business_id)
    tenant_dir.mkdir(parents=True, exist_ok=True)
    extension = Path(file.filename or "").suffix or ".bin"
    stored_name = f"{uuid.uuid4().hex}{extension}"
    stored_path = tenant_dir / stored_name
    stored_path.write_bytes(file_bytes)

    try:
        ocr_result = parse_invoice(file.filename or stored_name, file_bytes, file.content_type)
    except OCRLowConfidenceError as exc:
        info = exc.info
        logger.warning(
            "422 on POST /api/invoices/upload: OCR could not confirm data "
            "(reason=%s, engine=%s, missing_fields=%s). filename=%r content_type=%r",
            info.reason,
            info.engine,
            info.missing_fields,
            file.filename,
            file.content_type,
        )
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "error": "INVALID_OCR_DATA",
                "message": info.message,
                "missing_fields": info.missing_fields,
                "extracted": _serialize_extracted(info.extracted),
                "file_reference": stored_path.as_posix(),
            },
        )

    external_time = await fetch_external_time()
    uploaded_at_external_time = parse_external_datetime(external_time)
    category = _get_or_create_uncategorized(db, business_id)

    invoice = Invoice(
        business_id=business_id,
        vendor_name=ocr_result.vendor_name,
        amount=ocr_result.amount,
        date=ocr_result.date,
        tax_id=ocr_result.tax_id,
        category_id=category.id,
        file_path=stored_path.as_posix(),
        ocr_source="ocr",
        uploaded_at_external_time=uploaded_at_external_time,
    )
    db.add(invoice)
    db.commit()
    db.refresh(invoice)

    return _to_invoice_out(invoice)


@router.post("/confirm", response_model=InvoiceOut, status_code=status.HTTP_201_CREATED)
async def confirm_invoice(
    payload: InvoiceConfirmRequest,
    business_id: int = Depends(get_current_business_id),
    db: Session = Depends(get_db),
):
    """Finalizes an invoice from user-confirmed data after /upload returned 422
    INVALID_OCR_DATA. The referenced file must already sit inside this tenant's
    upload folder (written by /upload) - guards against path traversal / cross-tenant
    file references."""
    tenant_dir = (settings.upload_path / str(business_id)).resolve()
    resolved_file = Path(payload.file_reference).resolve()
    if not resolved_file.is_relative_to(tenant_dir) or not resolved_file.is_file():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unknown or inaccessible file_reference.")

    if payload.category_id is not None:
        category = db.get(Category, payload.category_id)
        if category is None or category.business_id != business_id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid category_id.")
    else:
        category = _get_or_create_uncategorized(db, business_id)

    external_time = await fetch_external_time()
    uploaded_at_external_time = parse_external_datetime(external_time)

    invoice = Invoice(
        business_id=business_id,
        vendor_name=payload.vendor_name,
        amount=payload.amount,
        date=payload.date,
        tax_id=payload.tax_id,
        category_id=category.id,
        file_path=payload.file_reference,
        ocr_source="manual",
        uploaded_at_external_time=uploaded_at_external_time,
    )
    db.add(invoice)
    db.commit()
    db.refresh(invoice)

    return _to_invoice_out(invoice)


@router.post("/export-monthly", response_model=MonthlyExportResponse)
async def export_monthly(
    payload: MonthlyExportRequest,
    business_id: int = Depends(get_current_business_id),
    db: Session = Depends(get_db),
):
    business = db.get(Business, business_id)

    invoices = (
        db.query(Invoice)
        .filter(
            Invoice.business_id == business_id,
            extract("month", Invoice.date) == payload.month,
            extract("year", Invoice.date) == payload.year,
        )
        .order_by(Invoice.date)
        .all()
    )

    total = round(sum(inv.amount for inv in invoices), 2)
    csv_bytes = build_monthly_csv(business, payload.month, payload.year, invoices)
    zip_bytes = build_receipts_zip(invoices)

    mode = send_monthly_report(
        to_email=payload.email,
        business_name=business.name,
        month=payload.month,
        year=payload.year,
        invoice_count=len(invoices),
        total=total,
        csv_bytes=csv_bytes,
        zip_bytes=zip_bytes,
    )

    return MonthlyExportResponse(
        status="sent",
        mode=mode,
        invoice_count=len(invoices),
        total=total,
        recipient=payload.email,
    )


@router.get("", response_model=list[InvoiceOut])
def list_invoices(
    business_id: int = Depends(get_current_business_id),
    db: Session = Depends(get_db),
):
    invoices = (
        db.query(Invoice)
        .filter(Invoice.business_id == business_id)
        .order_by(Invoice.date.desc())
        .all()
    )
    return [_to_invoice_out(inv) for inv in invoices]


@router.get("/{invoice_id}", response_model=InvoiceOut)
def get_invoice(
    invoice_id: int,
    business_id: int = Depends(get_current_business_id),
    db: Session = Depends(get_db),
):
    invoice = (
        db.query(Invoice)
        .filter(Invoice.id == invoice_id, Invoice.business_id == business_id)
        .first()
    )
    if invoice is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invoice not found")
    return _to_invoice_out(invoice)


@router.get("/{invoice_id}/file")
def get_invoice_file(
    invoice_id: int,
    business_id: int = Depends(get_current_business_id),
    db: Session = Depends(get_db),
):
    """Serves the original receipt file for one invoice, scoped to the caller's
    business so tenants can never fetch each other's receipts."""
    invoice = (
        db.query(Invoice)
        .filter(Invoice.id == invoice_id, Invoice.business_id == business_id)
        .first()
    )
    if invoice is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invoice not found")

    file_path = Path(invoice.file_path)
    if not file_path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Receipt file is missing on disk")

    return FileResponse(file_path)


@router.put("/{invoice_id}", response_model=InvoiceOut)
@router.patch("/{invoice_id}", response_model=InvoiceOut)
def update_invoice(
    invoice_id: int,
    payload: InvoiceUpdate,
    business_id: int = Depends(get_current_business_id),
    db: Session = Depends(get_db),
):
    """Updates invoice metadata (vendor, amount, date, category) from the file
    explorer's "Edit Details" action. Registered under both PUT and PATCH since the
    frontend only ever sends the fields the edit modal actually exposes."""
    invoice = (
        db.query(Invoice)
        .filter(Invoice.id == invoice_id, Invoice.business_id == business_id)
        .first()
    )
    if invoice is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invoice not found")

    updates = payload.model_dump(exclude_unset=True)

    if "category_id" in updates and updates["category_id"] is not None:
        category = db.get(Category, updates["category_id"])
        if category is None or category.business_id != business_id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid category_id.")

    for field, value in updates.items():
        setattr(invoice, field, value)

    db.commit()
    db.refresh(invoice)
    return _to_invoice_out(invoice)


@router.delete("/{invoice_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_invoice(
    invoice_id: int,
    business_id: int = Depends(get_current_business_id),
    db: Session = Depends(get_db),
):
    invoice = (
        db.query(Invoice)
        .filter(Invoice.id == invoice_id, Invoice.business_id == business_id)
        .first()
    )
    if invoice is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invoice not found")

    file_path = Path(invoice.file_path)

    db.delete(invoice)
    db.commit()

    # Best-effort: the DB row is already gone, which is the source of truth for the
    # UI, so a stray file on disk is a cleanup miss rather than a data-integrity issue.
    if file_path.is_file():
        try:
            file_path.unlink()
        except OSError:
            pass
