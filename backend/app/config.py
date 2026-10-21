from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Central application configuration, loaded from environment / .env."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Hosted Turso (libSQL) database - the only storage for users, invoices and the
    # receipt files themselves, shared by local dev and every deployment. Required:
    # sqlite+libsql://<db>-<org>.turso.io/?authToken=<token>
    database_url: str

    secret_key: str = "change-this-super-secret-key-in-production"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 480

    world_time_api_url: str = "http://worldtimeapi.org/api/ip"

    # Render injects PORT at runtime with the port the service must bind to;
    # the 8000 default only applies to local dev (see app/main.py's __main__ block).
    port: int = 8000

    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    # Single deployed frontend origin (e.g. the Vercel URL), added to cors_origins
    # below - kept separate so it can be set as one env var without having to
    # re-list the local-dev origins alongside it.
    frontend_url: str = ""

    @property
    def cors_origin_list(self) -> list[str]:
        origins = [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]
        if self.frontend_url and self.frontend_url not in origins:
            origins.append(self.frontend_url)
        return origins


settings = Settings()
