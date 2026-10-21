import base64

# 1x1 PNG - unreadable by OCR, so the upload lands in "לא מזוהים" with the file
# stored in the database.
_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
)


def _auth_headers(client, email):
    response = client.post(
        "/api/auth/register",
        json={
            "business_name": f"Business {email}",
            "business_tax_id": "123456789",
            "email": email,
            "password": "password123",
        },
    )
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def _upload(client, headers):
    response = client.post(
        "/api/invoices/upload",
        files={"file": ("receipt.png", _PNG, "image/png")},
        headers=headers,
    )
    assert response.status_code == 201
    return response.json()


def test_uploaded_file_is_stored_and_served_from_database(client):
    headers = _auth_headers(client, "files@example.com")
    invoice = _upload(client, headers)
    assert invoice["is_unrecognized"] is True
    assert invoice["file_name"] == "receipt.png"

    response = client.get(f"/api/invoices/{invoice['id']}/file", headers=headers)
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    assert response.content == _PNG


def test_corrupt_upload_reports_reason(client):
    headers = _auth_headers(client, "corrupt@example.com")
    response = client.post(
        "/api/invoices/upload",
        files={"file": ("broken.jpg", b"not really a jpeg", "image/jpeg")},
        headers=headers,
    )
    assert response.status_code == 201
    body = response.json()
    assert body["is_unrecognized"] is True
    assert body["ocr_reason"] == "corrupt_file"
    assert set(body["ocr_missing_fields"]) == {"vendor_name", "amount", "date"}


def test_file_is_not_served_to_another_business(client):
    owner = _auth_headers(client, "owner-a@example.com")
    other = _auth_headers(client, "owner-b@example.com")
    invoice = _upload(client, owner)

    response = client.get(f"/api/invoices/{invoice['id']}/file", headers=other)
    assert response.status_code == 404


def test_sort_unrecognized_applies_category(client):
    headers = _auth_headers(client, "sort@example.com")
    invoice = _upload(client, headers)

    response = client.post(
        f"/api/invoices/unrecognized/{invoice['id']}/sort",
        json={
            "vendor_name": "IKEA",
            "amount": 120.5,
            "date": "2026-10-01T00:00:00",
            "category_id": 2,
        },
        headers=headers,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["is_unrecognized"] is False
    assert body["category_id"] == 2
    assert body["category_name"] == "נסיעות"

    listed = client.get("/api/invoices", headers=headers).json()
    assert [inv["id"] for inv in listed] == [invoice["id"]]


def _upload_bytes(client, headers, content, name="receipt.jpg"):
    return client.post(
        "/api/invoices/upload", files={"file": (name, content, "image/jpeg")}, headers=headers
    )


def _sort(client, headers, invoice_id, **fields):
    payload = {"vendor_name": "סופר כהן", "amount": 118.0, "date": "2026-09-15T00:00:00"}
    payload.update(fields)
    return client.post(
        f"/api/invoices/unrecognized/{invoice_id}/sort", json=payload, headers=headers
    )


def test_identical_file_is_reported_before_ocr(client):
    headers = _auth_headers(client, "same-file@example.com")
    invoice = _upload(client, headers)

    response = client.post(
        "/api/invoices/upload",
        files={"file": ("again.png", _PNG, "image/png")},
        headers=headers,
    )
    assert response.status_code == 409
    detail = response.json()["detail"]
    assert detail["error"] == "DUPLICATE_EXISTS"
    assert detail["existing_invoice"]["id"] == invoice["id"]


def test_completed_receipt_identical_to_existing_is_reported(client):
    headers = _auth_headers(client, "dup-exists@example.com")
    first = _upload_bytes(client, headers, b"broken-1").json()
    assert _sort(client, headers, first["id"], invoice_number="4471").status_code == 200

    second = _upload_bytes(client, headers, b"broken-2").json()
    # Same receipt number, vendor read slightly differently, same amount/date.
    response = _sort(
        client, headers, second["id"], vendor_name='סופר כהן בע"מ', invoice_number="4471"
    )
    assert response.status_code == 409
    assert response.json()["detail"]["error"] == "DUPLICATE_EXISTS"


def test_completed_receipt_conflict_lets_user_choose(client):
    headers = _auth_headers(client, "dup-conflict@example.com")
    first = _upload_bytes(client, headers, b"broken-a").json()
    assert _sort(client, headers, first["id"], invoice_number="4471").status_code == 200

    second = _upload_bytes(client, headers, b"broken-b").json()
    response = _sort(client, headers, second["id"], amount=200.0, invoice_number="4471")
    assert response.status_code == 409
    detail = response.json()["detail"]
    assert detail["error"] == "DUPLICATE_CONFLICT"
    assert detail["existing_invoice"]["id"] == first["id"]
    assert detail["new_data"]["new_invoice_id"] == second["id"]

    resolved = client.post(
        "/api/invoices/resolve-conflict",
        json={
            "action": "update_with_new",
            "existing_invoice_id": first["id"],
            "new_invoice_id": second["id"],
            "vendor_name": "סופר כהן",
            "amount": 200.0,
            "date": "2026-09-15T00:00:00",
            "invoice_number": "4471",
        },
        headers=headers,
    )
    assert resolved.status_code == 200
    assert resolved.json()["amount"] == 200.0
    file = client.get(f"/api/invoices/{first['id']}/file", headers=headers)
    assert file.content == b"broken-b"
    assert client.get("/api/invoices/unrecognized", headers=headers).json() == []


def test_different_vendor_with_same_number_is_not_a_duplicate(client):
    headers = _auth_headers(client, "dup-none@example.com")
    first = _upload_bytes(client, headers, b"broken-x").json()
    assert _sort(client, headers, first["id"], invoice_number="4471").status_code == 200

    second = _upload_bytes(client, headers, b"broken-y").json()
    response = _sort(client, headers, second["id"], vendor_name="IKEA", invoice_number="4471")
    assert response.status_code == 200


def test_same_vendor_and_date_without_invoice_number_asks_user(client):
    # The original was completed by hand without an invoice number; the new copy has
    # one and a different amount - still the same receipt as far as the user can tell.
    headers = _auth_headers(client, "no-number@example.com")
    first = _upload_bytes(client, headers, b"orig").json()
    assert _sort(client, headers, first["id"]).status_code == 200

    second = _upload_bytes(client, headers, b"edited").json()
    response = _sort(client, headers, second["id"], amount=90.0, invoice_number="66614")
    assert response.status_code == 409
    detail = response.json()["detail"]
    assert detail["error"] == "DUPLICATE_CONFLICT"
    assert detail["existing_invoice"]["id"] == first["id"]

    kept = client.post(
        "/api/invoices/resolve-conflict",
        json={
            "action": "keep_both",
            "existing_invoice_id": first["id"],
            "new_invoice_id": second["id"],
            "vendor_name": "סופר כהן",
            "amount": 90.0,
            "date": "2026-09-15T00:00:00",
            "invoice_number": "66614",
        },
        headers=headers,
    )
    assert kept.status_code == 200
    listed = client.get("/api/invoices", headers=headers).json()
    assert sorted(inv["amount"] for inv in listed) == [90.0, 118.0]
    assert client.get("/api/invoices/unrecognized", headers=headers).json() == []


def test_different_invoice_numbers_same_day_are_separate_receipts(client):
    headers = _auth_headers(client, "two-numbers@example.com")
    first = _upload_bytes(client, headers, b"n1").json()
    assert _sort(client, headers, first["id"], invoice_number="100").status_code == 200

    second = _upload_bytes(client, headers, b"n2").json()
    response = _sort(client, headers, second["id"], amount=50.0, invoice_number="101")
    assert response.status_code == 200
