"""Invoice/receipt OCR parsing.

Zero-hallucination policy: this module NEVER invents data. Every supported file is
rasterized to one PIL Image per page (see `_load_page_images`) and run through the
same recognition engines - pytesseract, then EasyOCR - so a PDF is held to exactly the
same confidence threshold and field extraction as a photographed receipt image, instead
of a separate embedded-text-only code path with no confidence signal. A result is
returned only when the critical fields (vendor, amount, date, tax id) were actually
read with acceptable confidence. If no backend is installed, the file is unreadable, or
confidence is too low, `parse_invoice` raises `OCRLowConfidenceError` instead of
returning fabricated data - callers must ask the user to re-upload a clearer file or
confirm the fields manually.
"""

import contextlib
import os
import re
import tempfile
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

REQUIRED_FIELDS = ["vendor_name", "amount", "date", "tax_id"]
CONFIDENCE_THRESHOLD = 60.0  # percent; below this an OCR engine's read is not trusted

# Matches an Israeli company/business tax id (ח"פ) - 9 digits.
TAX_ID_PATTERN = re.compile(r"\b\d{9}\b")
DATE_PATTERN = re.compile(r"\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})\b")

# Invoice/receipt reference number as printed on the document, e.g. "Invoice No: 4471",
# "Receipt # A-2024-01", "מספר חשבונית: 4471", "חשבונית מס' 4471". Best-effort only -
# not in REQUIRED_FIELDS since many receipts never print one; duplicate detection
# simply skips when it's absent rather than fabricating a key to match on. The
# captured value must contain a digit - real invoice numbers always do, and without
# that constraint a stray phrase like "...invoice number here" would match the label
# and capture the next unrelated word ("here") as a fabricated number.
INVOICE_NUMBER_PATTERN = re.compile(
    r"(?:Invoice\s*(?:No\.?|Number|#)|Receipt\s*(?:No\.?|Number|#)|"
    r"מספר\s*חשבונית|חשבונית\s*מס\'?|אסמכתא)\s*[:\-=]?\s*([A-Za-z0-9\-/]*\d[A-Za-z0-9\-/]{0,29})",
    re.IGNORECASE,
)

# Currency-aware amount, e.g. "ILS 18,427.50", "₪18427.5", "$120".
_AMOUNT_PATTERNS_BY_PRIORITY = (
    # Tier 1: the actual amount due - always preferred when present. \s* (not \D)
    # between the anchor and the number so a line break from Tesseract splitting
    # "Total Due:" and "ILS 18,427.50" onto separate lines still matches.
    re.compile(
        r'(?:Total\s+Due|סה"?כ\s+לתשלום|סך\s+הכל\s+לתשלום)\s*[:\-=]?\s*(?:ILS|₪|\$)?\s*([\d,]+\.?\d*)',
        re.IGNORECASE | re.MULTILINE,
    ),
    # Tier 2: generic total anchors. (?<!Sub)\bTotal\b deliberately excludes
    # "Subtotal" so this tier can't accidentally pick up a subtotal line.
    re.compile(
        r"(?<!Sub)\bTotal\b\s*[:\-=]?\s*(?:ILS|₪|\$)?\s*([\d,]+\.?\d*)",
        re.IGNORECASE | re.MULTILINE,
    ),
    # Tier 3: last-resort fallback, only used when no total anchor was found at all.
    re.compile(
        r"Subtotal\s*[:\-=]?\s*(?:ILS|₪|\$)?\s*([\d,]+\.?\d*)",
        re.IGNORECASE | re.MULTILINE,
    ),
)


def parse_total_amount(text: str) -> float | None:
    """Finds the receipt's total, preferring explicit "Total Due" anchors over
    generic totals, and generic totals over a bare subtotal fallback. Within a
    tier, the LAST match wins - the actual amount due typically appears at the
    bottom of a receipt, below subtotal/tax breakdown lines that come first.
    Tesseract often splits a label and its value across lines/whitespace, so
    anchors and numbers are joined with \\s* rather than requiring one line.

    If no anchor matches at all (label and value too garbled to associate),
    falls back to the largest decimal-looking number in the bottom 40% of the
    text, since the grand total is almost always the last figure on a receipt.
    """
    for pattern in _AMOUNT_PATTERNS_BY_PRIORITY:
        matches = pattern.findall(text)
        if matches:
            raw_val = matches[-1].strip().rstrip(".")
            clean_val = raw_val.replace(",", "")
            try:
                val = float(clean_val)
            except ValueError:
                continue
            if val > 0:
                return val

    lines = text.strip().split("\n")
    bottom_text = " ".join(lines[-max(1, int(len(lines) * 0.4)) :])
    all_numbers = re.findall(r"[\d,]+\.\d{2}", bottom_text)
    if all_numbers:
        return max(float(n.replace(",", "")) for n in all_numbers)

    return None


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
    invoice_number: str | None = None


@dataclass
class LowConfidenceInfo:
    reason: str
    engine: str
    extracted: dict = field(default_factory=dict)
    missing_fields: list[str] = field(default_factory=lambda: list(REQUIRED_FIELDS))

    @property
    def message(self) -> str:
        base = _ERROR_MESSAGES.get(
            self.reason, "Could not automatically extract data from this receipt."
        )
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

    invoice_number_match = INVOICE_NUMBER_PATTERN.search(text)
    if invoice_number_match:
        candidate["invoice_number"] = invoice_number_match.group(1).strip()

    amount = parse_total_amount(text)
    if amount is not None:
        candidate["amount"] = amount

    date_match = DATE_PATTERN.search(text)
    if date_match:
        day, month, year = date_match.groups()
        year_int = int(year) if len(year) == 4 else 2000 + int(year)
        with contextlib.suppress(ValueError):
            candidate["date"] = date(year_int, int(month), int(day))

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
        invoice_number=candidate.get("invoice_number"),
    )


_WINDOWS_TESSERACT_FALLBACK = r"C:\Program Files\Tesseract-OCR\tesseract.exe"

# Render resolution for PDF pages. High enough for Tesseract to read normal receipt
# font sizes; the PDF equivalent of "photograph the receipt at a decent resolution".
_PDF_RENDER_DPI = 200

# A4 long edge at _PDF_RENDER_DPI (11.69in * 200dpi ~= 2338px) - the pixel density a PDF
# page always gets. A photographed/screenshotted/scanned receipt image can arrive far
# below that (a low-res scan of a dense Hebrew line-item table can be as small as
# ~460x400px, i.e. ~35 effective DPI for a full page), which starves Tesseract of the
# pixel density it needs and produces confidently-wrong garbage rather than a low-
# confidence rejection - the zero-hallucination check can't catch what looks certain but
# is nonsense. Upscaling below this floor gives every image the same effective
# resolution a PDF page gets; already-high-res phone photos are left untouched since this
# only ever scales up, never down.
_MIN_OCR_LONG_EDGE_PX = 2000


def _upscale_for_ocr(image):
    from PIL import Image

    long_edge = max(image.size)
    if long_edge >= _MIN_OCR_LONG_EDGE_PX:
        return image
    scale = _MIN_OCR_LONG_EDGE_PX / long_edge
    new_size = (round(image.width * scale), round(image.height * scale))
    return image.resize(new_size, Image.LANCZOS)


# Israeli business receipts are commonly Hebrew, but a default Tesseract install only
# ships the English language pack - eng-only recognition reads Hebrew labels as noise
# and tanks average confidence below CONFIDENCE_THRESHOLD even when every field is
# actually present (this, not PDF rasterization quality, was why real PDFs failed
# while English-sample images passed). heb.traineddata is fetched into a per-user data
# dir (not Tesseract's own tessdata dir, which isn't writable without admin rights) -
# and specifically NOT a path under the repo checkout, because Tesseract's Windows
# binary reads --tessdata-dir with the ANSI codepage rather than as Unicode, so any
# non-ASCII character anywhere in the path (this repo itself is checked out under a
# Hebrew-named folder) makes it fail to find the language files at all. Falls back to
# English-only if the language pack hasn't been fetched.
_TESSDATA_DIR = (
    Path(os.environ.get("LOCALAPPDATA", tempfile.gettempdir())) / "SmartReceipt" / "tessdata"
)
if (_TESSDATA_DIR / "heb.traineddata").is_file() and (_TESSDATA_DIR / "eng.traineddata").is_file():
    _TESSERACT_LANG = "heb+eng"
    # No surrounding quotes: pytesseract passes this through shlex.split() and then
    # execs tesseract via an argv list (no shell involved), so a quoted value would
    # have the literal quote characters attached to the path instead of being stripped.
    _TESSERACT_CONFIG = f"--tessdata-dir {_TESSDATA_DIR}"
else:
    _TESSERACT_LANG = "eng"
    _TESSERACT_CONFIG = ""

# Page segmentation modes to try, in order. 3 is Tesseract's default ("fully automatic
# page segmentation") and reads a clean, full-resolution PDF-rendered page correctly by
# detecting its header/table regions. But it badly mis-orders a low-res/upscaled photo of
# a dense, bidirectional (Hebrew+numbers) invoice table - verified against a real scanned
# receipt where --psm 3 read the vendor name and totals as unrelated garbage while --psm
# 6 ("assume a single uniform block of text") read every required field correctly on the
# same image. Neither mode dominates the other, so both are tried per page - same idea as
# the tesseract-then-easyocr engine fallback below, one level down.
_TESSERACT_PSM_MODES = (3, 6)


def _pdf_to_images(file_bytes: bytes) -> list | None:
    """Rasterizes each page of a PDF into a PIL Image, so PDFs - scanned or
    text-layer alike - are read by the same OCR engines as a photographed receipt."""
    try:
        import io

        import pymupdf
        from PIL import Image
    except ImportError:
        return None

    zoom = _PDF_RENDER_DPI / 72
    matrix = pymupdf.Matrix(zoom, zoom)
    images = []
    with pymupdf.open(stream=file_bytes, filetype="pdf") as doc:
        for page in doc:
            pixmap = page.get_pixmap(matrix=matrix)
            images.append(Image.open(io.BytesIO(pixmap.tobytes("png"))))
    return images


def _load_page_images(file_bytes: bytes, content_type: str | None) -> list | None:
    """Turns any supported upload into a list of per-page PIL Images - one item for a
    plain image file, one per page for a PDF - so every downstream OCR engine works
    off the same representation regardless of source format."""
    if content_type and content_type.startswith("image/"):
        import io

        from PIL import Image, ImageOps

        image = Image.open(io.BytesIO(file_bytes))
        print(
            f"[ocr_service] Pillow opened image: format={image.format} mode={image.mode} "
            f"size={image.size} exif_orientation="
            f"{image.getexif().get(0x0112) if hasattr(image, 'getexif') else None}"
        )
        # Phone-camera JPEGs carry an EXIF Orientation tag instead of storing pixels
        # right-side-up; PIL.Image.open ignores it, so a receipt photographed in
        # portrait can be handed to the OCR engines sideways/upside-down with no
        # error, just silently unreadable text (unlike a PDF page, which is rendered
        # fresh via pymupdf and is never mis-oriented). exif_transpose applies the tag
        # and strips it. convert("RGB") normalizes CMYK/palette JPEGs so both engines
        # (EasyOCR needs a plain RGB numpy array) see the same pixel format as a PDF
        # page render.
        image = ImageOps.exif_transpose(image).convert("RGB")
        upscaled = _upscale_for_ocr(image)
        print(
            f"[ocr_service] image ready for OCR: size={upscaled.size} mode={upscaled.mode} "
            f"(upscaled={upscaled.size != image.size})"
        )
        return [upscaled]

    if content_type == "application/pdf":
        images = _pdf_to_images(file_bytes)
        return [_upscale_for_ocr(image) for image in images] if images else images

    return None


def _try_tesseract(images: list) -> tuple[OCRResult | None, LowConfidenceInfo | None]:
    try:
        import shutil

        import pytesseract
    except ImportError:
        return None, None

    # On Windows, a freshly-installed tesseract.exe often isn't on PATH yet for
    # the currently-running process (PATH refreshes on new sessions, not live
    # ones). Fall back to the default install location rather than failing.
    if shutil.which(pytesseract.pytesseract.tesseract_cmd) is None:
        import os

        if os.path.isfile(_WINDOWS_TESSERACT_FALLBACK):
            pytesseract.pytesseract.tesseract_cmd = _WINDOWS_TESSERACT_FALLBACK

    attempts: list[LowConfidenceInfo] = []
    for psm in _TESSERACT_PSM_MODES:
        config = f"{_TESSERACT_CONFIG} --psm {psm}".strip()
        try:
            page_texts = []
            confidences: list[int] = []
            for page_num, image in enumerate(images, start=1):
                page_text = pytesseract.image_to_string(image, lang=_TESSERACT_LANG, config=config)
                page_texts.append(page_text)
                print(f"[ocr_service] tesseract psm={psm} page={page_num} raw_text={page_text!r}")
                data = pytesseract.image_to_data(
                    image,
                    lang=_TESSERACT_LANG,
                    config=config,
                    output_type=pytesseract.Output.DICT,
                )
                confidences.extend(
                    int(c)
                    for c in data.get("conf", [])
                    if str(c).lstrip("-").isdigit() and int(c) >= 0
                )
            text = "\n".join(page_texts)
            avg_confidence = (sum(confidences) / len(confidences)) if confidences else 0.0

            candidate = _extract_candidate_fields(text)
            missing = _missing_fields(candidate)
            print(
                f"[ocr_service] tesseract psm={psm} avg_confidence={avg_confidence:.1f} "
                f"extracted={candidate} missing_fields={missing}"
            )

            if avg_confidence >= CONFIDENCE_THRESHOLD and not missing:
                return _candidate_to_result(candidate, text, engine="tesseract"), None

            reason = "low_confidence" if avg_confidence < CONFIDENCE_THRESHOLD else "missing_fields"
            if reason == "low_confidence":
                print(
                    f"[ocr_service] tesseract psm={psm} REJECTED: confidence "
                    f"{avg_confidence:.1f} below threshold {CONFIDENCE_THRESHOLD}"
                )
            else:
                print(
                    f"[ocr_service] tesseract psm={psm} REJECTED: missing required "
                    f"field(s) {missing}"
                )
            attempts.append(
                LowConfidenceInfo(
                    reason=reason, engine="tesseract", extracted=candidate, missing_fields=missing
                )
            )
        except Exception as exc:
            print(f"[ocr_service] tesseract psm={psm} raised an exception: {exc!r}")
            attempts.append(LowConfidenceInfo(reason="engine_error", engine="tesseract"))

    return None, max(attempts, key=lambda a: len(REQUIRED_FIELDS) - len(a.missing_fields))


def _try_easyocr(images: list) -> tuple[OCRResult | None, LowConfidenceInfo | None]:
    try:
        import easyocr
        import numpy as np
    except ImportError:
        return None, None

    try:
        reader = easyocr.Reader(["en", "he"], gpu=False)
        page_texts = []
        confidences: list[float] = []
        for image in images:
            results = reader.readtext(np.array(image.convert("RGB")), detail=1)
            page_texts.append("\n".join(r[1] for r in results))
            confidences.extend(r[2] * 100 for r in results)
        text = "\n".join(page_texts)
        avg_confidence = (sum(confidences) / len(confidences)) if confidences else 0.0

        print(f"[ocr_service] easyocr raw_text={text!r}")

        candidate = _extract_candidate_fields(text)
        missing = _missing_fields(candidate)
        print(
            f"[ocr_service] easyocr avg_confidence={avg_confidence:.1f} "
            f"extracted={candidate} missing_fields={missing}"
        )

        if avg_confidence >= CONFIDENCE_THRESHOLD and not missing:
            return _candidate_to_result(candidate, text, engine="easyocr"), None

        reason = "low_confidence" if avg_confidence < CONFIDENCE_THRESHOLD else "missing_fields"
        if reason == "low_confidence":
            print(
                f"[ocr_service] easyocr REJECTED: confidence {avg_confidence:.1f} "
                f"below threshold {CONFIDENCE_THRESHOLD}"
            )
        else:
            print(f"[ocr_service] easyocr REJECTED: missing required field(s) {missing}")
        return None, LowConfidenceInfo(
            reason=reason, engine="easyocr", extracted=candidate, missing_fields=missing
        )
    except Exception as exc:
        print(f"[ocr_service] easyocr raised an exception: {exc!r}")
        return None, LowConfidenceInfo(reason="engine_error", engine="easyocr")


def parse_invoice(filename: str, file_bytes: bytes, content_type: str | None) -> OCRResult:
    """Extracts vendor name, total amount, date, and tax id (ח"פ) from an uploaded
    receipt using real OCR only. Raises OCRLowConfidenceError - never returns
    fabricated data - when no engine can read the file reliably."""
    extension = Path(filename).suffix.lower()
    print(
        f"[ocr_service] incoming file: filename={filename!r} extension={extension!r} "
        f"content_type={content_type!r} size_bytes={len(file_bytes)}"
    )

    attempts: list[LowConfidenceInfo] = []

    try:
        images = _load_page_images(file_bytes, content_type)
    except Exception as exc:
        print(
            f"[ocr_service] failed to open {filename!r} (content_type={content_type!r}): "
            f"{exc!r} - likely a corrupt file, unreadable header, or bad EXIF data"
        )
        images = None
        engine = "pymupdf" if content_type == "application/pdf" else "pillow"
        attempts.append(LowConfidenceInfo(reason="engine_error", engine=engine))
    else:
        print(
            f"[ocr_service] {filename!r} opened successfully: "
            f"{len(images) if images else 0} page image(s)"
        )

    if images:
        for attempt in (_try_tesseract, _try_easyocr):
            result, low_confidence = attempt(images)
            if result is not None:
                return result
            if low_confidence is not None:
                attempts.append(low_confidence)

    if attempts:
        best = max(attempts, key=lambda a: len(REQUIRED_FIELDS) - len(a.missing_fields))
    else:
        best = LowConfidenceInfo(reason="no_ocr_engine_available", engine="none")

    print(
        f"[ocr_service] {filename!r} could not be read reliably - best attempt: "
        f"engine={best.engine} reason={best.reason} missing_fields={best.missing_fields} "
        f"extracted={best.extracted}"
    )
    raise OCRLowConfidenceError(best)
