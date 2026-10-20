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
- A free [Neon](https://neon.tech) Postgres database (see
  [Switching to Postgres (Neon)](#switching-to-postgres-neon)) - `backend/.env`'s
  `DATABASE_URL` defaults to one, and there's no local install for it (just a
  connection string). Local dev and any deployment share the same database.
- **Optional** - Docker Desktop (running) + [Microsoft ODBC Driver 18 for SQL
  Server](https://learn.microsoft.com/sql/connect/odbc/download-odbc-driver-for-sql-server)
  (`pyodbc`, in `requirements.txt`, only speaks ODBC - it doesn't install the driver
  itself; on Windows: `winget install Microsoft.msodbcsql.18`) - only needed if you
  want SQL Server instead of Postgres (see [Switching to SQL
  Server](#switching-to-sql-server)); if nothing is listening on `localhost:1433` in
  that case, the backend **auto-falls-back to a local SQLite file** instead of
  crashing.

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

`backend/.env`'s `DATABASE_URL` defaults to a hosted Postgres database on
[Neon](https://neon.tech) - copy the connection string from your Neon project
dashboard in place of the placeholder (see [Switching to Postgres
(Neon)](#switching-to-postgres-neon)). This is also what any deployment
(Docker Compose, Render, ...) should point at, so local dev and production share one
database instead of drifting apart. Pick a different backend if you want:

- **SQL Server** (self-hosted, e.g. via Docker Compose): see [Switching to SQL
  Server](#switching-to-sql-server).
- **SQLite** (zero-config, local-only, not shared with anything else): in
  `backend/.env`, comment out the `postgresql+psycopg://...` line and uncomment
  `DATABASE_URL=sqlite:///./smartreceipt.db` instead.

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

## Switching to Postgres (Neon)

The backend defaults to a hosted Postgres database on [Neon](https://neon.tech)
(`backend/.env`'s `DATABASE_URL`) - a serverless free tier that needs no local
install and no firewall/IP allowlisting (unlike Azure SQL), and is reachable from
both a developer's machine and any deployment. SQL Server and SQLite remain
available as alternatives (see the commented-out lines in `backend/.env.example`).

### Setup

1. Create a free project at [console.neon.tech](https://console.neon.tech) (any
   region). Name the database `smartreceipt` if you're asked, or use whatever Neon
   creates by default (e.g. `neondb`) - the name itself doesn't matter as long as
   it's consistent everywhere below.
2. Open the project's **Connection string** in the dashboard and copy the
   `postgresql://user:password@host/dbname?sslmode=require&channel_binding=require`
   URL it gives you.
3. Rewrite it to use SQLAlchemy's driver prefix and set it as `backend/.env`'s
   `DATABASE_URL`:
   ```
   DATABASE_URL=postgresql+psycopg://<user>:<password>@<endpoint>.neon.tech/<dbname>?sslmode=require&channel_binding=require
   ```
   (`postgresql://` -> `postgresql+psycopg://`; everything else - including
   `sslmode=require`/`channel_binding=require` - stays as Neon gave it.)
4. `psycopg[binary]` (in `requirements.txt`) is the driver that talks to it - a plain
   `pip install -r requirements.txt` covers it, nothing extra to install locally.
5. Run the backend as usual (`uvicorn app.main:app --reload`). `Base.metadata.create_all`
   + `ensure_schema()` ([database.py](backend/app/database.py)) create/update tables
   the same way they do for SQLite/SQL Server; Neon creates the database itself when
   you create the project, so there's no separate `ensure_database_exists()` step to
   run (that function is a no-op for Postgres).

### One database for local dev and deployment

Use the **same** `DATABASE_URL` in `backend/.env` (local dev), the root `.env`
(Docker Compose - see `.env.example`), and your deployment platform's environment
variables (e.g. Render's **Environment** tab) so everyone reads/writes the same
data instead of each environment getting its own empty database. `docker-compose.yml`'s
`backend` service reads `DATABASE_URL` straight from the root `.env` - no local
database container is started for it.

Tests are unaffected: `backend/tests/conftest.py` always points `DATABASE_URL` at a
throwaway SQLite file, regardless of what `backend/.env`/`.env` say.

## Switching to SQL Server

SQL Server is an alternative backend (self-hosted, e.g. via a `sqlserver` service in
Docker Compose) if you'd rather not depend on Neon. SQLite is also available as a
zero-config fallback (see the commented-out lines in `backend/.env.example`).

### Auto-fallback when SQL Server isn't running locally

[database.py](backend/app/database.py)'s `_build_engine()` only ever auto-falls-back
when `DATABASE_URL`'s host is `localhost`/`127.0.0.1`/`::1` **and** nothing answers
there at startup - the exact situation a fresh clone is in before anyone has run
`docker compose up -d sqlserver`. In that case it prints a `[database] Could not
reach SQL Server at localhost:1433 ...` line to the console and switches to
`sqlite:///./smartreceipt.db` for that run, instead of crashing. It does **not**
kick in for the Docker Compose stack (whose `backend` service talks to the
`sqlserver` service by its container name, not `localhost`) or a real deployed DB -
an outage there still fails loudly on startup, on purpose, so it's never mistaken
for "everything's fine" with an empty throwaway database in production.

If you see that console line and expected real SQL Server, your data for that run
is in a plain SQLite file, not the SQL Server instance you configured - fix
whatever's stopping the connection (see the troubleshooting table below) and
restart `uvicorn`; nothing carries over automatically between the two.

### Local dev

1. Start a SQL Server container yourself, e.g.:
   ```bash
   docker run -e ACCEPT_EULA=Y -e MSSQL_SA_PASSWORD=<pick-a-password> \
     -p 1433:1433 --name sqlserver -d mcr.microsoft.com/mssql/server:2022-latest
   ```
   (`docker-compose.yml` no longer includes a `sqlserver` service - it moved to
   Neon, see [Switching to Postgres (Neon)](#switching-to-postgres-neon) - so this
   is a standalone container, not `docker compose up sqlserver`.)
2. Install the [Microsoft ODBC Driver 18 for SQL Server](https://learn.microsoft.com/sql/connect/odbc/download-odbc-driver-for-sql-server)
   for your OS - `pyodbc` (in `requirements.txt`) talks to SQL Server through it,
   and it isn't installed by `pip install`.
3. Point `backend/.env`'s `DATABASE_URL` at it (already the default):
   ```
   DATABASE_URL=mssql+pyodbc://sa:<MSSQL_SA_PASSWORD>@localhost:1433/SmartReceipt?driver=ODBC+Driver+18+for+SQL+Server&TrustServerCertificate=yes
   ```
4. Run the backend as usual (`uvicorn app.main:app --reload`). `ensure_database_exists()`
   ([database.py](backend/app/database.py)) creates the `SmartReceipt` database
   itself on first connect - no manual `CREATE DATABASE` needed - and
   `Base.metadata.create_all` + `ensure_schema()` create/update its tables the
   same way they do for SQLite.

### Docker Compose stack / self-hosted deploy

`docker-compose.yml`'s `backend` service reads `DATABASE_URL` straight from the
root `.env` - there's no bundled database container to start. To use SQL Server
here instead of Neon, run your own SQL Server instance (reachable from the
`backend` container - e.g. a container on the same Docker network, or a separate
host) and set `.env`'s `DATABASE_URL` to an `mssql+pyodbc://...` URL pointing at
it, the same way as in [Local dev](#local-dev) above.

Tests are unaffected either way: `backend/tests/conftest.py` always points
`DATABASE_URL` at a throwaway SQLite file, regardless of what `backend/.env`/`.env`
say.

### Troubleshooting: backend silently using SQLite / won't start

On `localhost`, the errors below no longer stop `uvicorn` from starting (see
[Auto-fallback](#auto-fallback-when-sql-server-isnt-running-locally)) - they instead
print as a `[database] Could not reach SQL Server ...` console line and the backend
runs on SQLite until you fix the cause and restart. Inside the Docker Compose stack
(host `sqlserver`, not `localhost`) or against a real deployed DB, these still crash
`uvicorn` on startup as before.

| Symptom | Cause | Fix |
| --- | --- | --- |
| `[database] Could not reach SQL Server ...` on the console, or (inside Docker Compose / production) `pyodbc.InterfaceError: ('IM002', ... Data source name not found and no default driver specified ...)` | The Microsoft ODBC Driver 18 for SQL Server isn't installed on the machine running `uvicorn` (the Python package `pyodbc` only speaks ODBC - it doesn't ship the driver itself). Run `pyodbc.drivers()` in a Python shell to see what's actually installed. | Install it: `winget install Microsoft.msodbcsql.18` (Windows), or see the [download page](https://learn.microsoft.com/sql/connect/odbc/download-odbc-driver-for-sql-server) for macOS/Linux. |
| Same, with `OperationalError` / `('08001', ...)` mentioning "TCP Provider" or connection refused | Nothing is listening on `localhost:1433` - either Docker Desktop itself isn't running, or the SQL Server container is down. `docker ps` erroring with something like "cannot find the file specified" / "pipe not found" means Docker Desktop is not running. | Start Docker Desktop, then start your SQL Server container (see [Local dev](#local-dev)), then restart `uvicorn`. |
| Same `('08001', ...)` error, but the host/server name in the message looks mangled (e.g. it has your password's second half stuck to the front of `localhost`) | The SA password contains a URL-reserved character (`@ : / ? #`). `DATABASE_URL` embeds it directly (`mssql+pyodbc://sa:<password>@host:port/...`), and SQLAlchemy's URL parser splits on the *first* `@`/`:`/etc it finds - a password like `Ch@ngeThisPassw0rd` gets cut into password `Ch` and host `ngeThisPassw0rd@localhost`. | Pick a password without those characters (e.g. `ChangeThisPassw0rd!` - the `!` is safe), and make sure it matches whatever you started the container with. If you must keep a reserved character, percent-encode it in the URL only (`@` -> `%40`). |
| Login/auth error connecting to SQL Server | `sa` password in `backend/.env`'s `DATABASE_URL` doesn't match the password the SQL Server container was actually started with. | Make sure `DATABASE_URL` uses the same password you passed as `MSSQL_SA_PASSWORD` when starting the container, then recreate it (`docker rm -f sqlserver` + the `docker run` command in [Local dev](#local-dev)) if it was already initialized with a different one. |

Quick end-to-end local dev startup if you want real SQL Server, in order: **Docker
Desktop running** -> start the SQL Server container (see [Local dev](#local-dev)) ->
ODBC Driver 18 installed -> `uvicorn app.main:app --reload`. If you skip any of
these, the backend still starts and runs fine on the SQLite fallback instead.

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

## Deploying to Render + Vercel (Free Tier)

Unlike the GitHub Actions/GHCR/self-hosted-server path above, this deploys the
backend to **Render** and the frontend to **Vercel** directly from GitHub - both
have a free tier and neither needs the `.github/workflows/deploy.yml` pipeline
(each platform builds on its own when you push to `main`).

> **Storage caveat:** Render's free web services use an ephemeral filesystem - the
> database (if left on the SQLite default) and everything under `uploads/` are wiped
> on every deploy, and on every restart after 15 minutes of inactivity (free
> services sleep and cold-start on the next request). Setting `DATABASE_URL` to the
> Neon connection string (below) solves the database half of this - Neon is external
> to Render, so that data survives deploys/restarts. `uploads/` is still on Render's
> local disk and still gets wiped; for anything real, either upgrade to a Render paid
> plan with a [persistent disk](https://render.com/docs/disks) mounted at `/app` (or
> wherever `UPLOAD_DIR` points), or move file storage to an external object store
> (S3-compatible).

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
   - `DATABASE_URL` - the same Neon connection string used in `backend/.env` (see
     [Switching to Postgres (Neon)](#switching-to-postgres-neon)), so this
     deployment shares data with local dev instead of getting an empty ephemeral
     SQLite file (see the storage caveat above)
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
