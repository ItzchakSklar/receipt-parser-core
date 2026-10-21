import re

from sqlalchemy.dialects.sqlite.pysqlite import SQLiteDialect_pysqlite
from sqlalchemy.pool import QueuePool


class LibSQLDialect(SQLiteDialect_pysqlite):
    """Talks to a hosted Turso (libSQL) database through the official `libsql`
    driver. The `sqlalchemy-libsql` package does the same thing but is pinned to
    the abandoned `libsql-experimental` driver, which has no prebuilt Windows wheel
    and needs a Rust toolchain to install - `libsql` ships wheels for every platform.

    URL form: sqlite+libsql://<db>-<org>.turso.io/?authToken=<token>"""

    driver = "libsql"
    supports_statement_cache = True

    @classmethod
    def import_dbapi(cls):
        import libsql

        # DB-API's Binary constructor, which SQLAlchemy's LargeBinary binds through
        # (receipt files are stored as BLOBs) - libsql takes plain bytes but doesn't
        # export it.
        if not hasattr(libsql, "Binary"):
            libsql.Binary = bytes
        return libsql

    @classmethod
    def get_pool_class(cls, url):
        # The base class picks SingletonThreadPool for any URL without a file path,
        # which would funnel every request thread through one remote connection.
        return QueuePool

    def on_connect(self):
        # pysqlite's hook registers Python functions via create_function(), which
        # libsql connections don't support - nothing in this app needs them.
        return None

    def create_connect_args(self, url):
        # libsql only reports a bad host as an opaque "InvalidUriChar" at first
        # connect - typically a leftover <db>/<org> placeholder or an invisible
        # character picked up when pasting the URL into a hosting dashboard.
        host = (url.host or "").strip()
        if not _HOST_RE.fullmatch(host):
            raise ValueError(
                f"DATABASE_URL host {host!r} is not a valid Turso hostname - expected "
                "something like 'mydb-myorg.turso.io'. Check for leftover <...> "
                "placeholders, spaces or invisible characters in the value."
            )
        auth_token = (url.query.get("authToken") or "").strip()
        if not auth_token:
            raise ValueError("DATABASE_URL is missing its ?authToken=... part.")
        return [f"libsql://{host}"], {"auth_token": auth_token}


_HOST_RE = re.compile(r"[A-Za-z0-9.-]+")
