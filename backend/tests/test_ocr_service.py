from app.services.ocr_service import parse_total_amount


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
