from fastapi import APIRouter

from app.schemas import ExternalTime
from app.services.external_time_service import fetch_external_time

router = APIRouter(prefix="/api/system", tags=["system"])


@router.get("/time", response_model=ExternalTime)
async def get_system_time():
    """Proxies WorldTimeAPI so the frontend clock widget doesn't call it directly
    (avoids CORS issues and keeps a single source of truth for server timestamps)."""
    return await fetch_external_time()
