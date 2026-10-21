"""Pytest bootstrap: points the app at an isolated, throwaway SQLite database and
email directory before `app.config.settings` is ever imported, so tests never
touch the real Turso database or `.env`."""

import os
import tempfile
from pathlib import Path

_TEST_HOME = Path(tempfile.mkdtemp(prefix="smartreceipt-pytest-"))
os.environ["DATABASE_URL"] = f"sqlite:///{_TEST_HOME / 'test.db'}"
os.environ["SENT_EMAIL_DIR"] = str(_TEST_HOME / "sent_emails")
os.environ["SECRET_KEY"] = "pytest-secret-key"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


@pytest.fixture()
def client() -> TestClient:
    return TestClient(app)
