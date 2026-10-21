from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import User
from app.schemas import BusinessOut, LoginRequest, RegisterRequest, TokenResponse
from app.security import create_access_token, hash_password, verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _token_response(user: User) -> TokenResponse:
    token = create_access_token(user_id=user.id, business_id=user.business_id, role=user.role)
    business = BusinessOut(id=user.id, name=user.business_name, tax_id=user.business_tax_id)
    return TokenResponse(access_token=token, user=user, business=business)


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def register(payload: RegisterRequest, db: Session = Depends(get_db)):
    if db.query(User).filter(User.email == payload.email).first():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "כתובת האימייל כבר רשומה במערכת")

    user = User(
        email=payload.email,
        hashed_password=hash_password(payload.password),
        role="owner",
        business_name=payload.business_name,
        business_tax_id=payload.business_tax_id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return _token_response(user)


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == payload.email).first()
    if not user or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "אימייל או סיסמה שגויים")
    return _token_response(user)
