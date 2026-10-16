# FixMyCampus

A complete single-campus service desk for Students, Faculty, Staff, Campus Incharge, Department Officers, and Administrators. Report an issue, route it to a department, follow its audited timeline, and record resolution and feedback. Critical categories route immediately; Mental Health and Anti-Ragging support authenticated anonymous reporting.

The npm-workspaces project uses TypeScript, React, Vite, Express, MySQL 8.4, React Router, TanStack Query, Zod, and private local/Cloudinary storage. Node.js **24 LTS** is required. Dependencies are locked in `package-lock.json`.

## Quick start with Docker

Install Docker Desktop with Compose, then run in PowerShell from this directory:

```powershell
Copy-Item .env.example .env
# Edit .env and set MYSQL_ROOT_PASSWORD and JWT_SECRET.
docker compose up --build -d
docker compose exec app node dist/apps/api/src/seed.js
```

Open [FixMyCampus](http://localhost:3001) and [captured email in Mailpit](http://localhost:8025). The API and SPA share port 3001. The database starts empty; migrations run automatically, and seeding is an explicit local-only command. Named volumes preserve MySQL data and private uploads across restarts. `docker compose down` stops services; adding `-v` deletes data and is not part of normal shutdown.

## Native development on Windows

Install Node.js 24 and MySQL 8.4. Either use Docker just for dependencies (`docker compose up -d mysql mailpit`) or create the database in MySQL as an administrative user:

```sql
CREATE DATABASE fixmycampus CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER 'campus'@'localhost' IDENTIFIED BY 'campus';
GRANT ALL PRIVILEGES ON fixmycampus.* TO 'campus'@'localhost';
```

The credentials above are only for local development. Make the `DATABASE_URL` host match the MySQL account host. A MySQL installation configured differently may use `127.0.0.1` rather than `localhost`.

```powershell
Copy-Item .env.example .env
npm ci
npm run db:migrate
npm run db:seed
npm run dev
```

Open [the development app](http://localhost:5173). Vite proxies `/api` to port 3001; avoid opening the development API as the browser app because `APP_URL` points at port 5173. If using a different database or SMTP server, update `.env` first. SMTP defaults to local Mailpit on port 1025. With no relay running, application changes still succeed and the outbox retries mail.

To serve the compiled SPA without Vite:

```powershell
npm run build
$env:APP_URL='http://localhost:3001'
npm start
```

Local HTTP is for loopback development. Production requires HTTPS, a random signing secret, private database credentials, and real SMTP; see [operations](docs/operations.md).

## Demo accounts

All seeded accounts use **`CampusDemo!2026`**. They are already verified. Seed is idempotent and does not reset passwords or overwrite edited configuration.

| Email                   | Role / department                           |
| ----------------------- | ------------------------------------------- |
| `student@campus.test`   | Student                                     |
| `faculty@campus.test`   | Faculty                                     |
| `staff@campus.test`     | Staff                                       |
| `incharge@campus.test`  | Campus Incharge                             |
| `admin@campus.test`     | Administrator                               |
| `officer1@campus.test`  | Civil Engineering                           |
| `officer2@campus.test`  | Administration                              |
| `officer3@campus.test`  | Estate Maintenance                          |
| `officer4@campus.test`  | Information Technology                      |
| `officer5@campus.test`  | Computer Engineering                        |
| `officer6@campus.test`  | Electronics & Telecommunication Engineering |
| `officer7@campus.test`  | Library and Learning Resource Development   |
| `officer8@campus.test`  | Medical Services                            |
| `officer9@campus.test`  | Students Development and Welfare            |
| `officer10@campus.test` | Anti-Ragging Committee                      |
| `officer11@campus.test` | Security Services                           |

Demo complaints cover submitted, assigned, in-progress, resolved/rated, returned, confidential, and emergency cases. New registrations become Student accounts; an Administrator grants Faculty, Staff, or operational roles after checking institutional affiliation. Officers always belong to one department.

## Verification

```powershell
npm run typecheck
npm run build
npm test
npm run test:coverage
```

Unit tests require no database. The coverage command enforces at least 70% statements, branches, functions, and lines for the configured service modules. Read the measured report under `coverage/`; a test file's existence does not mean a requirement has passed.

Integration tests use real MySQL and a **separate disposable database**. They never drop or truncate a database, but do create accounts, complaints, history, and test configuration. Create `fixmycampus_test`, grant the test account access, then:

```powershell
$env:TEST_DATABASE_URL='mysql://campus:campus@127.0.0.1:3306/fixmycampus_test'
npm run test:integration
```

The suite refuses database names without `test`; without `TEST_DATABASE_URL`, integration scenarios are explicitly skipped. To run browser tests, start and seed the development app, then in another terminal:

```powershell
npx playwright install chromium
$env:E2E_BASE_URL='http://localhost:5173'
$env:E2E_MAILPIT_URL='http://localhost:8025'
npm run test:e2e
```

If Chrome is already installed, set `$env:PLAYWRIGHT_CHANNEL='chrome'` to use it instead of downloading Chromium.

For the Docker SPA use `E2E_BASE_URL=http://localhost:3001`. Browser tests cover real reporting/triage/resolution/reopening/feedback, critical anonymous routing, the dedicated urgent path, mobile keyboard use, administration, and CSV/PDF downloads. Captured-email registration/verification is skipped unless `E2E_MAILPIT_URL` is provided. Browser tests create records in the configured running app; use a disposable evaluation deployment. See [verification and traceability](docs/requirements.md) for the 68-requirement checklist and [operations](docs/operations.md) for guarded scale-data generation and the 500-worker read probe.

## Project guide

| Directory             | Purpose                                                              |
| --------------------- | -------------------------------------------------------------------- |
| `apps/web`            | Responsive role-based React client and ordinary CSS design tokens    |
| `apps/api/src`        | Versioned routes, authentication, services, MySQL queries, jobs      |
| `apps/api/migrations` | Numbered SQL migrations and integrity/audit triggers                 |
| `packages/shared`     | Public types, validation, roles/statuses, initial category routing   |
| `tests`               | Real-MySQL integration and Playwright browser scenarios              |
| `scripts`, `deploy`   | Capacity probe, synthetic data, backup/restore, HTTPS proxy          |
| `docs`                | API, diagrams, demo, decisions, operations, requirement traceability |

Read [the demo walkthrough](docs/demo.md), [API contract](docs/api.md), [architecture and six diagrams](docs/architecture.md), [SRS amendments](docs/decisions.md), [measured verification results](docs/verification.md), and [deployment/backup guide](docs/operations.md).

This release excludes multi-campus tenancy, native mobile apps, SMS, WebSockets/SSE, and multilingual UI. Production capacity, uptime, first-time-user timing, SMTP/Cloudinary credentials, and restore-time targets require measurement in the intended deployment.

For `fixmycampus.pages.dev`, use the [free Pages/API hosting guide](deploy/pages-free.md). It uses Cloudflare Pages, Render Free, Aiven MySQL, and private ImageKit storage. The API sleeps when idle, so this option has cold starts and pauses background jobs while asleep.

For an always-on server and your own domain, use the [Cloudflare Tunnel deployment](deploy/cloudflare.md). Its separate production Compose file keeps MySQL and uploads on the server and publishes the app through one HTTPS hostname.
