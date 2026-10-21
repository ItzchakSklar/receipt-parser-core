from fastapi import APIRouter, Depends

from app.categories import CATEGORIES, category_label
from app.dependencies import get_current_business_id
from app.schemas import CategoryOut

router = APIRouter(prefix="/api/categories", tags=["categories"])


@router.get("", response_model=list[CategoryOut])
def list_categories(business_id: int = Depends(get_current_business_id)):
    return [
        CategoryOut(id=index, business_id=business_id, name=category_label(name))
        for index, name in enumerate(CATEGORIES, start=1)
    ]
