from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Central application configuration, loaded from environment / .env."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "sqlite:///./smartreceipt.db"

    secret_key: str = "change-this-super-secret-key-in-production"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 480

    world_time_api_url: str = "http://worldtimeapi.org/api/ip"

    upload_dir: str = "./uploads"

    # Render injects PORT at runtime with the port the service must bind to;
    # the 8000 default only applies to local dev (see app/main.py's __main__ block).
    port: int = 8000

    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    # Single deployed frontend origin (e.g. the Vercel URL), added to cors_origins
    # below - kept separate so it can be set as one env var without having to
    # re-list the local-dev origins alongside it.
    frontend_url: str = ""

    # SMTP is optional. When smtp_host is empty, monthly reports are written to
    # sent_email_dir instead of actually being emailed (dev-friendly mock mode).
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_from_email: str = "reports@smartreceipt.local"
    smtp_use_tls: bool = True
    sent_email_dir: str = "./sent_emails"

    @property
    def cors_origin_list(self) -> list[str]:
        origins = [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]
        if self.frontend_url and self.frontend_url not in origins:
            origins.append(self.frontend_url)
        return origins

    @property
    def upload_path(self) -> Path:
        path = Path(self.upload_dir)
        path.mkdir(parents=True, exist_ok=True)
        return path

    @property
    def sent_email_path(self) -> Path:
        path = Path(self.sent_email_dir)
        path.mkdir(parents=True, exist_ok=True)
        return path

    @property
    def smtp_configured(self) -> bool:
        return bool(self.smtp_host)


settings = Settings()
