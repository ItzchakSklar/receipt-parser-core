from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_business_id
from app.models import Category
from app.schemas import CategoryCreate, CategoryOut

router = APIRouter(prefix="/api/categories", tags=["categories"])


@router.get("", response_model=list[CategoryOut])
def list_categories(
    business_id: int = Depends(get_current_business_id),
    db: Session = Depends(get_db),
):
    return (
        db.query(Category).filter(Category.business_id == business_id).order_by(Category.name).all()
    )


@router.post("", response_model=CategoryOut, status_code=201)
def create_category(
    payload: CategoryCreate,
    business_id: int = Depends(get_current_business_id),
    db: Session = Depends(get_db),
):
    category = Category(business_id=business_id, name=payload.name)
    db.add(category)
    db.commit()
    db.refresh(category)
    return category
