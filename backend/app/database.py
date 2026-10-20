from sqlalchemy import create_engine
from sqlalchemy.dialects import registry
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.config import settings

registry.register("sqlite.libsql", "app.libsql_dialect", "LibSQLDialect")


def _connect_args(url: str) -> dict:
    # Plain sqlite:// is only ever used by the test suite (see tests/conftest.py).
    return {"check_same_thread": False} if url.startswith("sqlite://") else {}


engine = create_engine(
    settings.database_url, connect_args=_connect_args(settings.database_url), pool_pre_ping=True
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
