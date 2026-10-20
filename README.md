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
|   |   |-- database.py             SQLAlchemy engine/session (Turso)
|   |   |-- libsql_dialect.py       SQLAlchemy dialect for the `libsql` driver
|   |   |-- models.py               User (= business), Invoice (incl. the file itself)
|   |   |-- categories.py           Fixed list of expense categories
|   |   |-- schemas.py              Pydantic request/response models
|   |   |-- security.py             Password hashing (bcrypt) + JWT
|   |   |-- dependencies.py         get_current_user / get_current_business_id
|   |   |-- routers/
|   |   |   |-- auth.py             POST /api/auth/register, /api/auth/login
|   |   |   |-- invoices.py         Upload, list, file, update (PUT/PATCH), delete, export-monthly
|   |   |   |-- categories.py       List expense categories
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

All data lives in one hosted [Turso](https://turso.tech) database with two tables:

- `users` - one row per account. Each user is also their own business (tenant): the
  business name and tax id are columns on this row.
- `invoices` - one row per receipt, including the original file itself (as a BLOB),
  its extracted fields, and `business_id` - the `users.id` of the business it
  belongs to.

The authenticated user's JWT encodes their `business_id`; every API query filters by
it (see `app/dependencies.py`), so tenants can never see each other's data.

## Prerequisites

- Python 3.11+
- Node.js 18+
- pnpm 9+ (`corepack enable` will provide it, or `npm install -g pnpm`)
- A free [Turso](https://turso.tech) database (see [Database (Turso)](#database-turso))
  - there's no local install for it, just a URL + token. Local dev and any
  deployment share the same database.

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
```

Put your Turso database URL in `backend/.env`'s `DATABASE_URL` (see [Database
(Turso)](#database-turso)). This is also what any deployment (Docker Compose, Render,
...) points at, so local dev and production share one database.

Then:

```bash
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

## Database (Turso)

The backend stores everything - users, invoices, and the receipt files themselves -
in a single hosted [Turso](https://turso.tech) (libSQL) database. Nothing is written
to local disk, so the same data is visible from local dev and every deployment, and
redeploys/restarts (e.g. on Render's free tier) lose nothing.

### Setup

1. Create a database (Turso dashboard, or the CLI: `turso db create smartreceipt`).
2. Get its URL - `turso db show smartreceipt --url` - and a token - `turso db tokens
   create smartreceipt`.
3. In `backend/.env`, set:

   ```
   DATABASE_URL=sqlite+libsql://<db>-<org>.turso.io/?authToken=<token>
   ```

   (Turso shows the URL as `libsql://...` - replace that prefix with
   `sqlite+libsql://`.)
4. Start the backend - it creates the two tables (`users`, `invoices`) on first
   startup.

The driver is the official `libsql` package (in `requirements.txt`), which ships
prebuilt wheels for Windows/macOS/Linux - no compiler or Rust toolchain needed. Don't
install `sqlalchemy-libsql`: it depends on the old `libsql-experimental` driver, which
has to be compiled from source on Windows. `app/libsql_dialect.py` does the same job
on top of `libsql`.

`Base.metadata.create_all` only creates missing tables - it never adds a new column
to an existing one. When a model gains a column, add it to the Turso database by
hand (`ALTER TABLE invoices ADD COLUMN ...`, e.g. from `turso db shell`).

## OCR Engine (Zero-Hallucination Policy)

`app/services/ocr_service.py` extracts Vendor Name, Total Amount, Date, and Tax ID
(Israeli company/business ID) from an uploaded receipt using real extraction only -
it never invents data. It tries, in order:

1. **Tesseract** (`pytesseract` + `Pillow`), if installed - accepted only when average
   OCR confidence is >= 60% and all required fields were found
2. **EasyOCR**, if installed - same confidence/field requirements
3. **pypdf** embedded-text extraction, for PDFs with a text layer

If no engine is installed, the file can't be read reliably, or confidence is too low,
`POST /api/invoices/upload` still saves the receipt (file included) but flags it
`is_unrecognized` - it shows up in the "לא מזוהים" (Unrecognized) folder in the file
explorer instead of the normal Year/Month folders and dashboard totals. The user
fills in the real vendor/amount/date there (`POST /api/invoices/unrecognized/{id}/sort`).
A saved invoice's vendor/amount/date/category can still be corrected afterwards via
the file explorer's right-click "Edit Details" action (`PUT /api/invoices/{id}`).

To enable real OCR, uncomment the relevant lines in `backend/requirements.txt` and
`pip install` them (for Tesseract, also install the Tesseract binary itself and make
sure it's on your `PATH`).

## Receipt File Storage & Viewing

Uploaded files are stored inside the `invoices` row itself (`file_content`, with
`file_name`/`file_content_type` alongside), not on disk. The only way to read a
receipt is `GET /api/invoices/{id}/file`, which is JWT-scoped to the caller's
business - so one tenant can never fetch another tenant's receipt. The frontend
fetches this endpoint as a blob and renders it as an `<img>` (JPEG/PNG/WEBP) or
`<iframe>` (PDF). Right-click a receipt card in the file explorer for "Download
Original File", which fetches the same endpoint and saves it locally.
`DELETE /api/invoices/{id}` removes the row, file included.

An upload that collides with an existing invoice (409 `DUPLICATE_CONFLICT`) isn't
saved until the user resolves the conflict - it's held in the backend's memory for up
to an hour meanwhile, so it's lost if the backend restarts before the user decides.

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
  `SECRET_KEY`, `DATABASE_URL` (the Turso URL - see
  [Database (Turso)](#database-turso)), `CORS_ORIGINS`, and
  SMTP settings) - `docker-compose.yml` reads it for variable substitution, and
  `DATABASE_URL` has no default, so `docker compose up -d` fails on the server
  without it

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

## Deploying to Render + Vercel (Free Tier)

Unlike the GitHub Actions/GHCR/self-hosted-server path above, this deploys the
backend to **Render** and the frontend to **Vercel** directly from GitHub - both
have a free tier and neither needs the `.github/workflows/deploy.yml` pipeline
(each platform builds on its own when you push to `main`).

> **Storage note:** Render's free web services use an ephemeral filesystem that is
> wiped on every deploy and restart. That doesn't affect this app - all data,
> receipt files included, lives in Turso, outside Render.

### 1. Backend on Render

1. Push this repo to GitHub (Render deploys straight from a GitHub connection, no
   registry involved).
2. In the [Render dashboard](https://dashboard.render.com/), click **New >
   Web Service**.
3. **Connect a repository**: authorize Render's GitHub app if you haven't already,
   then pick this repo.
4. Configure the service:
   - **Root Directory**: `backend`
   - **Runtime**: `Docker` (Render detects `backend/Dockerfile` automatically)
   - **Instance Type**: `Free`
5. Under **Environment** (or **Advanced > Environment Variables**), add:
   - `SECRET_KEY` - a real random secret (not the placeholder default)
   - `DATABASE_URL` - the same Turso URL used in `backend/.env` (see
     [Database (Turso)](#database-turso)), so this deployment shares data with
     local dev
   - `CORS_ORIGINS` - `http://localhost:5173,http://127.0.0.1:5173` (leave as-is;
     the deployed frontend origin goes in `FRONTEND_URL` below)
   - `FRONTEND_URL` - leave blank for now; you'll set this after step 2 below once
     the Vercel URL exists
   - Do **not** set `PORT` - Render injects it automatically and
     `backend/Dockerfile`'s `CMD` and `app/main.py` both already read it
6. Click **Create Web Service**. Render builds the Dockerfile and gives you a URL
   like `https://smartreceipt-backend.onrender.com` - copy it, you'll need it for
   the frontend. Check `https://<that-url>/api/health` returns `{"status": "ok"}`.

### 2. Frontend on Vercel

1. In the [Vercel dashboard](https://vercel.com/dashboard), click **Add New >
   Project**.
2. **Import Git Repository**: authorize Vercel's GitHub app if needed, then select
   this repo.
3. Configure the project:
   - **Framework Preset**: Vite (Vercel should auto-detect this)
   - **Root Directory**: `frontend` (click **Edit** next to Root Directory to set it)
4. Under **Environment Variables**, add:
   - `VITE_API_BASE_URL` = `https://<your-render-backend>.onrender.com/api` (the
     URL from step 1.6, with `/api` appended)
5. Click **Deploy**. Vercel builds with `pnpm build` and serves `frontend/dist`;
   `frontend/vercel.json` (already in the repo) rewrites every route to
   `index.html` so refreshing a client-side route (e.g. `/dashboard`) doesn't 404.
6. Copy the resulting URL (e.g. `https://smartreceipt.vercel.app`).

### 3. Close the loop: allow the frontend's origin in CORS

Go back to the Render service (**Environment** tab), set `FRONTEND_URL` to the
Vercel URL from step 2.6, and save - Render redeploys automatically. Without this,
the browser blocks every API call from the deployed frontend with a CORS error even
though the backend itself is reachable.

Both platforms redeploy automatically on every push to `main` once connected - no
further setup needed for continuous deployment.
