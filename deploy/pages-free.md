# Free hosting at fixmycampus.pages.dev

This option uses Cloudflare Pages for React and an API proxy, Render Free for Express, Aiven Free for MySQL 8.4, ImageKit Free for private attachments, and Brevo Free for email. It needs no always-on personal server. Each provider account and its terms must be accepted by the account owner. Select only the named **Free** plans; stop if signup or verification requires a payment, paid upgrade, or billing authorization.

The application remains functional with free-tier limits. Render sleeps after 15 minutes without incoming traffic and takes about a minute to wake. **SLA scans and queued email delivery pause while the API sleeps** and resume after wake-up. Aiven can power off inactive free databases. The optional [scheduled health checks](wake-worker/README.md) request the API and database every five minutes to reduce idle cold starts. They do not prevent crashes, provider suspension, exhausted quotas, or maintenance. This setup does not promise production uptime, continuous emergency processing, or the SRS's 500-user capacity.

## 1. Create the free accounts and persistent services

Use an existing Cloudflare Pages project named `fixmycampus`, or create that project if the hostname is available in your account. Its production URL must be `https://fixmycampus.pages.dev`. No custom domain purchase is needed. Keep provider passwords, database credentials, API keys, and JWT secrets in local environment variables or provider secret inputs; do not paste them into chat or commit them.

### Aiven: MySQL and verified TLS

1. Create **Aiven for MySQL, Free tier**, explicitly choosing **MySQL 8.4**. The free service has 1 GB RAM, 1 GB disk, and up to 76 connections; it requires no credit card and has no fixed expiration, but can be powered off for inactivity. A service labeled **Developer-1** or using an 8 GB trial allocation is not the Free tier. If one already exists and is **Building**, wait for provisioning to finish, then use its service-plan controls to select Free and verify the final plan. Aiven permits a downgrade only when the data fits and Free is available in that cloud. If Free is unavailable, stop and resolve the plan choice without deleting existing data or accepting a paid upgrade. Expiring trial credits do not provide permanent free hosting.
2. Download the service's CA certificate and record its hostname, port, and administrative credentials from the connection details. Preserve the full PEM certificate, including its `BEGIN CERTIFICATE` and `END CERTIFICATE` lines.
3. With a MySQL 8.4 command-line client, connect using verified TLS. These example local commands use PowerShell 7.1 or newer; replace paths and connection fields:

   ```powershell
   mysql --host=YOUR_AIVEN_HOST --port=YOUR_AIVEN_PORT --user=avnadmin --password --ssl-mode=VERIFY_IDENTITY --ssl-ca="C:\secure\aiven-ca.pem"
   ```

4. Before creating application tables, inspect the actual service:

   ```sql
   SELECT VERSION(), @@log_bin, @@log_bin_trust_function_creators;
   SHOW GRANTS FOR CURRENT_USER();
   ```

   Require version 8.4 and a migration account permitted to create tables, indexes, and triggers. Aiven documents `TRIGGER` support, but its public configuration reference does not establish the binary-log trust setting for every free service. **If binary logging is enabled and `log_bin_trust_function_creators` is zero, stop before migration.** Confirm an approved compatible setting with the provider. Do not remove integrity/audit triggers or grant the application global `SUPER` privileges to get around a failure.

5. Create a dedicated, empty application database through Aiven's **Databases** view or with:

   ```sql
   CREATE DATABASE fixmycampus CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
   ```

   If that database already exists, inspect it and preserve its contents. Do not overwrite a previous deployment, run tests against it, or drop tables to obtain a clean installation.

Build the administrative `DATABASE_URL` for this new database as `mysql://USER:URL_ENCODED_PASSWORD@HOST:PORT/fixmycampus`. Percent-encode special characters in credentials. Use `DATABASE_SSL_CA` for TLS; remove provider-specific URI query parameters such as `ssl-mode` that are not mysql2 options. Never disable certificate or hostname verification.

### ImageKit: private files

Choose **Forever free** under **Complete Media Processing + DAM**. Record the private API key and the canonical URL endpoint, such as `https://ik.imagekit.io/your-account-id`, from ImageKit's dashboard. Configure these server-side settings:

```text
STORAGE_DRIVER=imagekit
IMAGEKIT_PRIVATE_KEY=<ImageKit private API key>
IMAGEKIT_URL_ENDPOINT=https://ik.imagekit.io/your-account-id
```

Use the HTTPS endpoint origin/account path without an added folder, query, or trailing transformation. Render's free local filesystem cannot preserve uploads. The backend uploads JPEG, PNG, and PDF with **`isPrivateFile=true`**. After application authorization, it creates a signed URL valid for 60 seconds, fetches the file on the server, and returns its bytes through the authorized API route. No browser upload credentials or ImageKit public key are needed; keep the private key out of Pages/frontend settings and source code.

In ImageKit's security settings, restrict unsigned image URLs with **Restrict all requests**. Confirm uploaded-file metadata actually reports the file as private. The image/video unsigned-URL setting does not protect other file types, so PDFs require `isPrivateFile=true` as well. ImageKit also permits access to private files through valid named transformations; do not create public named transformations that can expose complaint files. Keep complaint assets separate from any media workflow that requires public named transformations.

The Free plan currently provides **3 GB storage**, **20 GB monthly delivery bandwidth**, and a **25 MB raw-file upload limit**. The application's own limit remains five files per complaint, each at most **10 MB**. Verify upload and authorized download for JPEG, PNG, and PDF, including a near-limit file. Also request the corresponding unsigned ImageKit URL and confirm denial. Do not make a file public to resolve a delivery failure. Provider storage/delivery quotas still apply.

### Brevo: verified SMTP sender

Create a Free account without adding paid options, complete its transactional-email/account review, and verify the sender address you will use. Use a sender/domain you are authorized to verify. The free allowance is **300 emails per day**; notifications, verification, and password reset share that allowance.

From **SMTP & API**, obtain the SMTP login and an **SMTP key**, which is separate from an HTTP API key. Configure:

```text
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=2525
SMTP_SECURE=false
SMTP_USER=<Brevo SMTP login>
SMTP_PASSWORD=<Brevo SMTP key>
SMTP_FROM=FixMyCampus <verified-sender@example.edu>
```

Port 2525 uses a STARTTLS upgrade, rather than implicit TLS; the application requires TLS in production. Brevo documents support for port 2525. Render explicitly blocks ports 25, 465, and 587 on Free services; using 2525 is a compatibility inference that **must be checked from the live Render service**. If it cannot connect or complete TLS, email is not ready: the outbox will retry, but registration/reset emails will not arrive. Do not mark that deployment complete or silently disable email.

## 2. Migrate and bootstrap locally before starting the public API

Use a new local PowerShell session for production administration, and run from the repository root with Node.js 24. Build the current API and shared package:

```powershell
npm ci
npm run build -w @fixmycampus/shared
npm run build -w @fixmycampus/api
```

Set production connection settings in the current PowerShell process. `Read-Host -MaskInput` requires PowerShell 7.1 or newer; it keeps secrets out of command history and masks typed input. Generate a unique signing secret and keep its value for Render's `JWT_SECRET` input:

```powershell
$env:NODE_ENV = 'production'
$env:APP_URL = 'https://fixmycampus.pages.dev'
$env:APPROVED_EMAIL_DOMAINS = 'yourinstitution.edu'
$env:DATABASE_URL = Read-Host -MaskInput 'Administrative Aiven URL for the new fixmycampus database'
$env:DATABASE_SSL_CA = Get-Content -Raw -LiteralPath 'C:\secure\aiven-ca.pem'
$env:JWT_SECRET = node -e "process.stdout.write(require('node:crypto').randomBytes(48).toString('hex'))"
node apps/api/dist/apps/api/src/migrate.js
```

Use your real institutional domains, comma-separated if needed. The generated signing secret is 96 hexadecimal characters; keep it private and store it in a password manager or provider secret input. On an existing deployment, reuse its configured signing secret instead of generating a replacement casually, since changing it revokes sessions.

Migrations must succeed before the API starts. If one fails, leave public deployment stopped and inspect the actual schema/migration records; MySQL DDL is not rolled back automatically. Do not rerun blindly after a partial initialization or delete existing tables.

For a **new installation only**, create the initial verified Administrator and the 15-category/11-department catalog:

```powershell
$env:BOOTSTRAP_ADMIN_NAME = Read-Host 'Administrator name'
$env:BOOTSTRAP_ADMIN_EMAIL = Read-Host 'Administrator institutional email'
$env:BOOTSTRAP_ADMIN_PASSWORD = Read-Host -MaskInput 'Unique strong Administrator password'
node apps/api/dist/apps/api/src/bootstrap.js
Remove-Item Env:BOOTSTRAP_ADMIN_NAME, Env:BOOTSTRAP_ADMIN_EMAIL, Env:BOOTSTRAP_ADMIN_PASSWORD
```

The email must be in `APPROVED_EMAIL_DOMAINS`. Bootstrap refuses when an Administrator already exists. **Do not run the demo seed**: it creates publicly known demo credentials and sample complaints.

Before putting credentials in Render, create a distinct runtime database user with only the application's data privileges. As the Aiven migration administrator, substitute a newly generated password in this SQL:

```sql
CREATE USER 'fixmycampus_app'@'%' IDENTIFIED BY 'REPLACE_WITH_A_NEW_RANDOM_PASSWORD';
GRANT SELECT, INSERT, UPDATE, DELETE ON fixmycampus.* TO 'fixmycampus_app'@'%';
```

Use this restricted user's connection URL as Render's `DATABASE_URL`. Keep the administrative URL for controlled future migrations. The server-only start command does not require runtime schema privileges. When finished with local administration, remove sensitive process variables or close the terminal:

```powershell
Remove-Item Env:DATABASE_URL, Env:DATABASE_SSL_CA, Env:JWT_SECRET, Env:NODE_ENV, Env:APP_URL, Env:APPROVED_EMAIL_DOMAINS
```

## 3. Deploy the API on Render Free

Connect the repository to Render and create a **Blueprint** from the root `render.yaml`. Inspect the plan before creating it: the configuration defines one Docker Web Service, **`fixmycampus-api`**, with `plan: free`, no paid database, and no persistent disk. If the repository is private, approve only the repository access you intend to grant. Do not paste secrets into the YAML.

Fill its secret environment inputs:

| Setting                                   | Value                                                                |
| ----------------------------------------- | -------------------------------------------------------------------- |
| `DATABASE_URL`                            | Restricted Aiven runtime user URL for `fixmycampus`                  |
| `DATABASE_SSL_CA`                         | Full Aiven CA PEM, with real line breaks or literal `\n` separators  |
| `JWT_SECRET`                              | Your unique 96-character hexadecimal signing secret                  |
| `APPROVED_EMAIL_DOMAINS`                  | Real institutional email domains                                     |
| `IMAGEKIT_PRIVATE_KEY`                    | ImageKit private API key                                             |
| `IMAGEKIT_URL_ENDPOINT`                   | Canonical endpoint, such as `https://ik.imagekit.io/your-account-id` |
| `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | Verified Brevo SMTP settings                                         |

The Blueprint sets `NODE_ENV=production`, `APP_URL=https://fixmycampus.pages.dev`, ImageKit storage, and Brevo port 2525. It builds with the root Dockerfile and starts only `node dist/apps/api/src/server.js`; migrations were deliberately completed first. Health checks use `/api/v1/health`.

Record Render's assigned **HTTPS service origin**, such as `https://fixmycampus-api-xxxx.onrender.com`, with no path. Open its `/api/v1/health` endpoint and require `{"status":"ok","database":"connected"}`. Health alone does not verify email or ImageKit. Do not use the backend's own frontend URL for normal sign-in: its configured application origin is the Pages hostname.

## 4. Configure Cloudflare Pages

Connect the same repository and set:

| Pages setting                   | Value                                                                       |
| ------------------------------- | --------------------------------------------------------------------------- |
| Project                         | `fixmycampus`                                                               |
| Production branch               | Your intended deployment branch                                             |
| Root directory                  | Repository root; leave blank                                                |
| Framework preset                | None                                                                        |
| Build command                   | `npm run build -w @fixmycampus/shared && npm run build -w @fixmycampus/web` |
| Build output directory          | `apps/web/dist`                                                             |
| Build environment               | `NODE_VERSION=24`                                                           |
| Production Function environment | `API_ORIGIN=https://YOUR_RENDER_SERVICE.onrender.com`                       |

`API_ORIGIN` is the backend HTTPS origin, without `/api` or any other path. It is a Pages Function environment variable, not a `VITE_*` variable. This repository manages the production value in `wrangler.jsonc` under `env.production.vars`; update that public origin when the API hostname changes, then redeploy. Wrangler configuration is the source of truth for Function settings. `.node-version` pins the build to Node 24. Never put database, JWT, ImageKit, or SMTP secrets into frontend environment variables. Pages needs only the API origin.

The root `functions/api/[[path]].ts` proxies `/api/*` to Render. Keep the build root at repository root so Pages discovers this function. Deploy through Git integration or a Functions-capable Wrangler deployment; uploading only the static `dist` directory through dashboard drag-and-drop omits the API function.

The browser continues calling `/api/v1` on the Pages origin. The proxy preserves the original `Origin`, cookies, Bearer authorization, CSRF header, multipart uploads, downloads, and separate `Set-Cookie` headers. This keeps secure refresh/CSRF cookies first-party; no frontend API URL or cross-origin cookie change is needed. API responses are not cached. Do not rewrite `Origin` to the Render hostname, set a cookie `Domain` to Render, or change cookies to `SameSite=None`.

Production mutations require the exact `APP_URL`. Preview Functions have no `API_ORIGIN` configured and return a controlled 503, so they cannot access the production database. Test the production Pages URL. Separate previews need their own explicitly configured backend.

## 5. Verify the complete application and maintain it

At `https://fixmycampus.pages.dev/api/v1/health`, require JSON showing a connected database. A static HTML response means the Function was not deployed or the path is wrong. A 503 indicating API hosting is not configured means `API_ORIGIN` is missing/invalid. A cold-start failure can require waiting for Render to wake and retrying; do not confuse a blank backend with a completed deployment.

Verify all of these from the Pages hostname:

- Administrator sign-in, page reload/session refresh, logout, and invalid-CSRF rejection. Confirm both auth cookies remain Secure and HttpOnly on the Pages hostname.
- Registration at an approved institutional domain, actual email delivery, verification, and password reset. Check Render's logs for SMTP connection/TLS failures and Brevo's transactional logs. This is the required live port-2525 check.
- Create operational accounts through registration and Administration, then report, triage, assign, resolve, reopen, and rate a complaint.
- Submit an anonymous confidential complaint; check identity masking and cross-department denial. Upload/download all three allowed file types, including resolution proof, and reject an unrelated account's private-file request.
- Export CSV/PDF, open a complaint's direct URL, and test mobile reporting. Confirm uploaded files and complaints survive an API redeploy.

Pages Functions consume Workers request quota; five-second polling can exhaust a free allowance with sustained usage. Render's free instance has 512 MB RAM, limited shared CPU, 750 instance-hours per workspace/month, no persistent disk, and no guaranteed uptime. Avoid concurrent heavy uploads/password hashing and measure actual capacity. Aiven's 1 GB database and ImageKit/Brevo quotas also bound this deployment. Provider policy or account verification can suspend service even where a free allowance is advertised.

For updates, apply new migrations locally against the intended production database before promoting code that needs them. Keep backups outside the database provider and back up authenticated attachment assets separately. Aiven's included backups are not proof of the project's 30-day retention or restore-time targets. Test recovery in a separate database; never restore over live data or run integration/browser fixture generation against this deployment. The Linux Compose backup helpers target the separate server-based deployment and do not automatically back up these managed services.

### Official references

- [Cloudflare Pages Functions routing](https://developers.cloudflare.com/pages/functions/routing/) and [platform limits](https://developers.cloudflare.com/pages/platform/limits/)
- [Render Free limitations and blocked SMTP ports](https://render.com/docs/free)
- [Aiven MySQL Free tier](https://aiven.io/docs/products/mysql/concepts/mysql-free-tier), [supported versions](https://aiven.io/docs/products/mysql/reference/version-lifecycle), and [service-user privileges](https://aiven.io/docs/products/mysql/howto/manage-service-users)
- [ImageKit private files and signed-URL security](https://imagekit.io/docs/media-delivery-basic-security) and [Free plan limits](https://imagekit.io/plans/)
- [Brevo SMTP setup and port 2525](https://developers.brevo.com/docs/smtp-integration) and [free transactional-email allowance](https://www.brevo.com/products/transactional-email/)
