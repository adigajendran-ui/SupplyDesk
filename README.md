# SupplyDesk

SupplyDesk is a full-stack inventory and purchasing management application built with React, TypeScript, Express, and PostgreSQL. It provides inventory visibility, stock movement history, supplier management, and a purchase-order workflow with partial receiving.

> **Project status:** Portfolio project in active development. Authentication and server-side authorization are not implemented yet. Do not expose this application to the public internet or use it for real business data until those controls and a production deployment configuration have been added and tested.

## Features

- **Inventory:** Create and search products, filter by stock status or category, paginate results, and update product details.
- **Stock control:** Adjust inventory through a validated endpoint and record stock movements in a transactional ledger. Negative inventory is rejected.
- **Dashboard and reports:** View inventory metrics, low-stock attention items, recent activity, and weekly activity.
- **Supplier management:** Create and search suppliers, update their details, and activate or deactivate them.
- **Purchasing:** Create draft purchase orders, place and cancel orders, receive items in multiple batches, and review receipt history. Over-receiving is rejected and accepted receipts update inventory in a transaction.
- **Database migrations:** Versioned SQL migrations create the core inventory and purchasing schema.
- **Automated checks:** Vitest and Supertest integration tests exercise the API against an isolated PostgreSQL test database. GitHub Actions runs frontend and backend checks on pushes and pull requests.

## Technology stack

- **Frontend:** React, TypeScript, Vite, and Lucide icons
- **Backend:** Node.js, TypeScript, Express, Zod, Helmet, and `pg`
- **Database:** PostgreSQL 17
- **Local infrastructure:** Docker Compose
- **Testing:** Vitest and Supertest
- **CI:** GitHub Actions

## Project structure

```text
SupplyDesk/
├── .github/workflows/ci.yml     # Frontend and backend CI jobs
├── backend/
│   ├── src/config/              # Environment validation
│   ├── src/db/                  # PostgreSQL pool and migrations
│   ├── src/routes/              # REST API routes
│   └── tests/                   # API integration tests
├── frontend/
│   └── src/                     # React application and API client
├── .env.example                 # Local environment template
├── compose.yaml                 # Local PostgreSQL service
└── README.md
```

## Prerequisites

Install the following before starting:

- Git
- Node.js 24.x and npm
- Docker Desktop with the Docker Compose plugin

The commands below use Windows PowerShell. The app's local defaults are API `http://127.0.0.1:3001` and frontend `http://localhost:5173`.

## Local setup (Windows PowerShell)

### 1. Get the code

Clone your repository after publishing it to GitHub, or open the existing project folder:

```powershell
git clone <YOUR_GITHUB_REPOSITORY_URL>
Set-Location SupplyDesk
```

Replace `<YOUR_GITHUB_REPOSITORY_URL>` with your repository's actual URL. If you already have the folder, `Set-Location` to that folder instead.

### 2. Create your local environment file

From the project root:

```powershell
Copy-Item .env.example .env
notepad .env
```

Set `POSTGRES_PASSWORD` to a strong **local development-only** password. Set the password in `DATABASE_URL` to the same value. For easier URI handling, an alphanumeric password avoids needing to URL-encode reserved characters. Keep `.env` private; it is intentionally excluded from Git.

The example file includes:

- `POSTGRES_DB`, `POSTGRES_USER`, and `POSTGRES_PASSWORD` for the local PostgreSQL container
- `DATABASE_URL` for the backend connection
- `PORT`, `NODE_ENV`, and `FRONTEND_ORIGIN` for the API

If you change the database name or username, make the corresponding values in `DATABASE_URL` consistent.

### 3. Start PostgreSQL

From the project root:

```powershell
docker compose up -d --wait
docker compose ps
```

The database is published only on `127.0.0.1:5432`. Its persistent Docker volume is named `supplydesk_pg_data`. Do not run `docker compose down -v` unless you intentionally want to delete the local database volume and all data stored in it.

### 4. Install backend dependencies and apply migrations

```powershell
Set-Location .\backend
npm ci
npm run db:migrate
```

The migrations are stored under `backend/src/db/migrations`. The migration command uses `DATABASE_URL` from the root `.env` unless you override that environment variable in the current terminal.

### 5. Start the API

In the backend terminal:

```powershell
npm run dev
```

Keep this terminal running. Useful endpoints:

- `GET http://127.0.0.1:3001/api/health` — liveness check
- `GET http://127.0.0.1:3001/api/health/ready` — PostgreSQL readiness check

### 6. Start the frontend

Open a second PowerShell terminal, change to your project root, and then enter the frontend folder. For example, if your project is on the Desktop:

```powershell
Set-Location "$HOME\OneDrive\Desktop\SupplyDesk\frontend"
npm ci
npm run dev
```

Adjust the path if you cloned the repository somewhere else. Open <http://localhost:5173> in your browser. By default, the frontend API client targets `http://127.0.0.1:3001/api`.

## Useful commands

Run commands in the appropriate directory.

### Frontend (`frontend/`)

```powershell
npm run dev
npm run lint
npm run build
```

### Backend (`backend/`)

```powershell
npm run dev
npm test
npm run typecheck
npm run build
npm run db:migrate
```

## Running automated integration tests

The integration suite must use the separate `supplydesk_test` database. The test file checks and rewrites the database URL to that database before importing the app and database pool; it will stop if it cannot verify the expected database name. Never point tests at a database containing data you need to keep.

Keep Docker Desktop and the PostgreSQL container running. Run the following from the **project root** if you have not created the test database yet:

```powershell
$dbUser = (docker exec supplydesk-postgres printenv POSTGRES_USER | Select-Object -First 1).Trim()
if ([string]::IsNullOrWhiteSpace($dbUser)) {
    throw "Could not read the PostgreSQL user from the running container."
}

$existsOutput = docker exec supplydesk-postgres psql -U $dbUser -d postgres -tA -c "SELECT 1 FROM pg_database WHERE datname = 'supplydesk_test';"
if ($LASTEXITCODE -ne 0) {
    throw "Could not check whether supplydesk_test exists."
}

if ((@($existsOutput) -join "").Trim() -ne "1") {
    docker exec supplydesk-postgres psql -U $dbUser -d postgres -c "CREATE DATABASE supplydesk_test;"
    if ($LASTEXITCODE -ne 0) {
        throw "Could not create supplydesk_test."
    }
}
```

Apply migrations to `supplydesk_test` (not the development database). Run this in the **project root**:

```powershell
$databaseLine = Get-Content .\.env |
    Where-Object { $_ -match '^DATABASE_URL=' } |
    Select-Object -First 1

if (-not $databaseLine) {
    throw "DATABASE_URL was not found in the root .env file."
}

$databaseUrl = $databaseLine.Substring("DATABASE_URL=".Length).Trim().Trim('"').Trim("'")
$testDatabaseUrl = $databaseUrl -replace '/supplydesk(?:_test)?(\?.*)?$', '/supplydesk_test$1'

if ($testDatabaseUrl -eq $databaseUrl -or $testDatabaseUrl -notmatch '/supplydesk_test(?:\?.*)?$') {
    throw "Could not safely identify the test database URL. No migration was run."
}

$previousDatabaseUrl = $env:DATABASE_URL
try {
    $env:DATABASE_URL = $testDatabaseUrl
    Set-Location .\backend
    npm run db:migrate
    if ($LASTEXITCODE -ne 0) {
        throw "Migration of supplydesk_test failed."
    }
} finally {
    if ($null -eq $previousDatabaseUrl) {
        Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
    } else {
        $env:DATABASE_URL = $previousDatabaseUrl
    }
}
```

Then run the tests from `backend/`:

```powershell
npm ci
npm test
npm run typecheck
npm run build
```

The integration tests create uniquely named records and currently do not clean those records up after a run. They do not truncate tables or delete existing data. Repeated test runs may add more records to `supplydesk_test`.

## API overview

The API is rooted at `/api`.

| Area | Route examples | Purpose |
|---|---|---|
| Health | `GET /health`, `GET /health/ready` | Liveness and database readiness |
| Dashboard | `GET /dashboard/summary` | Inventory metrics and recent activity |
| Products | `GET /products`, `POST /products`, `GET /products/:id`, `PATCH /products/:id` | Product listing and maintenance |
| Stock | `POST /products/:id/adjustments`, `GET /products/:id/movements` | Validated stock changes and movement history |
| Suppliers | `GET /suppliers`, `POST /suppliers`, `GET /suppliers/:id`, `PATCH /suppliers/:id` | Supplier records and activation state |
| Purchasing | `GET /purchase-orders`, `POST /purchase-orders`, `GET /purchase-orders/:id` | Purchase-order creation and lookup |
| Order workflow | `POST /purchase-orders/:id/place`, `POST /purchase-orders/:id/cancel`, `POST /purchase-orders/:id/receipts` | Place/cancel orders and receive stock |
| Receipt history | `GET /purchase-orders/:id/receipts` | Receipt history for an order |

Request validation and database constraints enforce important business rules such as unique SKUs, non-negative inventory, and receipt quantities that do not exceed the outstanding order quantity.

## CI (GitHub Actions)

`.github/workflows/ci.yml` defines two jobs for pushes and pull requests:

- **Frontend checks:** `npm ci`, lint, and production build.
- **Backend tests:** starts a temporary PostgreSQL 17 service, applies migrations, runs integration tests, type-checks, and builds the backend.

The CI workflow uses a disposable PostgreSQL database and does not need your local `.env` file. Verify the workflow's result in the **Actions** tab after pushing the repository to GitHub.

## Current limitations and next steps

SupplyDesk is not production-ready yet. Before deploying it publicly or using it with sensitive or real business data, the project needs at least:

- Authentication and server-side authorization/role checks
- Security and dependency review, including authorization and input-validation tests
- A production deployment configuration with managed secrets, TLS, backups, and operational monitoring
- Broader test coverage for supplier and purchase-order edge cases, concurrency, and error paths
- A dedicated, paginated inventory-wide stock movement endpoint to avoid fetching movement history separately for each product

## License

No license has been added yet. Unless a license is added to the repository, do not assume others have permission to reuse or redistribute this code.
