# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

SmartReceipt: a multi-tenant SaaS app for small businesses to upload, OCR-parse, and analyze expense receipts. FastAPI + SQLAlchemy backend, React + TypeScript + Vite frontend.

## Tech Stack

- **Backend**: Python 3.11+, FastAPI, SQLAlchemy 2.0 (typed `Mapped[]` models), Pydantic v2, SQLite (dev, swappable for SQL Server via `pyodbc`), python-jose (JWT), bcrypt, uvicorn.
- **OCR**: `app/services/ocr_service.py` rasterizes every upload to per-page PIL images first (`_load_page_images` — PDFs via PyMuPDF/`pymupdf`, images via Pillow directly), then runs the same recognition engines over those images: Tesseract (`pytesseract`+`Pillow`) → EasyOCR, in that order. This unifies the pipeline so a PDF is held to the same confidence threshold as a photographed receipt, instead of a separate embedded-text-only path. Tesseract+Pillow+PyMuPDF are installed by default; EasyOCR is commented out in `requirements.txt`. Tesseract recognizes Hebrew+English (`heb+eng`) when `heb.traineddata`+`eng.traineddata` are present under `%LOCALAPPDATA%\SmartReceipt\tessdata` (fetched separately — Windows' default Tesseract install ships English only, its own `tessdata` dir isn't writable without admin rights, and the language dir deliberately lives outside the repo checkout since Tesseract's Windows binary reads `--tessdata-dir` via the ANSI codepage and chokes on any non-ASCII character in the path); falls back to English-only if that dir is missing.
- **Frontend**: React 19, TypeScript, Vite 8, Tailwind CSS v4, axios, recharts (dashboard charts), lucide-react (icons). Package manager is **pnpm** (not npm/yarn).
- No test suite exists in this repo yet.

## Commands

Backend (from `backend/`, with venv activated):
```bash
uvicorn app.main:app --reload --port 8000   # dev server, docs at /docs
python seed.py                               # seed 2 demo businesses (owner@acme.demo / password123)
```

Frontend (from `frontend/`):
```bash
pnpm dev        # dev server at :5173, proxies /api to :8000 (vite.config.ts) — no CORS needed in dev
pnpm lint       # eslint .
pnpm build      # tsc -b && vite build
pnpm preview
```

## Architecture

### Multi-tenancy (core invariant)
Every `Business` is a tenant. `User`, `Category`, `Invoice` all carry `business_id`. The JWT encodes `business_id`; `app/dependencies.py`'s `get_current_business_id` must be used to scope **every** tenant-data query — never query `Invoice`/`Category` without filtering by it. Uploaded files live under `uploads/<business_id>/...` on disk, never a shared path. There is no static `/uploads` mount — the only way to read a receipt file is `GET /api/invoices/{id}/file`, which re-checks tenant ownership.

### Backend layout (`backend/app/`)
- `main.py` — app entrypoint, CORS, router registration, calls `Base.metadata.create_all` + `database.ensure_schema()` on startup.
- `database.py` — engine/session. `ensure_schema()` is a hand-rolled additive migration (no Alembic): it `ALTER TABLE ADD COLUMN`s for SQLite dev DBs when a model gains a field that `create_all` won't retrofit onto an existing table. Extend this function, don't add a migration framework, when adding a nullable column.
- `models.py`, `schemas.py` — SQLAlchemy models / Pydantic I/O schemas, kept separate.
- `security.py` — bcrypt hashing + JWT encode/decode. `dependencies.py` — `get_current_user`/`get_current_business_id`, the tenant-scoping choke point.
- `routers/` — one file per resource (`auth`, `invoices`, `categories`, `dashboard`, `system`); `invoices.py` is the largest (upload, OCR-confirm flow, duplicate/conflict resolution, file serving, monthly export, CRUD).
- `services/` — `ocr_service.py` (zero-hallucination OCR, see below), `report_service.py` (monthly CSV + receipts zip), `email_service.py` (SMTP, mock-mode fallback), `external_time_service.py` (WorldTimeAPI client).

### Zero-hallucination OCR policy
`ocr_service.py` extracts vendor name, amount, date, and tax ID and **never invents data**. An engine's result is accepted only at ≥60% average confidence with all required fields found. If every engine fails or none is installed, `POST /api/invoices/upload` returns `422` with `{"detail": {"error": "INVALID_OCR_DATA", "missing_fields": [...], "extracted": {...}, "file_reference": "..."}}` — the file is still saved to disk. The frontend (`UploadZone`) never shows a manual-entry form for this; it prompts re-upload instead, so every DB row stays OCR-verified (`Invoice.ocr_source: "ocr" | "manual"`). Already-saved invoices can be corrected afterward via `PUT/PATCH /api/invoices/{id}` (edit action in the file explorer), which is the one legitimate path to `ocr_source: "manual"`.

### Duplicate/conflict detection
`invoices.py` has `_find_potential_duplicate`, `_find_exact_match_by_tax_id`, `_is_exact_match`, `_check_for_duplicate` guarding `POST /upload`, plus a dedicated `POST /api/invoices/resolve-conflict` endpoint. `ConflictResolutionModal.tsx` on the frontend drives the resolution UI when an upload collides with an existing invoice. `Invoice.invoice_number` (optional, OCR best-effort) is used to key this when present.

### Frontend layout (`frontend/src/`)
- `App.tsx` — tab switcher (Dashboard / Upload / Invoices), gated by `AuthContext.isAuthenticated`.
- `context/AuthContext.tsx` — auth state; token/user/business persisted to `localStorage` under `smartreceipt_*` keys.
- `api/client.ts` — single axios instance, JWT bearer interceptor, auto-logout + reload on `401`.
- `components/` — `InvoiceExplorer.tsx` (folder-style browser: `MonthFolderCard` → `ReceiptFileCard`/`ReceiptThumbnail`, with `ReceiptLightboxModal` for full-size viewing and `ContextMenu` for edit/delete/download), `Dashboard.tsx` (stat cards + recharts), `UploadZone.tsx` (drag-drop, handles the OCR-retry flow), `EditInvoiceModal.tsx`, `ConflictResolutionModal.tsx`, `SendToAccountantModal.tsx`, `ConfirmDialog.tsx`/`Modal.tsx` (shared shells).
- `utils/currency.ts` — shared amount formatting.

### Monthly accountant export
`POST /api/invoices/export-monthly` (`{email, month, year}`) builds a CSV + zip of that month's receipts (`report_service.py`) and emails them (`email_service.py`). SMTP is optional: with no `SMTP_HOST` set, the email is written to `backend/sent_emails/*.eml` and the response reports `"mode": "mock"` instead of sending — treat this as intended dev behavior, not a bug.

### External time
`GET /api/system/time` proxies WorldTimeAPI to stamp `Invoice.uploaded_at_external_time` and drive the header's live clock. On failure it falls back to local UTC and flags `source: "local_fallback"` rather than erroring.

## Conventions

- Backend: type-annotated SQLAlchemy 2.0 style (`Mapped[T]`/`mapped_column`) and Pydantic v2 throughout; keep this consistent for new models/schemas.
- Settings only ever come from `app.config.settings` (env/`.env` via `pydantic-settings`) — don't read `os.environ` directly elsewhere.
- Frontend: functional components + hooks only, Tailwind utility classes for styling (no CSS modules/styled-components), `lucide-react` for icons.
- Comments are used sparingly in this codebase, mainly to explain non-obvious *why* (e.g. the zero-hallucination policy, the `ensure_schema` workaround) — match that density rather than narrating what code does.
