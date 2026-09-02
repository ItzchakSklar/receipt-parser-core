"""Seeds two demo businesses (tenants) with sample categories, users, and invoices so
the app has data to show immediately after `python seed.py`.

Run from the backend/ directory: `python seed.py`
"""

import base64
from datetime import date, timedelta

from app.config import settings
from app.database import Base, SessionLocal, engine, ensure_schema
from app.models import Business, Category, Invoice, User
from app.security import hash_password

Base.metadata.create_all(bind=engine)
ensure_schema()

# A tiny valid 1x1 PNG so seeded invoices have a real file on disk for the
# receipt-preview feature (GET /api/invoices/{id}/file) to serve.
_PLACEHOLDER_RECEIPT_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
)

DEMO_BUSINESSES = [
    {
        "name": "Acme Consulting Ltd.",
        "tax_id": "514123456",
        "owner_email": "owner@acme.demo",
        "categories": [
            "Office Supplies",
            "Travel",
            "Utilities",
            "Meals & Entertainment",
            "Software & Subscriptions",
        ],
    },
    {
        "name": "Green Leaf Cafe",
        "tax_id": "514987654",
        "owner_email": "owner@greenleaf.demo",
        "categories": ["Ingredients", "Equipment", "Utilities", "Marketing"],
    },
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
            existing = db.query(Business).filter(Business.tax_id == biz_data["tax_id"]).first()
            if existing:
                print(f"Skipping '{biz_data['name']}' - already seeded.")
                continue

            business = Business(name=biz_data["name"], tax_id=biz_data["tax_id"])
            db.add(business)
            db.flush()

            categories = []
            for name in biz_data["categories"]:
                category = Category(business_id=business.id, name=name)
                db.add(category)
                categories.append(category)
            db.flush()

            db.add(
                User(
                    business_id=business.id,
                    email=biz_data["owner_email"],
                    hashed_password=hash_password(DEMO_PASSWORD),
                    role="owner",
                )
            )

            tenant_dir = settings.upload_path / str(business.id)
            tenant_dir.mkdir(parents=True, exist_ok=True)

            for i in range(12):
                category = categories[i % len(categories)]
                file_path = tenant_dir / f"demo-{i}.jpg"
                file_path.write_bytes(_PLACEHOLDER_RECEIPT_PNG)
                db.add(
                    Invoice(
                        business_id=business.id,
                        vendor_name=VENDORS[i % len(VENDORS)],
                        amount=round(50 + (i * 37.5) % 900, 2),
                        date=date.today() - timedelta(days=i * 3),
                        tax_id=f"5{100000000 + i}",
                        category_id=category.id,
                        file_path=file_path.as_posix(),
                        ocr_source="manual",
                    )
                )

            print(f"Seeded '{business.name}' — login: {biz_data['owner_email']} / {DEMO_PASSWORD}")

        db.commit()
    finally:
        db.close()


if __name__ == "__main__":
    seed()
