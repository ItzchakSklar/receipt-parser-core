import logging
import time
import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import Response
from sqlalchemy import extract, func
from sqlalchemy.orm import Session, undefer

from app.categories import category_id as to_category_id
from app.categories import category_name as to_category_name
from app.database import get_db
from app.dependencies import get_current_business_id
from app.models import Invoice, User
from app.schemas import (
    DuplicateResolutionRequest,
    InvoiceOut,
    InvoiceUpdate,
    MonthlyExportRequest,
    MonthlyExportResponse,
    UnrecognizedSortRequest,
)
from app.services.email_service import send_monthly_report
from app.services.external_time_service import fetch_external_time, parse_external_datetime
from app.services.ocr_service import (
    LowConfidenceInfo,
    OCRLowConfidenceError,
    OCRResult,
    parse_invoice,
)
from app.services.report_service import build_monthly_csv, build_receipts_zip

router = APIRouter(prefix="/api/invoices", tags=["invoices"])

logger = logging.getLogger("smartreceipt.invoices")

ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp", "application/pdf"}
MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB

# An upload that collides with an existing invoice (409 DUPLICATE_CONFLICT) isn't
# saved until the user picks a side in the conflict modal, so it's held here in
# memory meanwhile, keyed by the file_reference handed to the client. Entries are
# dropped once resolved, or after PENDING_UPLOAD_TTL_SECONDS if never resolved.
PENDING_UPLOAD_TTL_SECONDS = 60 * 60


@dataclass
class _PendingUpload:
    business_id: int
    file_name: str
    content_type: str
    content: bytes
    created_at: float


_pending_uploads: dict[str, _PendingUpload] = {}

# Tolerance for comparing OCR-read amounts against a previously stored value -
# floats and repeated OCR passes can differ by fractions of a cent.
AMOUNT_TOLERANCE = 0.01


def _to_invoice_out(invoice: Invoice) -> InvoiceOut:
    data = InvoiceOut.model_validate(invoice)
    data.category_id = to_category_id(invoice.category)
    data.category_name = invoice.category
    return data


def _resolve_category(category_id: int | None) -> str | None:
    try:
        return to_category_name(category_id)
    except ValueError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid category_id.") from None


def _hold_pending_upload(
    business_id: int, file_name: str, content_type: str, content: bytes
) -> str:
    now = time.monotonic()
    expired = [
        key
        for key, pending in _pending_uploads.items()
        if now - pending.created_at > PENDING_UPLOAD_TTL_SECONDS
    ]
    for key in expired:
        del _pending_uploads[key]
    file_reference = f"{uuid.uuid4().hex}{Path(file_name).suffix.lower()}"
    _pending_uploads[file_reference] = _PendingUpload(
        business_id, file_name, content_type, content, now
    )
    return file_reference


def _get_pending_upload(business_id: int, file_reference: str) -> _PendingUpload:
    """Tenant-checked lookup of a held conflict upload, so one business can never
    read or claim another's pending file by guessing its reference."""
    pending = _pending_uploads.get(file_reference)
    if pending is None or pending.business_id != business_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unknown or expired file_reference.")
    return pending


def _save_as_unrecognized(
    db: Session,
    business_id: int,
    file_name: str,
    content_type: str,
    content: bytes,
    info: LowConfidenceInfo,
    uploaded_at_external_time: datetime,
) -> Invoice:
    """Saves an unreadable upload as an Invoice row flagged is_unrecognized=True,
    using whatever OCR fragments (if any) it managed to read and filename/current-
    time placeholders for the rest. Never fabricates data presented as OCR-confirmed
    - the placeholders are only ever shown behind the is_unrecognized flag until a
    human confirms real values via POST /unrecognized/{id}/sort."""
    extracted_date = info.extracted.get("date")
    invoice_date: datetime
    if isinstance(extracted_date, date):
        invoice_date = datetime(extracted_date.year, extracted_date.month, extracted_date.day)
    else:
        invoice_date = datetime.now(UTC)

    invoice = Invoice(
        business_id=business_id,
        vendor_name=info.extracted.get("vendor_name") or file_name,
        amount=info.extracted.get("amount") or 0.0,
        date=invoice_date,
        tax_id=info.extracted.get("tax_id"),
        invoice_number=info.extracted.get("invoice_number"),
        file_name=file_name,
        file_content_type=content_type,
        file_content=content,
        ocr_source="manual",
        is_unrecognized=True,
        uploaded_at_external_time=uploaded_at_external_time,
    )
    db.add(invoice)
    db.commit()
    db.refresh(invoice)
    return invoice


def _find_potential_duplicate(
    db: Session, business_id: int, vendor_name: str, invoice_number: str
) -> Invoice | None:
    """Looks up an existing invoice with the same vendor and invoice number for this
    business. Matching is case/whitespace-insensitive since OCR reads of the same
    printed text can vary in casing across two scans of the same receipt."""
    return (
        db.query(Invoice)
        .filter(
            Invoice.business_id == business_id,
            Invoice.invoice_number.isnot(None),
            func.lower(func.trim(Invoice.invoice_number)) == invoice_number.strip().lower(),
            func.lower(func.trim(Invoice.vendor_name)) == vendor_name.strip().lower(),
        )
        .first()
    )


def _find_exact_match_by_tax_id(
    db: Session, business_id: int, vendor_name: str, tax_id: str, amount: float, date_value
) -> Invoice | None:
    """Fallback duplicate signal for when no invoice number was extracted (or it
    didn't match any existing record): same business, vendor and tax id, with an
    identical amount and date, is treated as the same physical receipt scanned
    twice. Only ever returns an exact match by construction - amount/date equality
    is checked below - so callers never need to branch on conflict here. Amount and
    date are compared in Python rather than in SQL since amount needs a tolerance
    and Invoice.date is a datetime while date_value is a bare date."""
    candidates = (
        db.query(Invoice)
        .filter(
            Invoice.business_id == business_id,
            Invoice.tax_id.isnot(None),
            func.lower(func.trim(Invoice.tax_id)) == tax_id.strip().lower(),
            func.lower(func.trim(Invoice.vendor_name)) == vendor_name.strip().lower(),
        )
        .all()
    )
    for candidate in candidates:
        if (
            abs(candidate.amount - amount) < AMOUNT_TOLERANCE
            and candidate.date.date() == date_value
        ):
            return candidate
    return None


def _is_exact_match(existing: Invoice, ocr_result: OCRResult) -> bool:
    same_amount = abs(existing.amount - ocr_result.amount) < AMOUNT_TOLERANCE
    same_date = existing.date.date() == ocr_result.date
    return same_amount and same_date


def _check_for_duplicate(
    db: Session,
    business_id: int,
    ocr_result: OCRResult,
    file_name: str,
    content_type: str,
    content: bytes,
) -> None:
    """Raises 409 DUPLICATE_EXISTS or DUPLICATE_CONFLICT when this upload matches an
    existing invoice. Vendor + invoice number is the primary key; when OCR couldn't
    read an invoice number off this receipt (or it doesn't match anything), this
    falls back to vendor + tax id with an identical amount and date, so a duplicate
    upload of a receipt without a machine-readable invoice number still gets caught
    instead of silently skipping the check altogether."""
    duplicate: Invoice | None = None
    matched_by_invoice_number = False

    if ocr_result.invoice_number:
        duplicate = _find_potential_duplicate(
            db, business_id, ocr_result.vendor_name, ocr_result.invoice_number
        )
        matched_by_invoice_number = duplicate is not None

    if duplicate is None and ocr_result.tax_id:
        duplicate = _find_exact_match_by_tax_id(
            db,
            business_id,
            ocr_result.vendor_name,
            ocr_result.tax_id,
            ocr_result.amount,
            ocr_result.date,
        )

    if duplicate is None:
        return

    if matched_by_invoice_number and not _is_exact_match(duplicate, ocr_result):
        file_reference = _hold_pending_upload(business_id, file_name, content_type, content)
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail={
                "error": "DUPLICATE_CONFLICT",
                "message": "An invoice with this vendor and invoice number already exists with different data.",
                "existing_invoice": _to_invoice_out(duplicate).model_dump(mode="json"),
                "new_data": {
                    "vendor_name": ocr_result.vendor_name,
                    "amount": ocr_result.amount,
                    "date": ocr_result.date.isoformat(),
                    "tax_id": ocr_result.tax_id,
                    "invoice_number": ocr_result.invoice_number,
                    "file_reference": file_reference,
                },
            },
        )

    # Either matched by invoice number with identical data, or matched via the
    # tax-id fallback (which by construction already requires identical amount/date).
    # Either way, nothing new to keep - reject outright.
    raise HTTPException(
        status.HTTP_409_CONFLICT,
        detail={
            "error": "DUPLICATE_EXISTS",
            "message": "This receipt is already uploaded to the system.",
            "existing_invoice": _to_invoice_out(duplicate).model_dump(mode="json"),
        },
    )


@router.post("/upload", response_model=InvoiceOut, status_code=status.HTTP_201_CREATED)
async def upload_invoice(
    file: UploadFile = File(...),
    business_id: int = Depends(get_current_business_id),
    db: Session = Depends(get_db),
):
    if file.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Unsupported file type. Use JPEG, PNG, WEBP or PDF."
        )

    file_bytes = await file.read()
    logger.info(
        "Upload received: filename=%r content_type=%r size_bytes=%d",
        file.filename,
        file.content_type,
        len(file_bytes),
    )
    if len(file_bytes) > MAX_UPLOAD_BYTES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "File exceeds 10MB limit.")

    # The file is saved regardless of OCR outcome - a failed extraction lands in the
    # "לא מזוהים" folder for manual review rather than being discarded or rejected.
    file_name = file.filename or f"receipt-{uuid.uuid4().hex[:8]}"

    try:
        ocr_result = parse_invoice(file_name, file_bytes, file.content_type)
    except OCRLowConfidenceError as exc:
        info = exc.info
        logger.warning(
            "OCR could not confirm data on POST /api/invoices/upload - saving as "
            "unrecognized for manual review (reason=%s, engine=%s, missing_fields=%s). "
            "filename=%r content_type=%r",
            info.reason,
            info.engine,
            info.missing_fields,
            file.filename,
            file.content_type,
        )
        external_time = await fetch_external_time()
        uploaded_at_external_time = parse_external_datetime(external_time)
        invoice = _save_as_unrecognized(
            db,
            business_id,
            file_name,
            file.content_type,
            file_bytes,
            info,
            uploaded_at_external_time,
        )
        return _to_invoice_out(invoice)

    _check_for_duplicate(db, business_id, ocr_result, file_name, file.content_type, file_bytes)

    external_time = await fetch_external_time()
    uploaded_at_external_time = parse_external_datetime(external_time)

    invoice = Invoice(
        business_id=business_id,
        vendor_name=ocr_result.vendor_name,
        amount=ocr_result.amount,
        date=ocr_result.date,
        tax_id=ocr_result.tax_id,
        invoice_number=ocr_result.invoice_number,
        file_name=file_name,
        file_content_type=file.content_type,
        file_content=file_bytes,
        ocr_source="ocr",
        uploaded_at_external_time=uploaded_at_external_time,
    )
    db.add(invoice)
    db.commit()
    db.refresh(invoice)

    return _to_invoice_out(invoice)


@router.get("/file-preview")
def get_file_preview(
    file_reference: str,
    business_id: int = Depends(get_current_business_id),
):
    """Serves a not-yet-saved conflict upload (held in memory by /upload) so the
    conflict-resolution modal can render the new image before the user decides
    whether to keep it."""
    pending = _get_pending_upload(business_id, file_reference)
    return Response(pending.content, media_type=pending.content_type)


@router.post("/resolve-conflict", response_model=InvoiceOut)
async def resolve_conflict(
    payload: DuplicateResolutionRequest,
    business_id: int = Depends(get_current_business_id),
    db: Session = Depends(get_db),
):
    """Finalizes the user's choice after /upload returned 409 DUPLICATE_CONFLICT:
    either discard the new upload and keep the existing invoice untouched, or
    overwrite the existing invoice with the newly uploaded file and its data."""
    pending = _get_pending_upload(business_id, payload.file_reference)

    existing = (
        db.query(Invoice)
        .filter(Invoice.id == payload.existing_invoice_id, Invoice.business_id == business_id)
        .first()
    )
    if existing is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Existing invoice not found.")

    del _pending_uploads[payload.file_reference]
    if payload.action == "keep_existing":
        return _to_invoice_out(existing)

    # action == "update_with_new": overwrite the existing record, file included.
    external_time = await fetch_external_time()

    existing.vendor_name = payload.vendor_name
    existing.amount = payload.amount
    existing.date = payload.date
    existing.tax_id = payload.tax_id
    existing.invoice_number = payload.invoice_number
    existing.file_name = pending.file_name
    existing.file_content_type = pending.content_type
    existing.file_content = pending.content
    existing.ocr_source = "ocr"
    existing.uploaded_at_external_time = parse_external_datetime(external_time)
    db.commit()
    db.refresh(existing)
    return _to_invoice_out(existing)


@router.post("/export-monthly", response_model=MonthlyExportResponse)
async def export_monthly(
    payload: MonthlyExportRequest,
    business_id: int = Depends(get_current_business_id),
    db: Session = Depends(get_db),
):
    business = db.get(User, business_id)

    invoices = (
        db.query(Invoice)
        .filter(
            Invoice.business_id == business_id,
            Invoice.is_unrecognized.is_(False),
            extract("month", Invoice.date) == payload.month,
            extract("year", Invoice.date) == payload.year,
        )
        .order_by(Invoice.date)
        .options(undefer(Invoice.file_content))
        .all()
    )

    total = round(sum(inv.amount for inv in invoices), 2)
    csv_bytes = build_monthly_csv(business, payload.month, payload.year, invoices)
    zip_bytes = build_receipts_zip(invoices)

    mode = send_monthly_report(
        to_email=payload.email,
        business_name=business.business_name,
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
    """Lists confirmed invoices only - files still awaiting manual review sit in the
    "לא מזוהים" folder (GET /unrecognized) and are never mixed into the normal
    Year/Month explorer or dashboard totals."""
    invoices = (
        db.query(Invoice)
        .filter(Invoice.business_id == business_id, Invoice.is_unrecognized.is_(False))
        .order_by(Invoice.date.desc())
        .all()
    )
    return [_to_invoice_out(inv) for inv in invoices]


@router.get("/unrecognized", response_model=list[InvoiceOut])
def list_unrecognized_invoices(
    business_id: int = Depends(get_current_business_id),
    db: Session = Depends(get_db),
):
    """Files OCR could not read reliably, saved but awaiting manual sorting - backs
    the persistent "לא מזוהים" folder shown at the top level of the File Explorer."""
    invoices = (
        db.query(Invoice)
        .filter(Invoice.business_id == business_id, Invoice.is_unrecognized.is_(True))
        .order_by(Invoice.created_at.desc())
        .all()
    )
    return [_to_invoice_out(inv) for inv in invoices]


@router.post("/unrecognized/{invoice_id}/sort", response_model=InvoiceOut)
def sort_unrecognized_invoice(
    invoice_id: int,
    payload: UnrecognizedSortRequest,
    business_id: int = Depends(get_current_business_id),
    db: Session = Depends(get_db),
):
    """Applies the user-confirmed vendor/amount/date (and optional tax id/category)
    for a receipt that landed in "לא מזוהים" and clears is_unrecognized, so it now
    appears under its proper Year/Month folder."""
    invoice = (
        db.query(Invoice)
        .filter(
            Invoice.id == invoice_id,
            Invoice.business_id == business_id,
            Invoice.is_unrecognized.is_(True),
        )
        .first()
    )
    if invoice is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unrecognized invoice not found")

    category = _resolve_category(payload.category_id)

    invoice.vendor_name = payload.vendor_name
    invoice.amount = payload.amount
    invoice.date = payload.date
    invoice.tax_id = payload.tax_id
    invoice.invoice_number = payload.invoice_number
    invoice.category = category
    invoice.ocr_source = "manual"
    invoice.is_unrecognized = False
    db.commit()
    db.refresh(invoice)

    return _to_invoice_out(invoice)


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
        .options(undefer(Invoice.file_content))
        .first()
    )
    if invoice is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invoice not found")

    return Response(invoice.file_content, media_type=invoice.file_content_type)


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

    if "category_id" in updates:
        updates["category"] = _resolve_category(updates.pop("category_id"))

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

    db.delete(invoice)
    db.commit()
