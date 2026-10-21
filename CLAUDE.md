# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

SmartReceipt: a multi-tenant SaaS app for small businesses to upload, OCR-parse, and analyze expense receipts. FastAPI + SQLAlchemy backend, React + TypeScript + Vite frontend.

Production frontend: <https://receipt-parser-core.vercel.app/> (Vercel, backend on Render — see "Render + Vercel deployment" below).

## Tech Stack

- **Backend**: Python 3.11+, FastAPI, SQLAlchemy 2.0 (typed `Mapped[]` models), Pydantic v2, hosted Turso (libSQL) via the official `libsql` driver — the **only** storage, for users, invoices and the receipt files themselves, shared by local dev and every deployment (see README "Database (Turso)"). python-jose (JWT), bcrypt, uvicorn.
- **OCR**: `app/services/ocr_service.py` rasterizes every upload to per-page PIL images first (`_load_page_images` — PDFs via PyMuPDF/`pymupdf`, images via Pillow directly), then runs the same recognition engines over those images: Tesseract (`pytesseract`+`Pillow`) → EasyOCR, in that order. This unifies the pipeline so a PDF is held to the same confidence threshold as a photographed receipt, instead of a separate embedded-text-only path. Tesseract+Pillow+PyMuPDF are installed by default; EasyOCR is commented out in `requirements.txt`. Tesseract recognizes Hebrew+English (`heb+eng`) when `heb.traineddata`+`eng.traineddata` are present under `%LOCALAPPDATA%\SmartReceipt\tessdata` (fetched separately — Windows' default Tesseract install ships English only, its own `tessdata` dir isn't writable without admin rights, and the language dir deliberately lives outside the repo checkout since Tesseract's Windows binary reads `--tessdata-dir` via the ANSI codepage and chokes on any non-ASCII character in the path); falls back to English-only if that dir is missing.
- **Frontend**: React 19, TypeScript, Vite 8, Tailwind CSS v4, axios, recharts (dashboard charts), lucide-react (icons). Package manager is **pnpm** (not npm/yarn).
- **Backend tests**: `backend/tests/` (pytest) — health check, auth register/login, invoice file storage/tenant isolation, and `ocr_service.parse_total_amount` unit tests. `backend/tests/conftest.py` points `app.config.settings` at a throwaway temp-dir SQLite DB *before* `app.main` is imported, so tests never touch the real Turso database.
- **Pre-commit hook**: `frontend/.husky/pre-commit` (wired via `pnpm install`'s `prepare` script setting `core.hooksPath`) runs Prettier via lint-staged on frontend files and `ruff format` + `ruff check --fix` on staged `.py` files using `backend/.venv/Scripts/ruff.exe` (Windows venv path).
- **Frontend**: no test runner is configured — CI only typechecks (`tsc -b`). `pnpm lint` is currently broken (no `eslint.config.js` committed, plus several pre-existing `@typescript-eslint/no-explicit-any` errors) — fix both before wiring lint into CI.

## Commands

Backend (from `backend/`, with venv activated):
```bash
uvicorn app.main:app --reload --port 8000   # dev server, docs at /docs
python seed.py                               # seed 2 demo businesses (owner@acme.demo / password123)
pytest                                        # run backend/tests/
ruff check . && ruff format --check .        # same lint/format gate as CI
```

Frontend (from `frontend/`):
```bash
pnpm dev        # dev server at :5173, proxies /api to :8000 (vite.config.ts) — no CORS needed in dev
pnpm lint       # eslint . — currently broken, see above
pnpm build      # tsc -b && vite build
pnpm preview
```

## Architecture

### Multi-tenancy (core invariant)
The database has exactly two tables, by the user's explicit choice: `users` and `invoices`. Each `User` row *is* a tenant — business name/tax id are columns on it (`User.business_id` is a property returning `id`), and `Invoice.business_id` is a FK to `users.id`. Categories are not a table: `app/categories.py` is a fixed list, `Invoice.category` stores the name, and the API maps it to a positional `category_id` for the frontend. The JWT encodes `business_id`; `app/dependencies.py`'s `get_current_business_id` must be used to scope **every** tenant-data query — never query `Invoice` without filtering by it. Receipt files are stored in the invoice row (`file_content` BLOB, `deferred()` so list queries don't pull them over the network — `undefer()` it where the bytes are actually needed); nothing is written to local disk. The only way to read a receipt file is `GET /api/invoices/{id}/file`, which re-checks tenant ownership.

### Backend layout (`backend/app/`)
- `main.py` — app entrypoint, CORS, router registration, calls `Base.metadata.create_all` on startup.
- `database.py` — engine/session. `DATABASE_URL` is required (no default, no fallback): `sqlite+libsql://<db>-<org>.turso.io/?authToken=<token>`. The only other URL form ever used is plain `sqlite://` by `tests/conftest.py`, so tests never touch Turso.
- `libsql_dialect.py` — `LibSQLDialect`, registered as `sqlite+libsql`. Exists because `sqlalchemy-libsql` depends on `libsql-experimental`, which has no Windows wheel (needs Rust to build) — don't reintroduce that package. Patches over gaps in the `libsql` driver: no `create_function` (so `on_connect` is skipped), no `Binary` (aliased to `bytes`), no `check_same_thread` kwarg, and forces `QueuePool` since pysqlite would pick `SingletonThreadPool` for a host-only URL. `create_connect_args` validates the host/`authToken` up front because libsql only reports a malformed `DATABASE_URL` (leftover `<db>-<org>` placeholder, invisible chars pasted into a hosting dashboard) as an opaque `InvalidUriChar` at first connect.
- `create_all` never adds columns to existing tables, and there's no migration tooling — a new column on a model must also be `ALTER TABLE`d into the Turso DB by hand.
- `models.py`, `schemas.py` — SQLAlchemy models / Pydantic I/O schemas, kept separate.
- `security.py` — bcrypt hashing + JWT encode/decode. `dependencies.py` — `get_current_user`/`get_current_business_id`, the tenant-scoping choke point.
- `routers/` — one file per resource (`auth`, `invoices`, `categories`, `dashboard`, `system`); `invoices.py` is the largest (upload, unrecognized-sort flow, duplicate/conflict resolution, file serving, monthly export, CRUD).
- `services/` — `ocr_service.py` (zero-hallucination OCR, see below), `external_time_service.py` (WorldTimeAPI client).

### Zero-hallucination OCR policy
`ocr_service.py` extracts vendor name, amount, date, tax ID and invoice number and **never invents data**. An engine's result is accepted only at ≥60% average confidence with all `REQUIRED_FIELDS` (vendor, amount, date) found — tax ID is deliberately optional, since many real receipts leave the ע"מ field blank. Every attempt (Pillow/PyMuPDF open, per-page raw OCR text, per-PSM confidence, which required field(s) failed) is logged with `print("[ocr_service] ...")` — there's no `logging.basicConfig()` anywhere in the app, so `logger.info`/`logger.debug` calls are silently swallowed by Python's root logger; `print()` is the only reliable way to get this into the console, which is why the module already used it before this comment existed.

If every engine fails or none is installed, `POST /api/invoices/upload` no longer rejects the file: it creates an `Invoice` row (file included) with `is_unrecognized=True` (`Invoice.vendor_name`/`amount`/`date` get filename/zero/now placeholders purely to satisfy NOT NULL columns — they are never shown as real data behind that flag). This is the "לא מזוהים" (Unrecognized) folder: a persistent top-level entry in `InvoiceExplorer` (`UnrecognizedFolderCard`, badge = count) shown regardless of the Year/Month filter, backed by `GET /api/invoices/unrecognized`. `GET /api/invoices`, and the dashboard stats query both filter `is_unrecognized == False` so these rows never leak into normal totals/folders. A user reviews one via `UnrecognizedReviewModal` (preview + form) and submits `POST /api/invoices/unrecognized/{id}/sort`, which applies the confirmed vendor/amount/date and clears the flag — that's the only legitimate path to `ocr_source: "manual"` for these rows. Already-saved *normal* invoices can still be corrected via `PUT/PATCH /api/invoices/{id}` (edit action in the file explorer).

### Duplicate/conflict detection
`invoices.py`'s `_find_duplicate` (invoice number + *similar* vendor via `_similar_vendor` — punctuation/בע"מ/Ltd stripped, then `SequenceMatcher` ≥ 0.8 — or, when either side has no invoice number, similar vendor + same date; two different invoice numbers never match) guards both `POST /upload` (via `_check_for_duplicate`) and `POST /unrecognized/{id}/sort`, so hand-completed receipts get the same check. `/upload` also rejects a byte-identical file (`_find_identical_file`) before running OCR. Exact data → 409 `DUPLICATE_EXISTS`; same number, different data → 409 `DUPLICATE_CONFLICT`, resolved via `POST /api/invoices/resolve-conflict` (`keep_existing` / `update_with_new` / `keep_both`), whose new side is either a held upload (`file_reference`) or the unrecognized row being completed (`new_invoice_id`, deleted once resolved). The frontend form for completing a partial read is `CompleteReceiptForm.tsx`, shared by `UploadZone` and `UnrecognizedReviewModal`. `ConflictResolutionModal.tsx` on the frontend drives the resolution UI when an upload collides with an existing invoice. On `DUPLICATE_CONFLICT` the new upload isn't saved yet — it's held in the in-process `_pending_uploads` dict (1h TTL, tenant-checked) under the `file_reference` returned to the client, served by `/file-preview` and consumed by `/resolve-conflict`. In-memory is a deliberate trade-off to avoid a third table; it assumes a single backend process. `Invoice.invoice_number` (optional, OCR best-effort) is used to key this when present.

### Frontend layout (`frontend/src/`)
- `App.tsx` — tab switcher (Dashboard / Upload / Invoices), gated by `AuthContext.isAuthenticated`.
- `context/AuthContext.tsx` — auth state; token/user/business persisted to `localStorage` under `smartreceipt_*` keys.
- `api/client.ts` — single axios instance, JWT bearer interceptor, auto-logout + reload on `401`.
- `components/` — `InvoiceExplorer.tsx` (folder-style browser: `MonthFolderCard` → `ReceiptFileCard`/`ReceiptThumbnail`, with `ReceiptLightboxModal` for full-size viewing and `ContextMenu` for edit/delete/download; plus the persistent `UnrecognizedFolderCard` → `UnrecognizedFileCard` → `UnrecognizedReviewModal` for the "לא מזוהים" folder), `Dashboard.tsx` (stat cards + recharts), `UploadZone.tsx` (pick/drag/camera → preview with confirm / retake / pick another → OCR with an elapsed-seconds counter → result screen with the preview and extracted fields; for an unrecognized file the upload response's non-persisted `ocr_reason`/`ocr_missing_fields` say why (corrupt / blurry / fields missing). It stays on the upload tab instead of jumping to Invoices, so the result is actually seen), `EditInvoiceModal.tsx`, `ConflictResolutionModal.tsx`, `SendToAccountantModal.tsx` (monthly report share/download), `ConfirmDialog.tsx`/`Modal.tsx` (shared shells).
- `api/cache.ts` — IndexedDB cache (per tenant, 24h TTL) for GET responses and receipt files; any successful non-GET request clears cached responses, and the header's refresh button does the same for changes made on another device.
- `utils/currency.ts` — shared amount formatting. `utils/accountantReport.ts` — client-side monthly report (see below).

### Monthly accountant export
Built entirely in the browser — there is no backend endpoint or email service. `SendToAccountantModal` takes the month's invoices from the cached `/invoices` list, `utils/accountantReport.ts` writes the CSV and pulls each receipt via `getReceiptFile` (usually already cached, so typically zero server calls), zips them with `fflate`, and hands them to `navigator.share` (OS share sheet: WhatsApp, mail, ...) with a zip download fallback. The zip is download-only: Chrome's `canShare` accepts it but `share()` then rejects it with `NotAllowedError: Permission denied`, and likewise for >10 files / >50MB / non-allowlisted extensions — so `shareableFiles` shares the CSV + receipt files individually and enforces those limits itself, falling back to download-only. An earlier server-side SMTP/Brevo email flow was removed because Render's free tier blocks SMTP and the setup was too heavy for users.

### External time
`GET /api/system/time` proxies WorldTimeAPI to stamp `Invoice.uploaded_at_external_time` and drive the header's live clock. On failure it falls back to local UTC and flags `source: "local_fallback"` rather than erroring.

### CI/CD & Docker
`.github/workflows/deploy.yml` runs on every push/PR to `main`: `test-backend`/`test-frontend` jobs, then (push to `main` only) `build` pushes `backend/Dockerfile`/`frontend/Dockerfile` images to GHCR, then `deploy` SSHes into a server to `docker compose pull && up -d` the root `docker-compose.yml`. See the README's "GitHub Actions CI/CD Setup" section for required repo secrets. `backend/Dockerfile` installs `tesseract-ocr`+`tesseract-ocr-heb` via apt and copies the trained data into `$LOCALAPPDATA/SmartReceipt/tessdata` (with `LOCALAPPDATA` set to a fixed path) to match the exact directory layout `ocr_service.py` looks for — keep that layout in sync if the lookup path in `ocr_service.py` ever changes. The Dockerfile's `CMD` is shell-form (`--port ${PORT:-8000}`), not exec-form, specifically so Render's injected `$PORT` gets substituted at container start.

### Render + Vercel deployment
`app/config.py`'s `port` (bound to Render's injected `PORT` env var) and `frontend_url` (merged into `cors_origin_list` alongside `cors_origins`) exist for this path — see the README's "Deploying to Render + Vercel" section for the full click-through. `frontend/src/api/client.ts`'s axios `baseURL` reads `import.meta.env.VITE_API_BASE_URL`, needed because Vercel (frontend) and Render (backend) are on different origins, unlike the same-origin nginx-proxy setup in `docker-compose.yml`. `frontend/vercel.json` rewrites all routes to `index.html` for SPA client-side routing. Render's free tier has an ephemeral filesystem, which is fine because all data (files included) lives in Turso — keep it that way rather than writing anything persistent to local disk.

## Conventions

- Backend: type-annotated SQLAlchemy 2.0 style (`Mapped[T]`/`mapped_column`) and Pydantic v2 throughout; keep this consistent for new models/schemas.
- Settings only ever come from `app.config.settings` (env/`.env` via `pydantic-settings`) — don't read `os.environ` directly elsewhere.
- Frontend: functional components + hooks only, Tailwind utility classes for styling (no CSS modules/styled-components), `lucide-react` for icons.
- Comments are used sparingly in this codebase, mainly to explain non-obvious *why* (e.g. the zero-hallucination policy, the `ensure_schema` workaround) — match that density rather than narrating what code does.
