# Operations and deployment

## Local and production environments

`compose.yml` is a local evaluation environment. It binds MySQL, Mailpit, and HTTP to loopback. Its `campus:campus` database account and demo password are public development credentials. Mailpit captures mail and does not deliver it externally. Never expose this composition directly to a campus network or Internet.

For production, provision MySQL 8.4 with a separate database and least-privilege application account, set `NODE_ENV=production`, a random `JWT_SECRET` of at least 48 characters, an HTTPS `APP_URL`, approved institutional domains, production SMTP credentials, and a private attachment store. Generate a secret with `node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"`. Keep secrets outside source control. Do not seed demo accounts in production.

Run `npm ci`, `npm run build`, and `npm run db:migrate` during deployment. Create the first verified institutional Administrator without demo users: set `BOOTSTRAP_ADMIN_NAME`, `BOOTSTRAP_ADMIN_EMAIL`, and a unique strong `BOOTSTRAP_ADMIN_PASSWORD`, then run `npm run admin:bootstrap` once and remove the bootstrap password from the environment. The command initializes the catalog and refuses to create another bootstrap administrator when one already exists. Further accounts use registration and administrative role assignment.

Start `npm start` in a process supervisor. Configure the reverse proxy using `deploy/nginx.conf`, replacing the hostname and certificate paths. Only the HTTPS proxy should be externally reachable; MySQL and application HTTP remain private. Configure one trusted proxy hop, retain request-size limits, and validate secure-cookie behavior through the actual proxy.

For Cloudinary, set `STORAGE_DRIVER=cloudinary` and all three `CLOUDINARY_*` secrets. Files use authenticated/private storage and still pass through application authorization. Validate uploads and downloads using a restricted officer and an unrelated account before rollout. Local storage uses `UPLOADS_DIR`; never configure a publicly served directory.

SMTP submission should use TLS: set `SMTP_SECURE=true` for implicit TLS (commonly port 465), or a relay supporting STARTTLS on its documented port. Set `SMTP_USER`, `SMTP_PASSWORD`, and a verified `SMTP_FROM`. Confirm account verification/reset links use the HTTPS `APP_URL`. Monitor unsent outbox entries and failures; a relay outage must not roll back a successful complaint submission.

## Health and jobs

- `GET /api/v1/health` checks API/database readiness. The container has a readiness probe. Monitor proxy/API error rates, read latency p95, disk usage, database space, SMTP backlog, and the age of the oldest pending outbox entry.
- The API evaluates SLA breaches every minute. Escalation is once per resolution cycle. Keep server time synchronized; store timestamps in UTC and display in Asia/Kolkata.
- Use one application instance for the supplied deployment. Multiple instances require shared private attachment storage and measured database/worker behavior.
- Schedule maintenance outside 09:00-21:00 IST on working days. Announce expected downtime. The 99.5% uptime, RPO 24 hours, and RTO four hours are operational targets to measure, not properties proven by a local build.

## Backups and retention

Run the shell helpers under Linux or WSL from the repository root. They require Docker Compose and the built application image. Store `BACKUP_DIR` on a protected disk and copy archives to separate encrypted storage. Backups contain reporter identity, complaint contents, and account hashes; restrict access.

```sh
bash scripts/backup.sh
# Example daily schedule at 02:15 IST, with the host configured to Asia/Kolkata:
# 15 2 * * * cd /srv/fixmycampus && BACKUP_DIR=/srv/secure-backups bash scripts/backup.sh
```

The helper uses a transaction-consistent MySQL dump and archives the private upload volume. It retains its own timestamped archives for 30 days. Database and files are separate snapshots: pause new attachment writes or take a storage-consistent snapshot during backup if strict attachment/database atomic recovery is required. Never place backup output in the public web directory.

Exercise restoration in an isolated compose project, with a separate MySQL port:

```sh
RESTORE_PROJECT=fixmycampus-restore MYSQL_PORT=3307 bash scripts/restore.sh backups/fixmycampus-YYYYMMDDTHHMMSSZ.tar.gz
```

The script refuses the default/live project and port. It restores database and uploads into separate named volumes and does not delete the live instance. Before cutover, verify complaint/user counts, sign-in, anonymous identity masking, sample attachment downloads, immutable audit history, and pending emails. Start a temporary app against that restored database using separate ports and an isolated SMTP capture; do not send restored queued mail through production SMTP. Record elapsed restore time and backup age to measure RTO/RPO. Remove an isolated restore project only after review; do not run `docker compose down -v` against live data.

Keep audit events for at least 12 months and notification history for at least 90 days. Database triggers prevent recent audit deletion and audit/history modification. No automated cleanup currently purges these records, so they are retained longer unless a separately reviewed retention job is introduced. Complaints have no physical-delete API. Add storage-capacity alerts before retention growth becomes a disk incident.

## Capacity measurement

Use a separate database whose name starts `fixmycampus_benchmark`. Never generate scale data in a demonstration or production database.

```sh
# Create an empty dedicated database and grant the local benchmark account access first.
DATABASE_URL=mysql://campus:campus@127.0.0.1:3306/fixmycampus_benchmark npm run db:migrate
DATABASE_URL=mysql://campus:campus@127.0.0.1:3306/fixmycampus_benchmark npm run db:seed
BENCH_DATABASE_URL=mysql://campus:campus@127.0.0.1:3306/fixmycampus_benchmark ALLOW_BENCHMARK_SEED=1 node scripts/benchmark-data.mjs
# Start a separate API connected to that database, then:
BENCH_URL=http://localhost:3001 BENCH_PASSWORD='CampusDemo!2026' BENCH_USERS=500 BENCH_REQUESTS=2000 node scripts/load-test.mjs
```

PowerShell uses `$env:NAME='value'` before a command in place of the inline environment assignments above. The generator inserts 5,000 synthetic reporter accounts and 10,000 complaints, without deleting records. It requires both an explicit database URL and opt-in flag. The read probe reports failures and p50/p95/p99 latency, exits nonzero on failures or p95 above two seconds, and models concurrent read workers sharing an Incharge account. It is a read-path baseline, not a full 500-distinct-session capacity certificate. Record hardware, data counts, warm/cold conditions, and timings before and after scale generation to evaluate the 20% degradation target. Measure the separate 10 MB submission and 90-second first-time reporting targets in a timed browser exercise.
