import logging
import re
import time
import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime
from difflib import SequenceMatcher
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import Response
from sqlalchemy import func
from sqlalchemy.orm import Session, undefer

from app.categories import category_id as to_category_id
from app.categories import category_label
from app.categories import category_name as to_category_name
from app.database import get_db
from app.dependencies import get_current_business_id
from app.models import Invoice
from app.schemas import (
    DuplicateResolutionRequest,
    InvoiceOut,
    InvoiceUpdate,
    UnrecognizedSortRequest,
)
from app.services.external_time_service import fetch_external_time, parse_external_datetime
from app.services.ocr_service import (
    LowConfidenceInfo,
    OCRLowConfidenceError,
    OCRResult,
    parse_invoice,
)

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
    data.category_name = category_label(invoice.category)
    return data


def _resolve_category(category_id: int | None) -> str | None:
    try:
        return to_category_name(category_id)
    except ValueError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "קטגוריה לא תקינה.") from None


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
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "הקובץ הזמני לא נמצא או שפג תוקפו.")
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


@dataclass
class _ReceiptFields:
    """The fields duplicate detection compares - filled from an OCR read on upload,
    or from the values a user typed in when completing an unrecognized receipt."""

    vendor_name: str
    amount: float
    date: date
    tax_id: str | None
    invoice_number: str | None


# Stripped before comparing vendor names - legal-entity suffixes and punctuation that
# one scan may print or OCR may read and another may not.
_VENDOR_NOISE = re.compile(r'בע"?מ|בע״מ|\bltd\b|\binc\b|\bco\b|["\'״׳.,\-()]', re.IGNORECASE)
VENDOR_SIMILARITY_THRESHOLD = 0.8


def _vendor_key(name: str) -> str:
    return " ".join(_VENDOR_NOISE.sub(" ", name.lower()).split())


def _similar_vendor(a: str, b: str) -> bool:
    """Two reads of the same printed vendor name rarely come out identical (a stray
    quote, "בע"מ" read on one scan only, one misread letter), so exact equality would
    let the same receipt in twice under slightly different names."""
    key_a, key_b = _vendor_key(a), _vendor_key(b)
    if not key_a or not key_b:
        return False
    if key_a == key_b or (min(len(key_a), len(key_b)) >= 3 and (key_a in key_b or key_b in key_a)):
        return True
    return SequenceMatcher(None, key_a, key_b).ratio() >= VENDOR_SIMILARITY_THRESHOLD


def _same_receipt_data(existing: Invoice, fields: _ReceiptFields) -> bool:
    same_amount = abs(existing.amount - fields.amount) < AMOUNT_TOLERANCE
    same_date = existing.date.date() == fields.date
    same_tax_id = (
        not existing.tax_id or not fields.tax_id or existing.tax_id.strip() == fields.tax_id.strip()
    )
    return same_amount and same_date and same_tax_id


def _find_identical_file(db: Session, business_id: int, content: bytes) -> Invoice | None:
    return (
        db.query(Invoice)
        .filter(
            Invoice.business_id == business_id,
            func.length(Invoice.file_content) == len(content),
            Invoice.file_content == content,
        )
        .first()
    )


def _find_duplicate(
    db: Session, business_id: int, fields: _ReceiptFields, exclude_id: int | None = None
) -> tuple[Invoice | None, bool]:
    """Returns (matching invoice, is_conflict) - a match with identical amount/date/tax
    id is an exact duplicate, anything else a conflict the user must resolve. Same
    invoice number + similar vendor is the primary key. When either side has no
    invoice number (often the case: OCR may miss it, and rows completed by hand
    before the form had that field never got one), a similar vendor on the same date
    is enough to ask - the user can still keep both if they really are two purchases.
    Two different invoice numbers are never the same receipt. Unrecognized rows are
    skipped - their vendor/amount/date are placeholders, not data to match against."""
    base = db.query(Invoice).filter(
        Invoice.business_id == business_id, Invoice.is_unrecognized.is_(False)
    )
    if exclude_id is not None:
        base = base.filter(Invoice.id != exclude_id)

    new_number = (fields.invoice_number or "").strip().lower()
    if new_number:
        candidates = base.filter(
            func.lower(func.trim(Invoice.invoice_number)) == new_number,
        ).all()
        for candidate in candidates:
            if _similar_vendor(candidate.vendor_name, fields.vendor_name):
                return candidate, not _same_receipt_data(candidate, fields)

    # Invoice.date is a datetime; compared as a date in Python, like _same_receipt_data.
    same_vendor_and_date = [
        candidate
        for candidate in base.all()
        if candidate.date.date() == fields.date
        and _similar_vendor(candidate.vendor_name, fields.vendor_name)
    ]
    for candidate in same_vendor_and_date:
        if new_number and (candidate.invoice_number or "").strip():
            continue  # both numbered, and the numbers differ - different receipts
        return candidate, not _same_receipt_data(candidate, fields)

    return None, False


def _duplicate_exists_error(existing: Invoice) -> HTTPException:
    return HTTPException(
        status.HTTP_409_CONFLICT,
        detail={
            "error": "DUPLICATE_EXISTS",
            "message": "הקבלה הזו כבר הועלתה למערכת.",
            "existing_invoice": _to_invoice_out(existing).model_dump(mode="json"),
        },
    )


def _duplicate_conflict_error(
    existing: Invoice, fields: _ReceiptFields, file_name: str, **new_source: str | int
) -> HTTPException:
    """new_source is either file_reference (an upload held in memory) or new_invoice_id
    (an unrecognized row the user just completed) - whichever /resolve-conflict needs
    to find the new side again."""
    return HTTPException(
        status.HTTP_409_CONFLICT,
        detail={
            "error": "DUPLICATE_CONFLICT",
            "message": "נמצאה חשבונית קיימת שנראית כמו אותה קבלה, אך עם נתונים שונים.",
            "existing_invoice": _to_invoice_out(existing).model_dump(mode="json"),
            "new_data": {
                "vendor_name": fields.vendor_name,
                "amount": fields.amount,
                "date": fields.date.isoformat(),
                "tax_id": fields.tax_id,
                "invoice_number": fields.invoice_number,
                "file_name": file_name,
                **new_source,
            },
        },
    )


def _check_for_duplicate(
    db: Session,
    business_id: int,
    ocr_result: OCRResult,
    file_name: str,
    content_type: str,
    content: bytes,
) -> None:
    fields = _ReceiptFields(
        ocr_result.vendor_name,
        ocr_result.amount,
        ocr_result.date,
        ocr_result.tax_id,
        ocr_result.invoice_number,
    )
    duplicate, is_conflict = _find_duplicate(db, business_id, fields)
    if duplicate is None:
        return
    if is_conflict:
        file_reference = _hold_pending_upload(business_id, file_name, content_type, content)
        raise _duplicate_conflict_error(duplicate, fields, file_name, file_reference=file_reference)
    raise _duplicate_exists_error(duplicate)


@router.post("/upload", response_model=InvoiceOut, status_code=status.HTTP_201_CREATED)
async def upload_invoice(
    file: UploadFile = File(...),
    business_id: int = Depends(get_current_business_id),
    db: Session = Depends(get_db),
):
    if file.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "סוג קובץ לא נתמך. ניתן להעלות תמונה או קובץ PDF.",
        )

    file_bytes = await file.read()
    logger.info(
        "Upload received: filename=%r content_type=%r size_bytes=%d",
        file.filename,
        file.content_type,
        len(file_bytes),
    )
    if len(file_bytes) > MAX_UPLOAD_BYTES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "הקובץ חורג מהגודל המרבי של 10 מגה-בייט.")

    # The file is saved regardless of OCR outcome - a failed extraction lands in the
    # "לא מזוהים" folder for manual review rather than being discarded or rejected.
    file_name = file.filename or f"receipt-{uuid.uuid4().hex[:8]}"

    # The exact same file uploaded again - no need to spend tens of seconds on OCR to
    # find that out, and it catches re-uploads of unrecognized files too.
    identical = _find_identical_file(db, business_id, file_bytes)
    if identical is not None:
        raise _duplicate_exists_error(identical)

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
        out = _to_invoice_out(invoice)
        out.ocr_reason = info.reason
        out.ocr_missing_fields = info.missing_fields
        return out

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
    """Finalizes the user's choice after a 409 DUPLICATE_CONFLICT: discard the new side
    and keep the existing invoice untouched, overwrite the existing invoice with the
    new file and its data, or keep both as separate invoices. The new side is either an upload held in
    memory by /upload (file_reference) or an unrecognized row whose completion via
    /unrecognized/{id}/sort collided (new_invoice_id) - that row is removed either
    way, since its data/file ends up kept or deliberately discarded."""
    if (payload.file_reference is None) == (payload.new_invoice_id is None):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "יש לציין file_reference או new_invoice_id."
        )

    existing = (
        db.query(Invoice)
        .filter(Invoice.id == payload.existing_invoice_id, Invoice.business_id == business_id)
        .first()
    )
    if existing is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "החשבונית הקיימת לא נמצאה.")

    if payload.file_reference is not None:
        pending = _get_pending_upload(business_id, payload.file_reference)
        del _pending_uploads[payload.file_reference]
        new_file = (pending.file_name, pending.content_type, pending.content)
        ocr_source = "ocr"
    else:
        new_row = (
            db.query(Invoice)
            .filter(
                Invoice.id == payload.new_invoice_id,
                Invoice.business_id == business_id,
                Invoice.is_unrecognized.is_(True),
            )
            .options(undefer(Invoice.file_content))
            .first()
        )
        if new_row is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "הקובץ הלא מזוהה לא נמצא")
        new_file = (new_row.file_name, new_row.file_content_type, new_row.file_content)
        ocr_source = "manual"
        db.delete(new_row)

    if payload.action == "keep_existing":
        db.commit()
        return _to_invoice_out(existing)

    external_time = await fetch_external_time()

    if payload.action == "keep_both":
        # Not the same receipt after all (e.g. two purchases from one vendor on one day).
        invoice = Invoice(
            business_id=business_id,
            vendor_name=payload.vendor_name,
            amount=payload.amount,
            date=payload.date,
            tax_id=payload.tax_id,
            invoice_number=payload.invoice_number,
            file_name=new_file[0],
            file_content_type=new_file[1],
            file_content=new_file[2],
            ocr_source=ocr_source,
            uploaded_at_external_time=parse_external_datetime(external_time),
        )
        db.add(invoice)
        db.commit()
        db.refresh(invoice)
        return _to_invoice_out(invoice)

    # action == "update_with_new": overwrite the existing record, file included.
    existing.vendor_name = payload.vendor_name
    existing.amount = payload.amount
    existing.date = payload.date
    existing.tax_id = payload.tax_id
    existing.invoice_number = payload.invoice_number
    existing.file_name, existing.file_content_type, existing.file_content = new_file
    existing.ocr_source = ocr_source
    existing.uploaded_at_external_time = parse_external_datetime(external_time)
    db.commit()
    db.refresh(existing)
    return _to_invoice_out(existing)


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
        raise HTTPException(status.HTTP_404_NOT_FOUND, "הקובץ הלא מזוהה לא נמצא")

    category = _resolve_category(payload.category_id)

    # Hand-completed data gets the same duplicate check as an OCR read on upload.
    fields = _ReceiptFields(
        payload.vendor_name,
        payload.amount,
        payload.date.date(),
        payload.tax_id,
        payload.invoice_number,
    )
    duplicate, is_conflict = _find_duplicate(db, business_id, fields, exclude_id=invoice.id)
    if duplicate is not None:
        if is_conflict:
            raise _duplicate_conflict_error(
                duplicate, fields, invoice.file_name, new_invoice_id=invoice.id
            )
        raise _duplicate_exists_error(duplicate)

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
        raise HTTPException(status.HTTP_404_NOT_FOUND, "החשבונית לא נמצאה")
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
        raise HTTPException(status.HTTP_404_NOT_FOUND, "החשבונית לא נמצאה")

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
        raise HTTPException(status.HTTP_404_NOT_FOUND, "החשבונית לא נמצאה")

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
        raise HTTPException(status.HTTP_404_NOT_FOUND, "החשבונית לא נמצאה")

    db.delete(invoice)
    db.commit()
