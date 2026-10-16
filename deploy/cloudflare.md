# Permanent hosting with Cloudflare Tunnel

This deployment runs the compiled React app, Express API, background jobs, MySQL 8.4, and private attachments on an always-on Linux server. A named Cloudflare Tunnel publishes the complete application on your HTTPS hostname. It does not depend on a development laptop, Vite, or a temporary `trycloudflare.com` link. Cloudflare proxies the application; the server provides its compute and persistent storage.

## Prerequisites

- An always-on Linux server with Docker Engine and Docker Compose **2.24 or newer**, repository access, and enough disk for MySQL, uploads, and backups.
- A Cloudflare account with an active domain and permission to create a named Tunnel and its DNS record.
- A hostname such as `campus.example.edu`, your approved institutional email domains, and production SMTP credentials with a verified sender.
- A new deployment database, or a reviewed migration plan for an existing database. Keep existing local/demo volumes and unknown user data intact.

Use a single application instance. The database and application have no published host ports in this deployment. The tunnel is the public entry point; retain your server's administrative access and protect its secrets and backups.

All commands below run in Bash from the repository root on the server. Do not run the development `docker compose up` command for this deployment.

## Configure the hostname and production secrets

1. Clone the repository to the server, extract the supplied source archive, or update the existing deployment checkout after reviewing its local changes. Change to that repository directory.
2. Create the dedicated environment file without overwriting existing deployment secrets, and restrict its permissions:

   ```sh
   test -f deploy/.env.cloudflare || cp deploy/.env.cloudflare.example deploy/.env.cloudflare
   chmod 600 deploy/.env.cloudflare
   ```

3. Edit `deploy/.env.cloudflare`. Set `APP_URL` to the exact HTTPS origin, such as `https://campus.example.edu`, with no path. Supply distinct random MySQL passwords, a JWT signing secret of at least 48 random characters, approved institutional domains, and real SMTP configuration. Generate hex secrets with `openssl rand -hex 48`. Use hex database passwords so they can safely form the MySQL connection URL. Quote environment values containing spaces, `#`, or `$` according to Docker Compose environment-file syntax.
4. In the Cloudflare dashboard, open **Tunnels**, create a named **Cloudflared** tunnel, and copy its connector token into `TUNNEL_TOKEN` in the environment file. Keep the token private. Under the tunnel's **Routes**, add a **Published application** for your hostname with service URL **`http://app:3001`**. The hostname must match `APP_URL`. The `app` hostname is resolved inside this deployment's Docker network.

The production configuration uses persistent local attachment storage. Do not expose the upload volume as a public static directory. SMTP on port 465 normally uses `SMTP_SECURE=true`; for a provider's STARTTLS submission port, use that provider's settings. Mailpit and the development `campus.test` accounts are not used.

Select the production files for every command, including the existing backup helpers:

```sh
export COMPOSE_FILE="$PWD/deploy/compose.cloudflare.yml"
export COMPOSE_ENV_FILES="$PWD/deploy/.env.cloudflare"
export COMPOSE_PROJECT_NAME=fixmycampus-cloudflare
docker compose config --quiet
```

Repeat these exports in each new deployment/maintenance shell. `config --quiet` validates without printing resolved secrets. Keep the environment file outside source control.

## Build, migrate, and create the administrator

Build the existing source into the production image and start only the private database:

```sh
docker compose build app
docker compose up -d --wait mysql
docker compose run --rm --no-deps app node dist/apps/api/src/migrate.js
```

The database enables `log_bin_trust_function_creators` so the application-schema account can create the required integrity/audit triggers without global `SUPER` privileges. The app service starts only the server; migrations are an explicit deployment step. If a migration fails, inspect its error and database state before retrying. MySQL DDL is not transactional; never delete tables or migration records to hide an error.

On a **new installation only**, create the first verified Administrator and the 15-category/11-department catalog. The command refuses if an Administrator already exists. Supply an email in `APPROVED_EMAIL_DOMAINS` and a unique strong password:

```sh
read -r -p 'Administrator name: ' BOOTSTRAP_ADMIN_NAME
read -r -p 'Administrator email: ' BOOTSTRAP_ADMIN_EMAIL
read -r -s -p 'Administrator password: ' BOOTSTRAP_ADMIN_PASSWORD
printf '\n'
export BOOTSTRAP_ADMIN_NAME BOOTSTRAP_ADMIN_EMAIL BOOTSTRAP_ADMIN_PASSWORD
docker compose run --rm --no-deps \
  -e BOOTSTRAP_ADMIN_NAME -e BOOTSTRAP_ADMIN_EMAIL -e BOOTSTRAP_ADMIN_PASSWORD \
  app node dist/apps/api/src/bootstrap.js
unset BOOTSTRAP_ADMIN_NAME BOOTSTRAP_ADMIN_EMAIL BOOTSTRAP_ADMIN_PASSWORD
```

Do not run `db:seed` or `seed.js` on this deployment. Register further institutional accounts normally, then assign Campus Incharge and Department Officer roles through Administration.

## Start and verify global access

```sh
docker compose up -d --wait app
docker compose exec -T app node -e "fetch('http://127.0.0.1:3001/api/v1/health').then(async r=>{console.log(await r.text());if(!r.ok)process.exit(1)}).catch(e=>{console.error(e.message);process.exit(1)})"
docker compose up -d tunnel
docker compose ps
docker compose logs --tail=50 app tunnel
```

Open your configured HTTPS hostname from another network. Check the public database-readiness endpoint, replacing the example hostname:

```sh
curl --fail --show-error https://campus.example.edu/api/v1/health
```

It must return `{"status":"ok","database":"connected"}`. Sign in as the new Administrator. Verify registration and delivered verification/reset links, sign-out and reload, then create the required operational accounts. Exercise one normal complaint and one confidential anonymous complaint with the intended roles; verify private attachments cannot be downloaded by an unrelated account. Test an attachment near the supported size limit through the public hostname. Confirm SMTP delivery and that the SLA/email jobs continue running.

The tunnel and app restart with Docker after host restarts. Keep the host and Docker service running. Monitor `/api/v1/health`, tunnel status, application logs, storage space, SMTP delivery/backlog, and backup age. See [operations](../docs/operations.md) for retention and service targets. Cloudflare cache rules must not cache `/api/*`; the API already sends `Cache-Control: no-store`.

## Updates and backups

Use the same three Compose exports above. Before deploying changes, save a backup, review the new code/migrations, and rebuild. Pause the application while taking a backup or applying schema changes. The named volumes survive container replacement and ordinary shutdown.

For a consistent database-and-attachments backup, stop writes and restart the existing deployment even if the backup fails:

```sh
mkdir -p /srv/fixmycampus-backups
chmod 700 /srv/fixmycampus-backups
(
  set -e
  trap 'docker compose up -d app tunnel' EXIT
  docker compose stop tunnel app
  BACKUP_DIR=/srv/fixmycampus-backups bash scripts/backup.sh
)
```

The helper retains its timestamped archives for 30 days. Schedule this outside 09:00-21:00 IST and copy archives to separate protected storage. Backups contain private complaint information, reporter identities, and account hashes. A daily backup only provides the intended 24-hour RPO when successful and copied off the host.

To update after backup, review/pull the intended commit using your normal Git workflow, then:

```sh
docker compose build app
docker compose stop tunnel app
docker compose run --rm --no-deps app node dist/apps/api/src/migrate.js
docker compose up -d --wait app
docker compose up -d tunnel
```

If migration fails, leave the public tunnel stopped until the database and application are compatible. Recheck health and the sign-in/complaint workflow after deployment. Keep the prior image/commit and backup for a reviewed rollback; a Git rollback alone does not undo schema changes.

Restore drills use the **same production Compose file** with a separate project and named volumes:

```sh
RESTORE_PROJECT=fixmycampus-restore-cloudflare MYSQL_PORT=3307 \
  bash scripts/restore.sh /srv/fixmycampus-backups/fixmycampus-YYYYMMDDTHHMMSSZ.tar.gz
docker compose -p fixmycampus-restore-cloudflare ps
```

Replace the archive path with a real backup. `MYSQL_PORT=3307` satisfies the existing restore helper's non-live-port guard; this production Compose file publishes no database port. The helper starts only an isolated MySQL service and an upload extraction container, not a second app or public tunnel. Keep both stopped until restored counts/history/files are reviewed. For application validation, use an isolated hostname and captured SMTP so restored queued emails are not sent to real users. Do not point the live hostname at a restored database until the restore has been validated and cutover approved.

For normal shutdown, use `docker compose down`. **Do not add `-v`**, prune volumes, or delete the environment file: the named volumes hold the database/uploads and the environment file contains the credentials required to reopen them.

## Cloudflare references

- [Create a named Tunnel and published application route](https://developers.cloudflare.com/tunnel/get-started/)
- [Quick Tunnels are temporary testing/development links](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)
- [Cloudflare Tunnel configuration and replicas](https://developers.cloudflare.com/tunnel/configuration/)
