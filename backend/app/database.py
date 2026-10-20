from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.config import settings

_LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}
_SQLITE_FALLBACK_URL = "sqlite:///./smartreceipt.db"


def _connect_args(url: str) -> dict:
    return {"check_same_thread": False} if url.startswith("sqlite") else {}


def _build_engine():
    """Builds the configured engine, falling back to a local SQLite file when
    DATABASE_URL points SQL Server at localhost and nothing is actually listening
    there - the "forgot to start Docker/SQL Server" case a bare `uvicorn --reload`
    hits on a fresh machine (see README "Running the Backend"). A non-local mssql
    host (docker-compose's `sqlserver` service name, or a real deployed DB) is never
    swapped this way - an outage there should fail loudly, not silently disappear
    into an empty throwaway SQLite file."""
    url = settings.database_url
    parsed = make_url(url)
    if parsed.get_backend_name() != "mssql" or parsed.host not in _LOCAL_HOSTS:
        return create_engine(url, connect_args=_connect_args(url))

    candidate = create_engine(url, connect_args=_connect_args(url))
    try:
        with candidate.connect():
            pass
    except Exception as exc:
        candidate.dispose()
        print(
            f"[database] Could not reach SQL Server at {parsed.host}:{parsed.port} "
            f"({exc.__class__.__name__}) - falling back to local SQLite "
            f"({_SQLITE_FALLBACK_URL}) for this run. Start SQL Server (see README "
            "'Switching to SQL Server') and restart the backend to use it instead."
        )
        return create_engine(_SQLITE_FALLBACK_URL, connect_args=_connect_args(_SQLITE_FALLBACK_URL))
    return candidate


engine = _build_engine()
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def ensure_database_exists() -> None:
    """Unlike sqlite (which creates its file on first connection), SQL Server
    rejects a connection to a database that doesn't exist yet - connect to
    `master` and create the target database first if needed, before `engine`
    (bound to it) is ever used."""
    if engine.dialect.name != "mssql":
        return

    db_name = engine.url.database
    master_engine = create_engine(engine.url.set(database="master"), isolation_level="AUTOCOMMIT")
    try:
        with master_engine.connect() as conn:
            exists = conn.exec_driver_sql(
                "SELECT 1 FROM sys.databases WHERE name = ?", (db_name,)
            ).first()
            if not exists:
                conn.exec_driver_sql(f"CREATE DATABASE [{db_name}]")
    finally:
        master_engine.dispose()


def ensure_schema() -> None:
    """Base.metadata.create_all only adds tables that don't exist yet, so a column
    added to an existing model (e.g. Invoice.invoice_number) never reaches an
    already-created dev database. This adds any such missing columns on startup
    instead of requiring a full migration tool for a single-file/small db. Supports
    sqlite (dev default), mssql (SQL Server), and postgresql (e.g. a hosted Neon
    database) - the dialects `database_url` is actually pointed at; the ADD COLUMN
    syntax and existing-column lookup differ between them."""
    dialect = engine.dialect.name
    if dialect not in ("sqlite", "mssql", "postgresql"):
        return

    with engine.connect() as conn:
        if dialect == "sqlite":
            existing_columns = {
                row[1] for row in conn.exec_driver_sql("PRAGMA table_info(invoices)")
            }
            add_column = "ALTER TABLE invoices ADD COLUMN {}"
            bool_default_false = "BOOLEAN DEFAULT 0 NOT NULL"
        elif dialect == "postgresql":
            existing_columns = {
                row[0]
                for row in conn.exec_driver_sql(
                    "SELECT column_name FROM information_schema.columns "
                    "WHERE table_name = 'invoices'"
                )
            }
            add_column = "ALTER TABLE invoices ADD COLUMN {}"
            bool_default_false = "BOOLEAN NOT NULL DEFAULT FALSE"
        else:
            existing_columns = {
                row[0]
                for row in conn.exec_driver_sql(
                    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS "
                    "WHERE TABLE_NAME = 'invoices'"
                )
            }
            add_column = "ALTER TABLE invoices ADD {}"
            bool_default_false = "BIT NOT NULL DEFAULT 0"

        if "invoice_number" not in existing_columns:
            conn.exec_driver_sql(add_column.format("invoice_number VARCHAR(100)"))
            conn.commit()
        if "is_unrecognized" not in existing_columns:
            conn.exec_driver_sql(add_column.format(f"is_unrecognized {bool_default_false}"))
            conn.commit()
