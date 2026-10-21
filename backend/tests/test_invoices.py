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
