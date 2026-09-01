"""Invoice/receipt OCR parsing.

Zero-hallucination policy: this module NEVER invents data. It tries real OCR backends
(pytesseract, then EasyOCR, then embedded-text extraction for PDFs) and only returns a
result when the critical fields (vendor, amount, date, tax id) were actually read with
acceptable confidence. If no backend is installed, the file is unreadable, or
confidence is too low, `parse_invoice` raises `OCRLowConfidenceError` instead of
returning fabricated data - callers must ask the user to re-upload a clearer file or
confirm the fields manually.
"""

import re
from dataclasses import dataclass, field
from datetime import date

REQUIRED_FIELDS = ["vendor_name", "amount", "date", "tax_id"]
CONFIDENCE_THRESHOLD = 60.0  # percent; below this an OCR engine's read is not trusted

# Matches an Israeli company/business tax id (ח"פ) - 9 digits.
TAX_ID_PATTERN = re.compile(r"\b\d{9}\b")
AMOUNT_PATTERN = re.compile(r"(?:total|amount|סה\"?כ)\D{0,10}(\d+(?:\.\d{1,2})?)", re.IGNORECASE)
DATE_PATTERN = re.compile(r"\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})\b")

_ERROR_MESSAGES = {
    "no_ocr_engine_available": "No OCR engine is available to read this receipt automatically.",
    "missing_fields": "Some required fields could not be read reliably from the receipt.",
    "low_confidence": "The receipt image quality was too low to extract data reliably.",
    "engine_error": "The OCR engine failed to process this file.",
}


@dataclass
class OCRResult:
    vendor_name: str
    amount: float
    date: date
    tax_id: str
    raw_text: str
    engine: str


@dataclass
class LowConfidenceInfo:
    reason: str
    engine: str
    extracted: dict = field(default_factory=dict)
    missing_fields: list[str] = field(default_factory=lambda: list(REQUIRED_FIELDS))

    @property
    def message(self) -> str:
        base = _ERROR_MESSAGES.get(self.reason, "Could not automatically extract data from this receipt.")
        return f"{base} Please re-upload a clearer image/PDF or confirm the fields manually."


class OCRLowConfidenceError(Exception):
    """Raised instead of returning mock/guessed data when OCR cannot be trusted."""

    def __init__(self, info: LowConfidenceInfo):
        self.info = info
        super().__init__(info.reason)


def _extract_candidate_fields(text: str) -> dict:
    """Best-effort field extraction from OCR/PDF text. Returns only what it actually
    found - never fills in placeholders for fields it could not locate."""
    candidate: dict = {}
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if lines:
        candidate["vendor_name"] = lines[0]

    tax_match = TAX_ID_PATTERN.search(text)
    if tax_match:
        candidate["tax_id"] = tax_match.group(0)

    amount_match = AMOUNT_PATTERN.search(text)
    if amount_match:
        try:
            candidate["amount"] = float(amount_match.group(1))
        except ValueError:
            pass

    date_match = DATE_PATTERN.search(text)
    if date_match:
        day, month, year = date_match.groups()
        year_int = int(year) if len(year) == 4 else 2000 + int(year)
        try:
            candidate["date"] = date(year_int, int(month), int(day))
        except ValueError:
            pass

    return candidate


def _missing_fields(candidate: dict) -> list[str]:
    return [f for f in REQUIRED_FIELDS if not candidate.get(f)]


def _candidate_to_result(candidate: dict, text: str, engine: str) -> OCRResult:
    return OCRResult(
        vendor_name=candidate["vendor_name"],
        amount=candidate["amount"],
        date=candidate["date"],
        tax_id=candidate["tax_id"],
        raw_text=text,
        engine=engine,
    )


def _try_tesseract(file_bytes: bytes) -> tuple[OCRResult | None, LowConfidenceInfo | None]:
    try:
        import io

        import pytesseract
        from PIL import Image
    except ImportError:
        return None, None

    try:
        image = Image.open(io.BytesIO(file_bytes))
        text = pytesseract.image_to_string(image)
        data = pytesseract.image_to_data(image, output_type=pytesseract.Output.DICT)
        confidences = [int(c) for c in data.get("conf", []) if str(c).lstrip("-").isdigit() and int(c) >= 0]
        avg_confidence = (sum(confidences) / len(confidences)) if confidences else 0.0

        candidate = _extract_candidate_fields(text)
        missing = _missing_fields(candidate)

        if avg_confidence >= CONFIDENCE_THRESHOLD and not missing:
            return _candidate_to_result(candidate, text, engine="tesseract"), None

        reason = "low_confidence" if avg_confidence < CONFIDENCE_THRESHOLD else "missing_fields"
        return None, LowConfidenceInfo(reason=reason, engine="tesseract", extracted=candidate, missing_fields=missing)
    except Exception:
        return None, LowConfidenceInfo(reason="engine_error", engine="tesseract")


def _try_easyocr(file_bytes: bytes) -> tuple[OCRResult | None, LowConfidenceInfo | None]:
    try:
        import io

        import easyocr
        import numpy as np
        from PIL import Image
    except ImportError:
        return None, None

    try:
        image = np.array(Image.open(io.BytesIO(file_bytes)).convert("RGB"))
        reader = easyocr.Reader(["en"], gpu=False)
        results = reader.readtext(image, detail=1)
        text = "\n".join(r[1] for r in results)
        confidences = [r[2] * 100 for r in results]
        avg_confidence = (sum(confidences) / len(confidences)) if confidences else 0.0

        candidate = _extract_candidate_fields(text)
        missing = _missing_fields(candidate)

        if avg_confidence >= CONFIDENCE_THRESHOLD and not missing:
            return _candidate_to_result(candidate, text, engine="easyocr"), None

        reason = "low_confidence" if avg_confidence < CONFIDENCE_THRESHOLD else "missing_fields"
        return None, LowConfidenceInfo(reason=reason, engine="easyocr", extracted=candidate, missing_fields=missing)
    except Exception:
        return None, LowConfidenceInfo(reason="engine_error", engine="easyocr")


def _try_pdf_text(file_bytes: bytes) -> tuple[OCRResult | None, LowConfidenceInfo | None]:
    try:
        import io

        from pypdf import PdfReader
    except ImportError:
        return None, None

    try:
        reader = PdfReader(io.BytesIO(file_bytes))
        text = "\n".join(page.extract_text() or "" for page in reader.pages)
        candidate = _extract_candidate_fields(text)
        missing = _missing_fields(candidate)

        if not missing:
            return _candidate_to_result(candidate, text, engine="pypdf"), None

        return None, LowConfidenceInfo(reason="missing_fields", engine="pypdf", extracted=candidate, missing_fields=missing)
    except Exception:
        return None, LowConfidenceInfo(reason="engine_error", engine="pypdf")


def parse_invoice(filename: str, file_bytes: bytes, content_type: str | None) -> OCRResult:
    """Extracts vendor name, total amount, date, and tax id (ח"פ) from an uploaded
    receipt using real OCR/text-extraction only. Raises OCRLowConfidenceError - never
    returns fabricated data - when no engine can read the file reliably."""
    is_image = bool(content_type and content_type.startswith("image/"))
    is_pdf = content_type == "application/pdf"

    attempts: list[LowConfidenceInfo] = []

    if is_image:
        for attempt in (_try_tesseract, _try_easyocr):
            result, low_confidence = attempt(file_bytes)
            if result is not None:
                return result
            if low_confidence is not None:
                attempts.append(low_confidence)
    elif is_pdf:
        result, low_confidence = _try_pdf_text(file_bytes)
        if result is not None:
            return result
        if low_confidence is not None:
            attempts.append(low_confidence)

    if attempts:
        best = max(attempts, key=lambda a: len(REQUIRED_FIELDS) - len(a.missing_fields))
    else:
        best = LowConfidenceInfo(reason="no_ocr_engine_available", engine="none")

    raise OCRLowConfidenceError(best)
