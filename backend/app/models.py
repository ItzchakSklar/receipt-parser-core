from datetime import UTC, datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, LargeBinary, String
from sqlalchemy.orm import Mapped, deferred, mapped_column, relationship

from app.database import Base


def utcnow() -> datetime:
    return datetime.now(UTC)


class User(Base):
    """A registered account, and the tenant itself - each user owns exactly one
    business, so its details live on this row and every invoice is scoped to it."""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(20), default="owner")
    business_name: Mapped[str] = mapped_column(String(255), nullable=False)
    business_tax_id: Mapped[str] = mapped_column(String(50), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    invoices: Mapped[list["Invoice"]] = relationship(
        back_populates="business", cascade="all, delete-orphan"
    )

    @property
    def business_id(self) -> int:
        return self.id


class Invoice(Base):
    __tablename__ = "invoices"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    # The owning business - a users.id, since a user and their business are one row.
    business_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    vendor_name: Mapped[str] = mapped_column(String(255), nullable=False)
    amount: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    tax_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
    # Invoice/receipt reference number as printed on the document. Best-effort OCR
    # extraction - many receipts never print one, so this stays optional and is
    # used only to key duplicate-upload detection when it is present.
    invoice_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    # One of app.categories.CATEGORIES, or None for "Uncategorized".
    category: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # The receipt file itself is stored in the database, not on disk. Deferred so
    # listing invoices never pulls every file over the network from Turso.
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    file_content_type: Mapped[str] = mapped_column(String(100), nullable=False)
    file_content: Mapped[bytes] = deferred(mapped_column(LargeBinary, nullable=False))

    # "ocr" = auto-extracted with acceptable confidence; "manual" = user-confirmed
    # after OCR could not extract data reliably. Never contains fabricated/mock data.
    ocr_source: Mapped[str] = mapped_column(String(10), default="manual")

    # True when OCR could not read this receipt reliably at upload time. The file is
    # still saved (never rejected) and the row gets placeholder vendor/amount/date so
    # every column stays non-null; the "לא מזוהים" folder queries on this flag rather
    # than trusting those placeholders as real data. Cleared once a user manually
    # confirms the real fields via POST /unrecognized/{id}/sort.
    is_unrecognized: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # Timestamp stamped from the WorldTimeAPI external time source at upload time.
    uploaded_at_external_time: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    business: Mapped["User"] = relationship(back_populates="invoices")
