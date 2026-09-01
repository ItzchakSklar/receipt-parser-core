"""Sends the monthly accountant report by SMTP. When SMTP is not configured (the
default for local dev), the composed email is written to disk instead so the flow is
fully testable without a real mail server - mirroring the WorldTimeAPI/OCR fallback
pattern used elsewhere in this app."""

import smtplib
from datetime import UTC, datetime
from email.message import EmailMessage

from app.config import settings


def send_monthly_report(
    *,
    to_email: str,
    business_name: str,
    month: int,
    year: int,
    invoice_count: int,
    total: float,
    csv_bytes: bytes,
    zip_bytes: bytes,
) -> str:
    """Returns the delivery mode actually used: "smtp" or "mock"."""
    message = EmailMessage()
    message["Subject"] = f"{business_name} - Expense Report {year}-{month:02d}"
    message["From"] = settings.smtp_from_email
    message["To"] = to_email
    message.set_content(
        f"Monthly expense report for {business_name} ({year}-{month:02d}).\n\n"
        f"Invoices: {invoice_count}\n"
        f"Total: {total:.2f}\n\n"
        "See the attached CSV summary and a zip of the original receipt files."
    )
    message.add_attachment(
        csv_bytes, maintype="text", subtype="csv", filename=f"expenses-{year}-{month:02d}.csv"
    )
    message.add_attachment(
        zip_bytes,
        maintype="application",
        subtype="zip",
        filename=f"receipts-{year}-{month:02d}.zip",
    )

    if not settings.smtp_configured:
        timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%S")
        safe_email = to_email.replace("@", "_at_").replace("/", "_")
        out_path = settings.sent_email_path / f"{timestamp}-{safe_email}.eml"
        out_path.write_bytes(bytes(message))
        return "mock"

    with smtplib.SMTP(settings.smtp_host, settings.smtp_port) as smtp:
        if settings.smtp_use_tls:
            smtp.starttls()
        if settings.smtp_username:
            smtp.login(settings.smtp_username, settings.smtp_password)
        smtp.send_message(message)
    return "smtp"
