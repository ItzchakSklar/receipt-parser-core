from collections import defaultdict

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_business_id
from app.models import Category, Invoice
from app.schemas import CategoryBreakdown, DashboardStats, MonthlyTotal

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("/stats", response_model=DashboardStats)
def get_dashboard_stats(
    business_id: int = Depends(get_current_business_id),
    db: Session = Depends(get_db),
):
    invoices = db.query(Invoice).filter(Invoice.business_id == business_id).all()

    total_spent = sum(inv.amount for inv in invoices)
    invoice_count = len(invoices)
    average_invoice = round(total_spent / invoice_count, 2) if invoice_count else 0.0

    category_totals: dict[int | None, float] = defaultdict(float)
    category_counts: dict[int | None, int] = defaultdict(int)
    for inv in invoices:
        category_totals[inv.category_id] += inv.amount
        category_counts[inv.category_id] += 1

    categories = {c.id: c.name for c in db.query(Category).filter(Category.business_id == business_id).all()}

    category_breakdown = [
        CategoryBreakdown(
            category_id=category_id,
            category_name=categories.get(category_id, "Uncategorized"),
            total=round(total, 2),
            count=category_counts[category_id],
        )
        for category_id, total in sorted(category_totals.items(), key=lambda kv: kv[1], reverse=True)
    ]

    monthly_totals_map: dict[str, float] = defaultdict(float)
    for inv in invoices:
        month_key = inv.date.strftime("%Y-%m")
        monthly_totals_map[month_key] += inv.amount

    monthly_totals = [
        MonthlyTotal(month=month, total=round(total, 2))
        for month, total in sorted(monthly_totals_map.items())
    ]

    return DashboardStats(
        total_spent=round(total_spent, 2),
        invoice_count=invoice_count,
        average_invoice=average_invoice,
        category_breakdown=category_breakdown,
        monthly_totals=monthly_totals,
    )
