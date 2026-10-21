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

# Stored values stay in English so existing invoice rows keep their category; only
# what the API returns to the (Hebrew-only) UI is translated.
CATEGORY_LABELS = {
    "Office Supplies": "ציוד משרדי",
    "Travel": "נסיעות",
    "Utilities": "חשבונות ושירותים",
    "Meals & Entertainment": "ארוחות ואירוח",
    "Software & Subscriptions": "תוכנה ומנויים",
}
UNCATEGORIZED_LABEL = "ללא קטגוריה"


def category_label(name: str | None) -> str | None:
    return CATEGORY_LABELS.get(name, name) if name else None


def category_id(name: str | None) -> int | None:
    return CATEGORIES.index(name) + 1 if name in CATEGORIES else None


def category_name(category_id: int | None) -> str | None:
    if category_id is None:
        return None
    if not 1 <= category_id <= len(CATEGORIES):
        raise ValueError(f"Unknown category_id {category_id}")
    return CATEGORIES[category_id - 1]
