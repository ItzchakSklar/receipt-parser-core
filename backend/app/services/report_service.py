"""Builds the monthly accountant export: a CSV expense summary plus a zip of the
original receipt files, for one business/month/year."""

import csv
import io
import zipfile

from app.models import Invoice, User


def build_monthly_csv(business: User, month: int, year: int, invoices: list[Invoice]) -> bytes:
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["SmartReceipt Monthly Expense Report"])
    writer.writerow([f"Business: {business.business_name}", f"Tax ID: {business.business_tax_id}"])
    writer.writerow([f"Period: {year}-{month:02d}"])
    writer.writerow([])
    writer.writerow(["Date", "Vendor", "Category", "Tax ID", "Amount", "Source"])

    total = 0.0
    for invoice in invoices:
        category_name = invoice.category or "Uncategorized"
        writer.writerow(
            [
                invoice.date.strftime("%Y-%m-%d"),
                invoice.vendor_name,
                category_name,
                invoice.tax_id or "",
                f"{invoice.amount:.2f}",
                invoice.ocr_source,
            ]
        )
        total += invoice.amount

    writer.writerow([])
    writer.writerow(["", "", "", "Total", f"{total:.2f}"])

    # utf-8-sig so Excel renders the ₪/ח"פ characters correctly.
    return buffer.getvalue().encode("utf-8-sig")


def build_receipts_zip(invoices: list[Invoice]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zip_file:
        for invoice in invoices:
            arcname = f"{invoice.date.strftime('%Y-%m-%d')}_{invoice.id}_{invoice.file_name}"
            zip_file.writestr(arcname, invoice.file_content)
    return buffer.getvalue()
