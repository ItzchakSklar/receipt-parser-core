# SmartReceipt

A multi-tenant SaaS application for small businesses to upload, OCR-parse, and analyze
their expense receipts.

**Live app (production):** <https://receipt-parser-core.vercel.app/>

The production frontend is deployed on Vercel and talks to the backend on Render,
both backed by the shared Turso database (see
[Deploying to Render + Vercel](#deploying-to-render--vercel-free-tier)).

## Project Structure

```text
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
|   |   |   |-- invoices.py         Upload, unrecognized sort, duplicate resolution, list,
|   |   |   |                       file, update (PUT/PATCH), delete
|   |   |   |-- categories.py       List expense categories
|   |   |   |-- dashboard.py        GET /api/dashboard/stats
|   |   |   |-- system.py           GET /api/system/time (WorldTimeAPI proxy)
|   |   |-- services/
|   |       |-- ocr_service.py             PyMuPDF/Pillow -> Tesseract/EasyOCR, zero-hallucination
|   |       |-- external_time_service.py   WorldTimeAPI client
|   |-- tests/                      pytest suite (health, auth, invoices, OCR parsing)
|   |-- seed.py                     Seeds 2 demo businesses with sample data
|   |-- Dockerfile                  Backend image (Tesseract + Hebrew), used by Render/GHCR
|   |-- requirements.txt / requirements-dev.txt
|   |-- .env.example
|
|-- frontend/                   React + TypeScript + Vite + Tailwind CSS v4
|   |-- src/
|   |   |-- App.tsx                  Tab layout (Dashboard / Upload / Invoices)
|   |   |-- context/AuthContext.tsx
|   |   |-- api/client.ts            Axios instance with JWT interceptor (VITE_API_BASE_URL)
|   |   |-- types/index.ts
|   |   |-- utils/currency.ts        Shared amount formatting
|   |   |-- components/
|   |       |-- Header.tsx                  Nav + live clock + user menu
|   |       |-- LiveClock.tsx               Live external-time widget
|   |       |-- LoginForm.tsx               Sign in / register a business
|   |       |-- UploadZone.tsx              Drag & drop receipt upload (+ "unrecognized" banner)
|   |       |-- Toast.tsx                   Transient notifications
|   |       |-- InvoiceExplorer.tsx         Folder-style receipt browser (Year/Month folders)
|   |       |-- MonthFolderCard.tsx         One month's folder
|   |       |-- ReceiptFileCard.tsx         One receipt in a folder
|   |       |-- ReceiptThumbnail.tsx        Receipt image/PDF thumbnail
|   |       |-- ReceiptLightboxModal.tsx    Full-size receipt viewer
|   |       |-- UnrecognizedFolderCard.tsx  Persistent "לא מזוהים" (Unrecognized) folder
|   |       |-- UnrecognizedFileCard.tsx    One unrecognized receipt
|   |       |-- UnrecognizedReviewModal.tsx Preview + form to sort an unrecognized receipt
|   |       |-- ConflictResolutionModal.tsx Resolve an upload that duplicates an existing invoice
|   |       |-- ContextMenu.tsx             Right-click menu on receipt cards (edit/delete/download)
|   |       |-- EditInvoiceModal.tsx        Edit vendor/amount/date/category for one invoice
|   |       |-- ConfirmDialog.tsx           Generic confirmation dialog (used for delete)
|   |       |-- SendToAccountantModal.tsx   Monthly report share/download
|   |       |-- Modal.tsx                   Shared modal shell
|   |       |-- Dashboard.tsx               Stat cards + pie/bar charts (recharts)
|   |-- Dockerfile + nginx.conf      Frontend image for docker-compose (nginx proxies /api)
|   |-- vercel.json                  SPA rewrites for the Vercel deployment
|
|-- docker-compose.yml          Full stack (backend + nginx frontend) from GHCR images
|-- .github/workflows/deploy.yml  CI (lint/test/typecheck) + GHCR build + SSH deploy
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

### First-time setup (once per checkout)

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

This copies `backend/.env.example`, not the repo-root `.env.example` (that one is only
for `docker-compose.yml`). Never run the copy again once `backend/.env` exists - it
overwrites your real `DATABASE_URL` with the `<db>-<org>` placeholder.

Put your Turso database URL in `backend/.env`'s `DATABASE_URL` (see [Database
(Turso)](#database-turso)). This is also what any deployment (Docker Compose, Render,
...) points at, so local dev and production share one database.

Optionally, seed two demo businesses with sample invoices (once - the data lives in
Turso, so there's no need to re-seed):

```bash
python seed.py
```

### Every time

```bash
cd backend
.venv\Scripts\activate      # macOS/Linux: source .venv/bin/activate
uvicorn app.main:app --reload --port 8000
```

Re-run `pip install -r requirements.txt` only after `requirements.txt` changes.

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

   ```text
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
it never invents data.

Every upload is first rasterized to per-page images - PDFs via **PyMuPDF**
(`pymupdf`), photos (JPEG/PNG/WEBP) via **Pillow** - so PDFs and photographed
receipts go through exactly the same recognition engines and confidence threshold.
The engines are tried in order:

1. **Tesseract** (`pytesseract`) - accepted only when average OCR confidence is
   >= 60% and all required fields were found
2. **EasyOCR**, if installed - same confidence/field requirements

Every attempt (file open, raw OCR text per page, confidence per Tesseract page-mode,
which required field was missing) is printed to the backend console with an
`[ocr_service]` prefix, which is the quickest way to see why a given receipt wasn't
recognized.

If no engine is installed, the file can't be read reliably, or confidence is too low,
`POST /api/invoices/upload` still saves the receipt (file included) but flags it
`is_unrecognized` - it shows up in the "לא מזוהים" (Unrecognized) folder in the file
explorer instead of the normal Year/Month folders and dashboard totals. The user
fills in the real vendor/amount/date there (`POST /api/invoices/unrecognized/{id}/sort`).
A saved invoice's vendor/amount/date/category can still be corrected afterwards via
the file explorer's right-click "Edit Details" action (`PUT /api/invoices/{id}`).

### OCR setup

`pytesseract`, `Pillow` and `pymupdf` are installed by `requirements.txt`; EasyOCR is
commented out there (it's large) - uncomment and `pip install` it to enable it. The
Tesseract **binary** itself must also be installed and on your `PATH`.

For Hebrew + English recognition (`heb+eng`), place `heb.traineddata` and
`eng.traineddata` (from [tessdata](https://github.com/tesseract-ocr/tessdata)) in
`%LOCALAPPDATA%\SmartReceipt\tessdata`. Without that directory Tesseract falls back
to English only. It deliberately lives outside the repo: Tesseract's Windows binary
can't handle non-ASCII characters in `--tessdata-dir`, and its own install directory
isn't writable without admin rights. The backend Docker image installs
`tesseract-ocr` + `tesseract-ocr-heb` and copies the language files into that same
layout automatically.

## Receipt File Storage & Viewing

Uploaded files are stored inside the `invoices` row itself (`file_content`, with
`file_name`/`file_content_type` alongside), not on disk. The only way to read a
receipt is `GET /api/invoices/{id}/file`, which is JWT-scoped to the caller's
business - so one tenant can never fetch another tenant's receipt. The frontend
fetches this endpoint as a blob and renders it as an `<img>` (JPEG/PNG/WEBP) or
`<iframe>` (PDF). Right-click a receipt card in the file explorer for "Download
Original File", which fetches the same endpoint and saves it locally.
`DELETE /api/invoices/{id}` removes the row, file included.

An upload that collides with an existing invoice (409 `DUPLICATE_CONFLICT` - matched
by tax id / invoice number / vendor+amount+date) isn't saved until the user resolves
the conflict in the conflict dialog (`POST /api/invoices/resolve-conflict`; the held
file is previewable via `GET /api/invoices/file-preview`). Meanwhile it's held in the
backend's memory for up to an hour, so it's lost if the backend restarts before the
user decides.

## Tests & Code Quality

```bash
cd backend
pip install -r requirements-dev.txt
pytest                                   # backend/tests/
ruff check . && ruff format --check .    # same lint/format gate as CI
```

The tests never touch Turso: `tests/conftest.py` points the app at a throwaway local
SQLite file before the app is imported.

The frontend has no test runner; CI typechecks it with `tsc -b` (part of
`pnpm build`). A git pre-commit hook (`frontend/.husky/pre-commit`, enabled by
`pnpm install` via the `prepare` script) runs Prettier on staged frontend files and
`ruff format` + `ruff check --fix` on staged Python files.

## Monthly Accountant Export

The **Send to Accountant** (שלח לרואה חשבון) button builds the month's report in the
browser - a CSV summary plus the original receipt files - and opens the device's share
sheet (WhatsApp, email, etc.), or downloads it as a zip where sharing isn't supported.
No email service or server configuration is needed; see
`frontend/src/utils/accountantReport.ts`.

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
  [Database (Turso)](#database-turso)), and `CORS_ORIGINS`) - `docker-compose.yml` reads it for variable substitution, and
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
6. Copy the resulting URL. The production deployment of this repo lives at
   <https://receipt-parser-core.vercel.app/>.

### 3. Close the loop: allow the frontend's origin in CORS

Go back to the Render service (**Environment** tab), set `FRONTEND_URL` to the
Vercel URL from step 2.6, and save - Render redeploys automatically. Without this,
the browser blocks every API call from the deployed frontend with a CORS error even
though the backend itself is reachable.

Both platforms redeploy automatically on every push to `main` once connected - no
further setup needed for continuous deployment.
