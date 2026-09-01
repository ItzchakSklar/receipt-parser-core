from datetime import datetime, timezone

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Business(Base):
    """A tenant. Every other entity is scoped to a business via business_id."""

    __tablename__ = "businesses"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    tax_id: Mapped[str] = mapped_column(String(50), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    users: Mapped[list["User"]] = relationship(back_populates="business", cascade="all, delete-orphan")
    categories: Mapped[list["Category"]] = relationship(back_populates="business", cascade="all, delete-orphan")
    invoices: Mapped[list["Invoice"]] = relationship(back_populates="business", cascade="all, delete-orphan")


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id"), nullable=False, index=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(20), default="member")  # owner | admin | member
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    business: Mapped["Business"] = relationship(back_populates="users")


class Category(Base):
    __tablename__ = "categories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)

    business: Mapped["Business"] = relationship(back_populates="categories")
    invoices: Mapped[list["Invoice"]] = relationship(back_populates="category")


class Invoice(Base):
    __tablename__ = "invoices"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id"), nullable=False, index=True)
    vendor_name: Mapped[str] = mapped_column(String(255), nullable=False)
    amount: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    tax_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
    # Invoice/receipt reference number as printed on the document. Best-effort OCR
    # extraction - many receipts never print one, so this stays optional and is
    # used only to key duplicate-upload detection when it is present.
    invoice_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    category_id: Mapped[int | None] = mapped_column(ForeignKey("categories.id"), nullable=True)
    file_path: Mapped[str] = mapped_column(String(500), nullable=False)

    # "ocr" = auto-extracted with acceptable confidence; "manual" = user-confirmed
    # after OCR could not extract data reliably. Never contains fabricated/mock data.
    ocr_source: Mapped[str] = mapped_column(String(10), default="manual")

    # Timestamp stamped from the WorldTimeAPI external time source at upload time.
    uploaded_at_external_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    business: Mapped["Business"] = relationship(back_populates="invoices")
    category: Mapped["Category | None"] = relationship(back_populates="invoices")
