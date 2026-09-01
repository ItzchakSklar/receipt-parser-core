from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.config import settings

connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}

engine = create_engine(settings.database_url, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def ensure_schema() -> None:
    """Base.metadata.create_all only adds tables that don't exist yet, so a column
    added to an existing model (e.g. Invoice.invoice_number) never reaches an
    already-created sqlite dev database. This adds any such missing columns on
    startup instead of requiring a full migration tool for a single-file db."""
    if not settings.database_url.startswith("sqlite"):
        return

    with engine.connect() as conn:
        existing_columns = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(invoices)")}
        if "invoice_number" not in existing_columns:
            conn.exec_driver_sql("ALTER TABLE invoices ADD COLUMN invoice_number VARCHAR(100)")
            conn.commit()
