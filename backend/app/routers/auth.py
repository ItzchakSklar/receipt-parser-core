from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Business, Category, User
from app.schemas import LoginRequest, RegisterRequest, TokenResponse
from app.security import create_access_token, hash_password, verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])

_DEFAULT_CATEGORIES = [
    "Office Supplies",
    "Travel",
    "Utilities",
    "Meals & Entertainment",
    "Software & Subscriptions",
]


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def register(payload: RegisterRequest, db: Session = Depends(get_db)):
    if db.query(User).filter(User.email == payload.email).first():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Email already registered")

    business = Business(name=payload.business_name, tax_id=payload.business_tax_id)
    db.add(business)
    db.flush()  # assigns business.id

    for name in _DEFAULT_CATEGORIES:
        db.add(Category(business_id=business.id, name=name))

    user = User(
        business_id=business.id,
        email=payload.email,
        hashed_password=hash_password(payload.password),
        role="owner",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    db.refresh(business)

    token = create_access_token(user_id=user.id, business_id=business.id, role=user.role)
    return TokenResponse(access_token=token, user=user, business=business)


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == payload.email).first()
    if not user or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid email or password")

    business = db.get(Business, user.business_id)
    token = create_access_token(user_id=user.id, business_id=user.business_id, role=user.role)
    return TokenResponse(access_token=token, user=user, business=business)
