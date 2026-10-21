"""Expense categories are a fixed list rather than a table: an invoice stores the
category name directly, and the API exposes each one with a stable id (its position
in this list) since the frontend's dropdowns and charts key on category_id."""

CATEGORIES = [
    "Office Supplies",
    "Travel",
    "Utilities",
    "Meals & Entertainment",
    "Software & Subscriptions",
]


def category_id(name: str | None) -> int | None:
    return CATEGORIES.index(name) + 1 if name in CATEGORIES else None


def category_name(category_id: int | None) -> str | None:
    if category_id is None:
        return None
    if not 1 <= category_id <= len(CATEGORIES):
        raise ValueError(f"Unknown category_id {category_id}")
    return CATEGORIES[category_id - 1]
