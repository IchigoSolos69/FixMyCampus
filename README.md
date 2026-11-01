# FixMyCampus

FixMyCampus is a single-campus complaint and service-desk application. Students, Faculty, and Staff report campus issues, Campus Incharge routes and prioritizes them, and Department Officers record progress and resolution. Administrators manage access, routing, service-level settings, and reports.

The project implements the accepted scope of **REQ-001–REQ-068** from the supplied FixMyCampus SRS. It includes the React client, Express API, MySQL migrations, demo data, automated tests, deployment configuration, and operational documentation. The agreed amendment uses **15 categories and 11 departments**. See [SRS decisions](docs/decisions.md) and the [requirement-to-test checklist](docs/requirements.md) for interpretation and acceptance limits.

**Configured public application:** [fixmycampus.pages.dev](https://fixmycampus.pages.dev). Public registration is restricted to **`pccoepune.org`**; local development uses **`campus.test`**. Deployment checks recorded below are dated results, not a current uptime guarantee.

> **Render migration — 1 November 2026:** The replacement API is deployed in the confirmed destination workspace, and Cloudflare Pages now uses it. Database health recovered after the Aiven service returned to Running. Public health/security checks and CI passed; see the [migration record](docs/verification.md#render-account-migration-started--1-november-2026) for verification limits.

## Contents

- [Features and permissions](#features-and-permissions)
- [Complaint workflow and rules](#complaint-workflow-and-rules)
- [Initial category routing](#initial-category-routing)
- [Architecture and technology](#architecture-and-technology)
- [Repository structure](#repository-structure)
- [Quick start with Docker](#quick-start-with-docker)
- [Native development](#native-development)
- [Demo accounts and walkthrough](#demo-accounts-and-walkthrough)
- [Configuration](#configuration)
- [Database and migrations](#database-and-migrations)
- [API overview](#api-overview)
- [Testing and recorded results](#testing-and-recorded-results)
- [Deployment and scheduled health checks](#deployment-and-scheduled-health-checks)
- [Security, backups, and retention](#security-backups-and-retention)
- [Troubleshooting](#troubleshooting)
- [Documentation and scope](#documentation-and-scope)

## Features and permissions

| Role               | Main capabilities                                                                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Student            | Submit issues, track own complaints, correct returned reports, reopen eligible resolutions, and leave feedback.                                                          |
| Faculty            | Reporter capabilities for own complaints. Assigned by an Administrator after institutional verification.                                                                 |
| Staff              | Reporter capabilities for own complaints. Assigned by an Administrator after institutional verification.                                                                 |
| Campus Incharge    | Verify, return, reject, prioritize, assign, reassign, and manually escalate complaints; monitor operational queues.                                                      |
| Department Officer | View and work on complaints assigned to their department, add progress/evidence, and resolve cases. Each officer belongs to exactly one department.                      |
| Administrator      | Manage accounts, roles, activation, departments, categories, routing, SLA settings, email templates, and aggregate reports. Confidential case details remain restricted. |

Other capabilities include:

- Institutional-domain registration, email verification, login, password reset/change, profile editing, and account lockout. Public registration always creates a Student account.
- Role-specific dashboards, combined search/filter controls, server-side complaint pagination, and critical-first operational queues.
- Complaint timelines containing assignment history, status changes, progress notes, evidence, and resolution cycles.
- Durable in-app notifications with individual/all-read actions, and a transactional email outbox that retries SMTP failures without undoing successful submissions.
- Five-second polling for visible tracking, queues, and notifications; minute-by-minute SLA breach scanning.
- Complaint-count reports, average/median resolution times, department ratings, SLA compliance, and authorized CSV/PDF exports. Incharge has the category summary; Administrators have the full report/export set.
- Responsive reporting forms and desktop queues using locally bundled Source Sans 3, white surfaces, `#F3F7F9` backgrounds, `#172F3E` text, and `#006D77` actions. Primary screens include labels, keyboard navigation, visible focus, and textual status indicators. See the [design system](apps/web/DESIGN.md).

## Complaint workflow and rules

```text
Submitted → Verified → Assigned → In Progress → Resolved
```

Incharge can return or reject reports with a reason. Returned reports can be corrected and resubmitted to Submitted. A reporter can reopen an eligible resolution to Assigned.

- A submission requires a category, location, and description of at least **15 characters**. References use **`CMP-YYYYMMDD-NNNN`**, generated transactionally using the IST calendar date.
- Reporters can correct a returned report's description/location and resubmit; its category stays unchanged.
- A complaint has one assigned department. Incharge can override its default route with another active department. Officers can act only within their assigned department.
- Resolution requires a summary of at least **10 characters**. Resolved records are immutable except for reporter reopening within **72 hours**, with a reason. Reopening starts a new SLA cycle; previous history, proof, and assignments remain intact.
- Reporters may leave one immutable **1–5 rating** on a resolved complaint. Feedback survives reopening and retains attribution to the original resolving department.
- JPEG, PNG, and PDF evidence is checked by server-side file signatures. The cap is **five files total per complaint**, including resolution proof, at most **10 MiB (10,485,760 bytes)** each. Downloads require case authorization.
- Concurrent edits use version checks and transactions; invalid or stale transitions are rejected rather than silently overwriting another action.

### Emergency and confidential reporting

**Medical Emergencies, Mental Health Concerns, Anti-Ragging Complaints, and Security and Safety Issues** receive Critical priority and immediate system assignment, bypassing ordinary verification. Incharge and the assigned department are notified immediately. Emergency priority cannot be downgraded, and category renaming preserves its emergency/confidential behavior.

Mental Health and Anti-Ragging cases are confidential and permit anonymous submission. Case details are available only to the reporter, Incharge, and officers of the assigned department; Administrators receive aggregates and redacted escalation alerts. Reporter identity is hidden from handling views **only when anonymous submission is selected**. Anonymous reporting still requires authentication, and reporter-written text or file contents may themselves disclose identity.

### Service-level agreements

| Priority | Default resolution window |
| -------- | ------------------------- |
| Low      | 168 hours                 |
| Medium   | 72 hours                  |
| High     | 24 hours                  |
| Critical | 24 hours                  |

SLA time starts at submission. Returning or reassigning does not reset it. Priority changes recalculate the current deadline from that cycle's original start, using a snapshot of the configured SLA. Reopening creates a new cycle. The background scanner escalates a breach once per cycle, including when jobs overlap.

Department trend reports flag a department only when its average `(resolution hours / snapshot SLA hours)` exceeds 1 in **each of the two preceding completed IST Monday–Sunday weeks**. An empty week does not establish a breach trend. Database timestamps use UTC; display dates and report boundaries use IST.

## Initial category routing

These defaults create **15 categories across 11 departments**, replacing the SRS's original department count. Incharge can override an individual assignment; Administrators can edit routing.

| Category                                  | Default department                          |
| ----------------------------------------- | ------------------------------------------- |
| Classroom Infrastructure                  | Civil Engineering                           |
| Electrical and Power Issues               | Estate Maintenance                          |
| Plumbing and Water Supply                 | Civil Engineering                           |
| Furniture and Fixture Damage              | Estate Maintenance                          |
| Cleanliness and Sanitation                | Administration                              |
| Waste Management                          | Administration                              |
| Wi-Fi and Network Issues                  | Information Technology                      |
| Computer and Software Lab Issues          | Computer Engineering                        |
| Projector and Electronic Equipment Issues | Electronics & Telecommunication Engineering |
| Library and Learning Resource Issues      | Library and Learning Resource Development   |
| Transport and Parking Issues              | Administration                              |
| Medical Emergencies                       | Medical Services                            |
| Mental Health Concerns                    | Students Development and Welfare            |
| Anti-Ragging Complaints                   | Anti-Ragging Committee                      |
| Security and Safety Issues                | Security Services                           |

## Architecture and technology

```mermaid
flowchart LR
    Browser[React browser client] --> Pages[Cloudflare Pages and API proxy]
    Pages --> API[Express API on Render]
    API --> DB[(Aiven MySQL)]
    API --> Files[Private ImageKit storage]
    API --> Mail[Brevo SMTP]
    API --> Jobs[SLA scanner and email outbox worker]
    Jobs --> DB
    Wake[Cloudflare scheduled Worker] --> Pages
    Wake --> API
```

The diagram describes the configured public deployment. Locally, Vite proxies API requests during development; the compiled Express application can serve the SPA itself. Docker Compose supplies MySQL, private upload storage, and Mailpit for captured email.

| Layer              | Implementation                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------- |
| Runtime/workspaces | Node.js **24 LTS**, npm workspaces, TypeScript 5.9                                                |
| Client             | React **19.3**, Vite **8**, React Router, TanStack Query, Zod, ordinary CSS and CSS variables     |
| API                | Express **5**, versioned `/api/v1` routes, domain services, shared request/response types         |
| Database           | MySQL **8.4 LTS**, `mysql2` parameterized queries, transactions, numbered SQL migrations          |
| Authentication     | Salted scrypt passwords, signed JWT access/refresh tokens, secure cookies, CSRF and origin checks |
| Attachments        | Private local storage by default; ImageKit for the public deployment; optional Cloudinary adapter |
| Email/reports      | Nodemailer SMTP with durable outbox; CSV and PDFKit exports                                       |
| Verification       | Vitest with V8 coverage, real-MySQL integration tests, Playwright browser tests                   |

The exact installed versions are locked in [package-lock.json](package-lock.json). Routes enforce authentication and authorization for reads, writes, attachments, dashboards, searches, and exports. See [architecture and diagrams](docs/architecture.md) for component, data, deployment, and sequence details.

## Repository structure

```text
apps/
  web/                   React client, CSS, and design documentation
  api/
    src/                 Routes, domain services, queries, storage, and jobs
    migrations/          Ordered SQL migrations
packages/shared/         Schemas, public types, roles, statuses, and routing
functions/api/           Cloudflare Pages same-origin API proxy
tests/                   Unit, MySQL integration, and browser tests
scripts/                 Benchmark data, read-load probe, backup, and restore
deploy/                  Hosting guides, HTTPS proxy, and production Compose
  wake-worker/           Independent scheduled Cloudflare Worker
docs/                    API, diagrams, decisions, operations, and verification
.github/workflows/       Continuous integration
```

## Quick start with Docker

Install Docker Desktop with Docker Compose v2. Commands below use **PowerShell**, from the repository root. On a fresh checkout:

```powershell
git clone https://github.com/IchigoSolos69/FixMyCampus.git
Set-Location FixMyCampus
Copy-Item .env.example .env
# Edit .env: choose MYSQL_ROOT_PASSWORD and a new JWT_SECRET.
docker compose up --build -d --wait
docker compose exec app node dist/apps/api/src/seed.js
```

If `.env` already exists, edit it rather than replacing it. On Linux/macOS, use the equivalent `cp` and shell environment-variable syntax. Generate a signing secret with Node.js if available:

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
```

| Local service       | Address                                                                    |
| ------------------- | -------------------------------------------------------------------------- |
| Application and API | [http://localhost:3001](http://localhost:3001)                             |
| Database health     | [http://localhost:3001/api/v1/health](http://localhost:3001/api/v1/health) |
| Mailpit inbox       | [http://localhost:8025](http://localhost:8025)                             |
| SMTP / MySQL        | `127.0.0.1:1025` / `127.0.0.1:3306`                                        |

Migrations run automatically when the app container starts; seeding is explicit. The local Compose configuration uses development mode, loopback ports, `campus.test`, and private local uploads. Named volumes preserve MySQL and attachments across restarts.

Use `docker compose logs --tail 100 app` for startup errors and `docker compose down` to stop services. **Adding `-v` deletes the database and upload volumes** and is not part of normal shutdown. This Compose file is for local evaluation; use the separate production deployment instructions below.

## Native development

Install **Node.js 24**, npm, and **MySQL 8.4**. Copy `.env.example` to `.env` once. You can run just the dependencies with `docker compose up -d mysql mailpit`, or create a local database as a MySQL administrator:

```sql
CREATE DATABASE fixmycampus CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER 'campus'@'localhost' IDENTIFIED BY 'campus';
GRANT ALL PRIVILEGES ON fixmycampus.* TO 'campus'@'localhost';
```

These credentials are local examples. Match `DATABASE_URL` to the account host and port. If binary logging blocks creation of the integrity triggers, see [migration troubleshooting](#troubleshooting); the local Compose database already configures trusted trigger creation.

```powershell
npm ci
npm run db:migrate
npm run db:seed
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). Vite proxies `/api` to the API at port 3001. Keep `APP_URL=http://localhost:5173` for this mode. Run Vite through the workspace scripts so it uses the client's installed version.

SMTP defaults to Mailpit on port 1025. Without a relay, complaints remain saved and mail retries in the outbox, but verification/reset emails cannot arrive. Open Mailpit to use local verification links.

To build and serve the compiled SPA without Vite:

```powershell
npm run build
$env:APP_URL='http://localhost:3001'
npm start
```

## Demo accounts and walkthrough

The local seed creates verified accounts with the shared password **`CampusDemo!2026`**. It is idempotent: it does not reset existing passwords or overwrite edited configuration. Demo seeding is disabled in production.

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

Seeded complaints demonstrate submitted, assigned, in-progress, resolved/rated, returned, confidential, and emergency states. For a manual demonstration:

1. Sign in as Student and submit a Classroom Infrastructure issue with evidence.
2. Sign in as Incharge, verify it, set priority, and assign Civil Engineering.
3. Sign in as `officer1`, add progress, and resolve with a summary/proof.
4. Return as Student to leave feedback or reopen within 72 hours.
5. Submit an anonymous Mental Health report to inspect immediate Critical routing and restricted visibility.
6. Sign in as Administrator to inspect routing, access controls, SLA settings, and report exports.

See the [full demonstration guide](docs/demo.md). These public demo credentials are for local/disposable evaluation, not the public production service.

## Configuration

Use [.env.example](.env.example) as the complete local template. Keep actual `.env` files and provider credentials out of version control; production values belong in the hosting provider's secret settings.

| Variable(s)                                                                 | Purpose / local default                                                                                                          |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`, `PORT`                                                          | Development mode and API port `3001`; use `production` when deployed.                                                            |
| `APP_URL`                                                                   | Exact browser origin: `http://localhost:5173` for Vite, `http://localhost:3001` for the compiled local app, HTTPS in production. |
| `DATABASE_URL`                                                              | MySQL connection URL. Percent-encode reserved characters in its username/password.                                               |
| `DATABASE_SSL_CA`                                                           | Managed database CA certificate, with real newlines or literal `\n`; enables verified TLS.                                       |
| `JWT_SECRET`                                                                | Signing secret; production requires at least 48 characters and rejects development placeholders. Use a randomly generated value. |
| `APPROVED_EMAIL_DOMAINS`                                                    | Comma-separated registration domains; `campus.test` locally, `pccoepune.org` for the configured public deployment.               |
| `STORAGE_DRIVER`, `UPLOADS_DIR`                                             | `local`, `imagekit`, or `cloudinary`; local upload directory defaults to `../../uploads` relative to the API workspace.          |
| `IMAGEKIT_URL_ENDPOINT`, `IMAGEKIT_PRIVATE_KEY`                             | Private ImageKit adapter configuration. Never expose the private key to the client.                                              |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`      | Optional private Cloudinary adapter configuration.                                                                               |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`                                     | Local Mailpit: `127.0.0.1`, `1025`, `false`. Public deployment uses Brevo port `2525` with STARTTLS.                             |
| `SMTP_FROM`, `SMTP_USER`, `SMTP_PASSWORD`                                   | Sender and relay credentials; use a provider-verified production sender.                                                         |
| `MYSQL_ROOT_PASSWORD`                                                       | Required by local Docker Compose; separate from the application's database password.                                             |
| `TEST_DATABASE_URL`                                                         | Dedicated disposable integration-test database; its name must contain `test`.                                                    |
| `BOOTSTRAP_ADMIN_NAME`, `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD` | One-time first Administrator creation; remove after bootstrap.                                                                   |

Production configuration fails early for a missing database URL, invalid signing secret, or non-HTTPS application origin. Public database TLS certificate and hostname checks stay enabled. Browser API requests use the same origin through the Pages proxy; the client receives no database, storage, or SMTP secrets.

### First production Administrator

Run migrations against the intended production database, configure the approved domain, then set the three `BOOTSTRAP_ADMIN_*` variables in a secure administrative environment and run:

```powershell
npm run admin:bootstrap
```

Bootstrap creates the initial routing/catalog, SLA settings, email templates, and a verified Administrator. It refuses to run if an Administrator already exists. Use a unique strong password, remove the bootstrap variables afterwards, and **do not run the demo seed on production**. The [hosting guide](deploy/pages-free.md) describes separating the migration/bootstrap account from the restricted runtime database account.

## Database and migrations

| Migration                                                                      | Purpose                                                                         |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| [001_initial.sql](apps/api/migrations/001_initial.sql)                         | Core schema, relationships, audit/history integrity, and retention protections. |
| [002_queue_indexes.sql](apps/api/migrations/002_queue_indexes.sql)             | Queue/search indexes supporting paginated read paths.                           |
| [003_feedback_department.sql](apps/api/migrations/003_feedback_department.sql) | Preserve feedback attribution to the resolving department.                      |
| [004_imagekit_storage.sql](apps/api/migrations/004_imagekit_storage.sql)       | Add ImageKit as a persisted attachment storage driver.                          |

The schema stores users, authentication tokens, departments, categories, reference sequences, complaints, attachments, assignment/status history, progress notes, resolution cycles, feedback, notifications, email outbox, settings, templates, and audit events. `schema_migrations` records applied migration filenames.

Run `npm run db:migrate` before starting a new release. MySQL DDL is not transactionally rolled back: investigate a partially failed migration before retrying, and do not mark it applied manually or discard existing data. Use schema-scoped migration privileges and a separate least-privilege runtime user in production.

## API overview

Base path: **`/api/v1`**. JSON uses camelCase. Authenticated requests carry `Authorization: Bearer <access-token>`; cookie-based refresh/logout additionally require the documented CSRF/origin checks.

| Resource       | Endpoints / purpose                                                                                                                          |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Health         | `GET /health`: database connectivity, HTTP 200 when connected or 503 when unavailable.                                                       |
| Authentication | `/register`, `/verify-email`, `/login`, `/forgot-password`, `/reset-password`, `/refresh`, `/logout`, `/csrf`, and `/me`, all under `/auth`. |
| Profile        | `GET/PATCH /profile`; password and private photo operations.                                                                                 |
| Catalog        | `GET /catalog`: authorized department/category metadata.                                                                                     |
| Complaints     | `GET/POST /complaints`, `GET /complaints/:id`, and complaint actions, attachments, and feedback.                                             |
| Private files  | `GET /attachments/:id`, with complaint authorization.                                                                                        |
| Notifications  | `GET /notifications`, `POST /notifications/read`.                                                                                            |
| Dashboards     | `GET /dashboard`, scoped to the current role.                                                                                                |
| Reports        | `GET /reports?type=category` (also department, status, or sla); authorized CSV/PDF `/reports/export`.                                        |
| Administration | `/admin/users`, `/admin/departments`, `/admin/categories`, and `/admin/settings`.                                                            |

Complaint queries combine text, category, department, status, priority, date boundaries, page, and page size, up to 100 records per page. Authorization applies before results are returned. Missing or inaccessible private resources return 404; authentication/permission failures use 401/403, conflicting edits use 409, and validation errors use 422.

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "fields": { "description": ["Description is too short"] }
  }
}
```

The [API contract](docs/api.md) specifies exact methods, request bodies, action names, upload handling, cookie renewal, and response fields.

## Testing and recorded results

### Local checks

```powershell
npm run typecheck
npm run build
npm test
npm run test:coverage
```

Unit tests require no database. Coverage enforces **70% statements, branches, functions, and lines** for configured service modules; inspect the generated `coverage/` report. Use `npm run format:check` for repository formatting.

Integration tests require real MySQL and a separate disposable database such as `fixmycampus_test`, with an appropriately granted test account:

```powershell
$env:TEST_DATABASE_URL='mysql://campus:campus@127.0.0.1:3306/fixmycampus_test'
npm run test:integration
```

Without `TEST_DATABASE_URL`, scenarios are explicitly skipped. The suite rejects database names without `test`. It does not drop or truncate a database, but creates users, complaints, history, and test configuration. Never point it at production.

For browser tests, start and seed a disposable local application, then run in another terminal:

```powershell
npx playwright install chromium
$env:E2E_BASE_URL='http://localhost:5173'
$env:E2E_MAILPIT_URL='http://localhost:8025'
npm run test:e2e
```

For Docker use `E2E_BASE_URL=http://localhost:3001`. To use installed Chrome, set `$env:PLAYWRIGHT_CHANNEL='chrome'`. Registration/verification coverage is skipped without `E2E_MAILPIT_URL`. Browser tests create real records in the configured application.

Tests cover registration/verification, lockout/reset expiry, revoked tokens, profile changes, concurrent references, invalid transitions, cross-user/department access, anonymous identity protection, private attachments and limits, reopening boundaries, immutable feedback/history, duplicate SLA jobs, administration, and exports. Browser scenarios cover the main complaint lifecycle, emergency/anonymous reporting, mobile keyboard use, administration, downloads, and captured-email verification. [GitHub Actions](.github/workflows/ci.yml) runs typechecking, builds, coverage, real-MySQL integration, and browser checks.

### Recorded verification

These results were recorded on **16 and 19 October 2026**, in the environments described in [verification.md](docs/verification.md); they have not been rerun merely to update this README.

| Check                                   | Recorded result                                                                                          |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Unit suite, 19 October                  | **255/255 passed**.                                                                                      |
| Real-MySQL integration, 19 October      | **11/11 passed**, 8.65 seconds, migrations 001–004 on a disposable database.                             |
| Chrome end-to-end scenarios, 16 October | **6/6 passed** against the local API, MySQL, and Mailpit.                                                |
| Service coverage, 16 October            | **92.73% lines/statements**, **93.46% branches**, **97.82% functions**.                                  |
| Workspace validation, 19 October        | Typecheck and production build passed.                                                                   |
| Public read-only recheck, 19 October    | **48 checks across 37 GET requests** passed; zero 5xx responses. Warm API median 1,006 ms, p95 1,772 ms. |
| Scheduled Worker, 19 October            | Actual scheduled invocation passed direct API/database, proxied API/database, and login HTML checks.     |

### Capacity probe

The local read-path probe completed 2,000 requests with **500 concurrent workers**, sharing one authenticated Incharge session. On a database with **5,016 users and 10,007 complaints**, median-of-three warm p95 was **733 ms**, versus **689 ms** at baseline: **6.4% degradation**, with zero failed requests. This measures one local read path, not 500 distinct user sessions or free-hosting production capacity.

Use [benchmark-data.mjs](scripts/benchmark-data.mjs) to generate synthetic data only in a dedicated database whose name starts with `fixmycampus_benchmark`; it requires `BENCH_DATABASE_URL` and `ALLOW_BENCHMARK_SEED=1`. [load-test.mjs](scripts/load-test.mjs) requires an explicit `BENCH_URL` and `BENCH_PASSWORD`, supports `BENCH_EMAIL`, `BENCH_USERS`, and `BENCH_REQUESTS`, and fails on request errors or p95 above two seconds. See [operations](docs/operations.md) for the complete guarded setup and reproducible commands.

## Deployment and scheduled health checks

### Configured public hosting

| Component           | Provider / configuration                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------- |
| Static client       | Cloudflare Pages: [fixmycampus.pages.dev](https://fixmycampus.pages.dev)                                      |
| Browser API         | Same-origin [Pages API health](https://fixmycampus.pages.dev/api/v1/health), forwarded by the Pages Function. |
| Express API         | Render Docker service: [direct API health](https://fixmycampus-api-arvi.onrender.com/api/v1/health).          |
| Database            | Aiven MySQL, using verified TLS and a restricted runtime database account.                                    |
| Evidence            | Private ImageKit storage; authorized server-side reads preserve original file bytes.                          |
| Transactional email | Brevo SMTP, port 2525 with STARTTLS and a verified sender.                                                    |
| Scheduled checks    | Separate Cloudflare Worker, `fixmycampus-wakeup`, every five minutes.                                         |

The [free hosting guide](deploy/pages-free.md) covers account setup, database migration/bootstrap, secrets, TLS, storage, email, and deployment. [render.yaml](render.yaml) configures the API; [wrangler.jsonc](wrangler.jsonc) configures Pages. The Pages build command is:

```sh
npm run build -w @fixmycampus/shared && npm run build -w @fixmycampus/web
```

Its output directory is `apps/web/dist`; use Node 24. Production `API_ORIGIN` points to the Render HTTPS origin, and API `APP_URL` points to the Pages HTTPS origin. The proxy preserves authentication/cookies and does not cache private API responses. An unconfigured preview deployment returns a controlled unavailable response rather than forwarding to an unknown API.

### Wake-up Worker

The independent [Worker](deploy/wake-worker/README.md) requests direct API/database health, Pages API/database health, and login HTML every five minutes, even when this computer is off. API checks require HTTP 200 JSON with a connected database. Requests have bounded timeouts, safe structured logs, and no runtime credentials or public HTTP trigger. ImageKit and Brevo are managed services and need no idle wake calls.

Deploy Worker changes separately from Pages, after authenticating to the intended Cloudflare account:

```powershell
npm exec --yes --package=wrangler@4.151.1 -- wrangler deploy --config deploy/wake-worker/wrangler.jsonc
```

The root Wrangler configuration belongs to Pages; the nested one belongs to this Worker. Worker deployment is manual through the CLI; automatic build integration is not connected. Check Cloudflare Observability for actual scheduled executions, not just a successful upload.

**Free hosting remains best effort.** Scheduled requests reduce idle cold starts but cannot prevent quota exhaustion, maintenance, suspension, or provider outages. An HTTP check cannot power on a stopped Aiven service. SLA scanning and mail processing pause whenever the API is unavailable. Monitor provider usage and the existing database's status; do not treat wake requests as an availability guarantee.

For an always-on server with your own domain, use the separate [Cloudflare Tunnel deployment](deploy/cloudflare.md) and [production Compose file](deploy/compose.cloudflare.yml). The [operations guide](docs/operations.md) also covers the [HTTPS reverse proxy](deploy/nginx.conf). This option requires a server that remains powered on and is distinct from the free Pages/Render setup.

## Security, backups, and retention

- Passwords use salted scrypt. Password policy requires 12–128 characters with upper/lowercase, a digit, and a symbol. Five failed logins lock the account for 15 minutes. Verification links expire after 24 hours; password-reset links expire after 30 minutes and are single-use.
- Access JWTs last 60 minutes and stay in browser memory. Signed refresh tokens use HttpOnly cookies; production cookies require HTTPS. Refresh happens during user activity, with a 60-minute inactivity limit. Password/security changes, role/department changes, and account deactivation invalidate prior tokens. No Express sessions are used.
- Cookie operations require trusted origins and CSRF validation. Parameterized SQL, request validation, rate limits, security headers, and authorization checks apply server-side.
- Files remain private. ImageKit URLs are signed and fetched server-side after authorization; provider URLs and private keys are not returned to browsers. Confidential access rules apply to file downloads and exports as well as screens.
- Audit/history records have database integrity protections. Retain notifications for at least **90 days**, audit events for at least **12 months**, and daily backups for **30 days**. The application does not automatically purge notification history.

For a Compose deployment, [backup.sh](scripts/backup.sh) archives a consistent database dump and local uploads; run it using Bash on Linux/WSL and arrange daily execution plus encrypted off-host copies. For strict database/file consistency, pause writes during capture. Managed Aiven and ImageKit data require their own coordinated backup/export procedures; local Compose helpers do not automatically back up those providers.

[restore.sh](scripts/restore.sh) restores into a separate Compose project and database port. Follow the [backup/restore runbook](docs/operations.md), rehearse restoration before relying on it, and never delete live volumes as a recovery shortcut. The documented RPO of 24 hours and RTO of four hours require operational monitoring and measured restore exercises.

## Troubleshooting

| Symptom                                                            | Check / action                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `client`, `main.tsx`, or `@react-refresh` returns 500 locally      | Use Node 24, run `npm ci` from the repository root, then `npm run dev`. Start Vite through the web workspace script; inspect terminal output for the actual transform/dependency error.                                                                                                                                                                                      |
| MySQL migration error 1419 / `ER_BINLOG_CREATE_ROUTINE_NEED_SUPER` | Audit/history triggers need permitted trigger creation when binary logging is enabled. Local Compose sets `log_bin_trust_function_creators=1`. For an administered local test instance, a database administrator can enable that setting; on a managed service, use its supported configuration. Do not grant SUPER to the application account or remove integrity triggers. |
| API returns 503 / database unavailable                             | Check `/api/v1/health`, API logs, database status, URL, and CA certificate. On Aiven, power on the existing service if stopped, wait for Running, then recheck both health endpoints. Do not create a replacement database to fix a stopped service.                                                                                                                         |
| Login or registration takes a long time                            | Check direct API health and then proxied health to distinguish backend/database failure from proxy configuration. Free-host cold starts can delay requests; the static login form should remain visible during session recovery.                                                                                                                                             |
| “The server could not complete this request”                       | Correlate the failed request with API logs and database health. Check migrations, connectivity, and configuration rather than repeatedly submitting the form. SMTP failure alone should queue mail without undoing account/complaint creation.                                                                                                                               |
| Verification/reset email missing                                   | Locally inspect Mailpit. In production inspect outbox/provider logs, sender verification, SMTP credentials, STARTTLS connectivity, and recipient filtering. Keep tokens and reset links private.                                                                                                                                                                             |
| Browser rejects cookies / refresh fails                            | Match `APP_URL` to the exact browser origin, use HTTPS in production, and route API calls through the same-origin proxy. Follow the API's CSRF handshake.                                                                                                                                                                                                                    |
| Private upload/download fails                                      | Check signature/type, per-file size, the five-file total, assigned department/ownership, storage-driver credentials, and provider availability.                                                                                                                                                                                                                              |
| Docker port already in use                                         | Stop the conflicting local service or configure the documented port mapping; match native connection URLs to the selected port. Preserve named volumes.                                                                                                                                                                                                                      |

## Documentation and scope

| Document                                                | Contents                                                                              |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| [API contract](docs/api.md)                             | Authentication, endpoints, schemas, actions, errors, and exports.                     |
| [Architecture](docs/architecture.md)                    | System design, data relationships, deployment, and sequence diagrams.                 |
| [SRS decisions](docs/decisions.md)                      | Agreed amendments, confidentiality rules, routing, SLA, and lifecycle interpretation. |
| [Requirement checklist](docs/requirements.md)           | REQ-001–REQ-068 implementation and verification mapping.                              |
| [Demo walkthrough](docs/demo.md)                        | Role-by-role evaluation scenarios.                                                    |
| [Verification report](docs/verification.md)             | Dated test runs, measured performance, deployment checks, and limitations.            |
| [Operations](docs/operations.md)                        | Native/production operation, backups, restore, load probes, and retention.            |
| [Free hosting](deploy/pages-free.md)                    | Cloudflare Pages, Render, Aiven, ImageKit, and Brevo setup.                           |
| [Scheduled health checks](deploy/wake-worker/README.md) | Worker deployment, actual checks, failure interpretation, and recovery.               |
| [Own-server hosting](deploy/cloudflare.md)              | Cloudflare Tunnel and production Compose.                                             |
| [Client design system](apps/web/DESIGN.md)              | Layout, typography, palette, accessibility, and responsive behavior.                  |

Excluded future scope: multi-campus support, native mobile apps, SMS, WebSockets/SSE, and multilingual UI.

Remaining deployment acceptance work includes sustained uptime/capacity measurements, an isolated restore rehearsal, operational off-host backups, a timed 10 MiB submission, a first-time-user usability study, and a complete WCAG 2.1 AA audit. Local read-load measurements and successful smoke checks do not certify production capacity, recovery targets, or continuous emergency availability on free hosting.
