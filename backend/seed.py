"""Seeds two demo businesses (tenants) with sample invoices so the app has data to
show immediately after `python seed.py`.

Run from the backend/ directory: `python seed.py`
"""

import base64
from datetime import date, timedelta

from app.categories import CATEGORIES
from app.database import Base, SessionLocal, engine
from app.models import Invoice, User
from app.security import hash_password

Base.metadata.create_all(bind=engine)

# A tiny valid 1x1 PNG so seeded invoices have a real file for the receipt-preview
# feature (GET /api/invoices/{id}/file) to serve.
_PLACEHOLDER_RECEIPT_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
)

DEMO_BUSINESSES = [
    {"name": "Acme Consulting Ltd.", "tax_id": "514123456", "owner_email": "owner@acme.demo"},
    {"name": "Green Leaf Cafe", "tax_id": "514987654", "owner_email": "owner@greenleaf.demo"},
]

DEMO_PASSWORD = "password123"
VENDORS = [
    "Office Depot",
    "Super-Pharm",
    "Delek Gas Station",
    "IKEA",
    "AWS Cloud Services",
    "Amazon Business",
]


def seed():
    db = SessionLocal()
    try:
        for biz_data in DEMO_BUSINESSES:
            existing = db.query(User).filter(User.email == biz_data["owner_email"]).first()
            if existing:
                print(f"Skipping '{biz_data['name']}' - already seeded.")
                continue

            user = User(
                email=biz_data["owner_email"],
                hashed_password=hash_password(DEMO_PASSWORD),
                role="owner",
                business_name=biz_data["name"],
                business_tax_id=biz_data["tax_id"],
            )
            db.add(user)
            db.flush()

            for i in range(12):
                db.add(
                    Invoice(
                        business_id=user.id,
                        vendor_name=VENDORS[i % len(VENDORS)],
                        amount=round(50 + (i * 37.5) % 900, 2),
                        date=date.today() - timedelta(days=i * 3),
                        tax_id=f"5{100000000 + i}",
                        category=CATEGORIES[i % len(CATEGORIES)],
                        file_name=f"demo-{i}.png",
                        file_content_type="image/png",
                        file_content=_PLACEHOLDER_RECEIPT_PNG,
                        ocr_source="manual",
                    )
                )

            print(
                f"Seeded '{biz_data['name']}' — login: {biz_data['owner_email']} / {DEMO_PASSWORD}"
            )

        db.commit()
    finally:
        db.close()


if __name__ == "__main__":
    seed()
