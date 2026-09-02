def _register(client, email="owner@example.com"):
    return client.post(
        "/api/auth/register",
        json={
            "business_name": "Test Business",
            "business_tax_id": "123456789",
            "email": email,
            "password": "password123",
        },
    )


def test_register_creates_business_and_returns_token(client):
    response = _register(client)
    assert response.status_code == 201
    body = response.json()
    assert body["access_token"]
    assert body["user"]["email"] == "owner@example.com"
    assert body["business"]["name"] == "Test Business"


def test_register_rejects_duplicate_email(client):
    _register(client, email="dupe@example.com")
    response = _register(client, email="dupe@example.com")
    assert response.status_code == 400


def test_login_with_correct_credentials(client):
    _register(client, email="login@example.com")
    response = client.post(
        "/api/auth/login",
        json={"email": "login@example.com", "password": "password123"},
    )
    assert response.status_code == 200
    assert response.json()["access_token"]


def test_login_rejects_wrong_password(client):
    _register(client, email="wrongpass@example.com")
    response = client.post(
        "/api/auth/login",
        json={"email": "wrongpass@example.com", "password": "not-the-password"},
    )
    assert response.status_code == 401


def test_tenant_data_requires_authentication(client):
    response = client.get("/api/invoices")
    assert response.status_code in (401, 403)
