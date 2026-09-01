from dataclasses import dataclass

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import User
from app.security import decode_access_token

bearer_scheme = HTTPBearer(auto_error=False)


@dataclass
class CurrentUser:
    id: int
    business_id: int
    role: str


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> CurrentUser:
    """Resolves the authenticated user (and therefore tenant/business_id) from the JWT."""
    if credentials is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")

    payload = decode_access_token(credentials.credentials)
    if payload is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")

    user_id = int(payload.get("sub"))
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User not found")

    return CurrentUser(id=user.id, business_id=user.business_id, role=user.role)


def get_current_business_id(current_user: CurrentUser = Depends(get_current_user)) -> int:
    """Every tenant-scoped query should filter by this value."""
    return current_user.business_id
