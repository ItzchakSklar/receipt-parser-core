"""Client for WorldTimeAPI, used to stamp uploads with a trusted external timestamp
and to power the live clock widget on the frontend.

Falls back to local UTC time (clearly flagged via `source: "local_fallback"`) if the
external API is unreachable, so the app keeps working offline / in restricted networks.
"""

from datetime import UTC, datetime

import httpx

from app.config import settings
from app.schemas import ExternalTime

_TIMEOUT_SECONDS = 5.0


async def fetch_external_time() -> ExternalTime:
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT_SECONDS) as client:
            response = await client.get(settings.world_time_api_url)
            response.raise_for_status()
            data = response.json()
            return ExternalTime(
                datetime=data["datetime"],
                timezone=data.get("timezone", "UTC"),
                utc_offset=data.get("utc_offset"),
                source="worldtimeapi",
            )
    except (httpx.HTTPError, KeyError, ValueError):
        now = datetime.now(UTC)
        return ExternalTime(
            datetime=now.isoformat(),
            timezone="UTC",
            utc_offset="+00:00",
            source="local_fallback",
        )


def parse_external_datetime(external_time: ExternalTime) -> datetime:
    """Converts the ExternalTime payload into a timezone-aware datetime for DB storage."""
    try:
        return datetime.fromisoformat(external_time.datetime)
    except ValueError:
        return datetime.now(UTC)
