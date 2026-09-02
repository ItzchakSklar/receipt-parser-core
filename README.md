# SmartReceipt

A multi-tenant SaaS application for small businesses to upload, OCR-parse, and analyze
their expense receipts.

## Project Structure

```
receipt-parser-core/
|-- backend/                    FastAPI + SQLAlchemy API
|   |-- app/
|   |   |-- main.py                 App entrypoint, CORS, router registration
|   |   |-- config.py               Settings loaded from .env
|   |   |-- database.py             SQLAlchemy engine/session
|   |   |-- models.py               Business, User, Category, Invoice (tenant-scoped)
|   |   |-- schemas.py              Pydantic request/response models
|   |   |-- security.py             Password hashing (bcrypt) + JWT
|   |   |-- dependencies.py         get_current_user / get_current_business_id
|   |   |-- routers/
|   |   |   |-- auth.py             POST /api/auth/register, /api/auth/login
|   |   |   |-- invoices.py         Upload, confirm, list, file, update (PUT/PATCH), delete, export-monthly
|   |   |   |-- categories.py       List/create expense categories
|   |   |   |-- dashboard.py        GET /api/dashboard/stats
|   |   |   |-- system.py           GET /api/system/time (WorldTimeAPI proxy)
|   |   |-- services/
|   |       |-- ocr_service.py             Tesseract/EasyOCR/pypdf, zero-hallucination
|   |       |-- external_time_service.py   WorldTimeAPI client
|   |       |-- report_service.py          Monthly CSV + receipts zip builder
|   |       |-- email_service.py           SMTP sender (mock mode without SMTP config)
|   |-- seed.py                     Seeds 2 demo businesses with sample data
|   |-- requirements.txt
|   |-- .env.example
|
|-- frontend/                   React + TypeScript + Vite + Tailwind CSS v4
    |-- src/
        |-- App.tsx                  Tab layout (Dashboard / Upload / Invoices)
        |-- context/AuthContext.tsx
        |-- api/client.ts            Axios instance with JWT interceptor
        |-- types/index.ts
        |-- components/
            |-- Header.tsx               Nav + live clock + user menu
            |-- LiveClock.tsx            Live external-time widget
            |-- LoginForm.tsx            Sign in / register a business
            |-- UploadZone.tsx           Drag & drop receipt upload (zero-form retry on unclear scans)
            |-- ReceiptPreviewModal.tsx  View the original receipt image/PDF
            |-- ContextMenu.tsx          Right-click menu on receipt cards (edit/delete/download)
            |-- EditInvoiceModal.tsx     Edit vendor/amount/date/category for one invoice
            |-- ConfirmDialog.tsx        Generic confirmation dialog (used for delete)
            |-- SendToAccountantModal.tsx  Monthly report email dispatch
            |-- Modal.tsx                Shared modal shell
            |-- Dashboard.tsx            Stat cards + pie/bar charts (recharts)
            |-- InvoiceList.tsx          Searchable/filterable invoice table
```

## Multi-Tenancy Model

Every business (tenant) is an isolated `Business` row. `Users`, `Categories`, and
`Invoices` all carry a `business_id` foreign key. The authenticated user's JWT encodes
their `business_id`; every API query filters by it (see `app/dependencies.py`), and
uploaded files are stored under a per-tenant folder (`uploads/<business_id>/...`) so
tenants can never see each other's data.

## Prerequisites

- Python 3.11+
- Node.js 18+
- pnpm 9+ (`corepack enable` will provide it, or `npm install -g pnpm`)

## Running the Backend

```bash
cd backend
python -m venv .venv

# Windows
.venv\Scripts\activate
# macOS/Linux
source .venv/bin/activate

pip install -r requirements.txt
copy .env.example .env      # Windows: copy, macOS/Linux: cp .env.example .env

# Optional: seed two demo businesses with sample invoices
python seed.py

uvicorn app.main:app --reload --port 8000
```

The API is now available at `http://localhost:8000` (interactive docs at
`http://localhost:8000/docs`).

Demo login (after seeding): `owner@acme.demo` / `password123`

## Running the Frontend

```bash
cd frontend
pnpm install
pnpm dev
```

The app is now available at `http://localhost:5173`. Vite proxies `/api` requests to
the backend on port 8000 (see `vite.config.ts`), so no CORS configuration is needed in
development.

To build for production:

```bash
pnpm build
pnpm preview
```

## Switching to SQL Server

By default the backend uses a local SQLite file. To use SQL Server instead, install
`pyodbc` and the Microsoft ODBC Driver, then set in `backend/.env`:

```
DATABASE_URL=mssql+pyodbc://user:password@localhost/SmartReceipt?driver=ODBC+Driver+17+for+SQL+Server
```

## OCR Engine (Zero-Hallucination Policy)

`app/services/ocr_service.py` extracts Vendor Name, Total Amount, Date, and Tax ID
(Israeli company/business ID) from an uploaded receipt using real extraction only -
it never invents data. It tries, in order:

1. **Tesseract** (`pytesseract` + `Pillow`), if installed - accepted only when average
   OCR confidence is >= 60% and all required fields were found
2. **EasyOCR**, if installed - same confidence/field requirements
3. **pypdf** embedded-text extraction, for PDFs with a text layer

If no engine is installed, the file can't be read reliably, or confidence is too low,
`POST /api/invoices/upload` returns `422` with:

```json
{
  "detail": {
    "error": "INVALID_OCR_DATA",
    "message": "...",
    "missing_fields": ["amount", "date"],
    "extracted": { "vendor_name": "..." },
    "file_reference": "uploads/1/<uuid>.jpg"
  }
}
```

The file is still saved on disk. The frontend never opens a manual fill-in form for
this - `UploadZone` shows a friendly "not clear enough, please re-upload" banner with a
single retry action instead, so every row in the database stays OCR-verified
(`ocr_source: "ocr"`). A saved invoice's vendor/amount/date/category can still be
corrected afterwards via the file explorer's right-click "Edit Details" action
(`PUT /api/invoices/{id}`).

To enable real OCR, uncomment the relevant lines in `backend/requirements.txt` and
`pip install` them (for Tesseract, also install the Tesseract binary itself and make
sure it's on your `PATH`).

## Receipt File Storage & Viewing

Uploaded files are stored per-tenant under `uploads/<business_id>/` and are **not**
served as static files (no public `/uploads` mount). The only way to read a receipt is
`GET /api/invoices/{id}/file`, which is JWT-scoped to the caller's business - so one
tenant can never fetch another tenant's receipt, even by guessing a file path. The
frontend's `ReceiptPreviewModal` fetches this endpoint as a blob and renders it as an
`<img>` (JPEG/PNG/WEBP) or `<iframe>` (PDF); click the eye icon on any row in the
invoice table to open it. Right-click a receipt card in the file explorer for
"Download Original File", which fetches the same endpoint and saves it locally.
`DELETE /api/invoices/{id}` removes both the database row and the file on disk.

## Monthly Accountant Export

`POST /api/invoices/export-monthly` (body: `{ "email", "month", "year" }`) aggregates
that month's validated invoices for the caller's business, builds a CSV summary
(`app/services/report_service.py`) and a zip of the original receipt files, and emails
both to the given address via `app/services/email_service.py`. Use the **Send to
Accountant** (שלח לרואה חשבון) button on the Dashboard to trigger it from the UI.

SMTP is optional: if `SMTP_HOST` is unset in `backend/.env`, the composed email is
written to `backend/sent_emails/*.eml` instead of being sent, and the response reports
`"mode": "mock"` so the UI can tell the user. Configure `SMTP_HOST`/`SMTP_USERNAME`/
`SMTP_PASSWORD` etc. in `.env` to send for real.

## External Time (WorldTimeAPI)

`GET /api/system/time` proxies `http://worldtimeapi.org/api/ip` and is used both to
stamp `uploaded_at_external_time` on every invoice and to power the live clock widget
in the header. If the external API is unreachable, the backend falls back to local UTC
time and flags the response with `source: "local_fallback"` so the app keeps working
offline.

## GitHub Actions CI/CD Setup

`.github/workflows/deploy.yml` defines three jobs that run on every push (and PR) to
`main`:

1. **test** (`test-backend` + `test-frontend`) - `test-backend` installs
   `backend/requirements*.txt` (plus the `tesseract-ocr` apt package) and runs
   `ruff check`, `ruff format --check`, and `pytest`. `test-frontend` runs
   `pnpm install --frozen-lockfile` and `tsc -b` (typecheck).
2. **build** (push to `main` only, after tests pass) - builds `backend/Dockerfile`
   and `frontend/Dockerfile` and pushes them to the GitHub Container Registry (GHCR)
   as `ghcr.io/<owner>/<repo>/backend` and `ghcr.io/<owner>/<repo>/frontend`, tagged
   with both `latest` and the commit SHA. Uses the automatically-provided
   `GITHUB_TOKEN`, so no registry secret needs to be configured.
3. **deploy** (push to `main` only, after build succeeds) - copies the root
   `docker-compose.yml` to a target server over SSH, then runs `docker compose pull
   && docker compose up -d` there so the server picks up the images just pushed by
   the build job.

### Required GitHub repository secrets

Set these under **Settings > Secrets and variables > Actions** in the GitHub repo:

| Secret            | Purpose                                                                 |
| ------------------ | ------------------------------------------------------------------------ |
| `SSH_PRIVATE_KEY` | Private key (PEM, no passphrase) whose public half is in the deploy server's `~/.ssh/authorized_keys` |
| `SERVER_HOST`     | Hostname or IP of the target production/staging server                 |
| `SERVER_USER`     | SSH user on that server (needs Docker permissions, e.g. in the `docker` group) |

No registry secret is needed - the workflow logs in to GHCR with the built-in
`secrets.GITHUB_TOKEN`, both to push images from the `build` job and to let the
deploy server pull them. The first time this runs, GHCR creates the
`backend`/`frontend` packages as **private** by default; either make them public
(package **Settings > Change visibility**) or link them to the repo (**Package
settings > Manage Actions access**) so the deploy server's login has pull access.

The deploy server itself needs, once, ahead of the first deploy:

- Docker + the Docker Compose plugin installed
- A `~/smartreceipt/` directory
- A `~/smartreceipt/.env` file (copy from the repo's root `.env.example` and fill in
  `SECRET_KEY`, `CORS_ORIGINS`, and SMTP settings) - `docker-compose.yml` reads it for
  variable substitution

### Triggering deployments

As written, `deploy` runs automatically after every push to `main` once `build`
succeeds. To require a manual approval instead, add a
[GitHub Environment](https://docs.github.com/en/actions/deployment/targeting-different-environments/using-environments-for-deployment)
named `production` (the `deploy` job already declares `environment: production`)
with a required reviewer configured under **Settings > Environments** - pushes to
`main` will then pause at the deploy job until someone approves it in the Actions run.

### Running the stack locally

```bash
cp .env.example .env      # fill in SECRET_KEY etc.
docker compose up --build
```

This builds `backend/Dockerfile` and `frontend/Dockerfile` locally and serves the
frontend (nginx, reverse-proxying `/api` to the backend container) on
`http://localhost`, with the backend on `http://localhost:8000`.
