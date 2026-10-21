from datetime import date

from app.services.ocr_service import (
    _extract_candidate_fields,
    _missing_fields,
    parse_total_amount,
)


def test_parse_total_amount_prefers_total_due_over_subtotal():
    text = "Subtotal: ILS 100.00\nTax: ILS 17.00\nTotal Due: ILS 117.00"
    assert parse_total_amount(text) == 117.00


def test_parse_total_amount_strips_thousands_separator():
    text = "Total: $1,234.56"
    assert parse_total_amount(text) == 1234.56


def test_parse_total_amount_hebrew_anchor():
    text = 'סה"כ לתשלום: 250.00'
    assert parse_total_amount(text) == 250.00


def test_parse_total_amount_falls_back_to_largest_bottom_number():
    text = "some garbled header\nno recognizable anchor here\n42.50 99.90"
    assert parse_total_amount(text) == 99.90


def test_parse_total_amount_returns_none_when_nothing_found():
    assert parse_total_amount("no numbers at all") is None


def test_parse_total_amount_fallback_ignores_percentages():
    text = 'header\nמע"מ 16.00%\nסה"כ לתשלום'
    assert parse_total_amount(text) is None


# Tesseract --psm 6 output for a real Hebrew invoice (Creative Software, 18/07/2011)
# that has no tax id printed and its number as "מספר 66614".
_CREATIVE_SOFTWARE_TEXT = (
    'קריאטיב סופטוור בע"מ 2-\n'
    "ת.ד. 221 זכרון e 30900 apy\n"
    "טלפון: 1-599-505019, פקס: 04-6293087\n"
    "לכבוד עוסק מורשה\n"
    "בדיקות ורסיה תאריך 18/07/2011\n"
    "מספר לקו | 666\n"
    "חשבונית ON תודתושיה | מספר 66614 קליטה ידנית\n"
    'סה"כ מחיר 60.00\n'
    'מע"מ 16.00% )9.66\n'
    'תאריך תשלום : 18/07/2011 סה"כ לתשלום 70.00\n'
)


def test_extracts_receipt_without_tax_id():
    candidate = _extract_candidate_fields(_CREATIVE_SOFTWARE_TEXT)
    assert candidate["vendor_name"] == 'קריאטיב סופטוור בע"מ'
    assert candidate["amount"] == 70.0
    assert candidate["date"] == date(2011, 7, 18)
    assert candidate["invoice_number"] == "66614"
    assert "tax_id" not in candidate
    assert _missing_fields(candidate) == []


def test_vendor_prefers_company_suffix_line_over_address():
    text = 'ת.ד. 221 זכרון יעקב 30900\nקריאטיב סופטוור בע"מ 0\nסה"כ לתשלום 70.00'
    assert _extract_candidate_fields(text)["vendor_name"] == 'קריאטיב סופטוור בע"מ'
