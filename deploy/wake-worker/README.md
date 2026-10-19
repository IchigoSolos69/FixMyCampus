# Scheduled health checks

This separate Cloudflare Worker runs every five minutes in Cloudflare, even when this computer is off. It requests three fixed, public targets concurrently:

| Target                                                    | What it checks                                     |
| --------------------------------------------------------- | -------------------------------------------------- |
| `https://fixmycampus-api-7e74.onrender.com/api/v1/health` | Render is awake and its MySQL `SELECT 1` succeeds. |
| `https://fixmycampus.pages.dev/api/v1/health`             | Pages can proxy to the API and connected database. |
| `https://fixmycampus.pages.dev/login`                     | The static React entry page is available.          |

Both API responses must be HTTP 200 JSON with `status: "ok"` and `database: "connected"`. The login response must be HTTP 200 HTML containing the application title and React root. This does not run JavaScript, submit registration forms, send email, or test private attachments. ImageKit and Brevo are managed APIs and need no idle wake calls. The API checks reach Aiven through the application's existing verified TLS connection; the Worker needs no credentials.

Each request has a 90-second deadline to allow an initial Render cold start. Redirects are rejected and requests bypass caching. One compact `service_health` log records status, elapsed milliseconds, and a safe failure code for each target. A failed check throws so Cloudflare records a failed cron invocation. No response bodies, tokens, passwords, or user information are logged. There is no public HTTP trigger or arbitrary proxy endpoint; `workers.dev` and preview URLs are disabled.

## Recovering a powered-off database

On 19 October 2026, the Aiven Free database was found **Powered off** and its hostname returned NXDOMAIN. Render could not resolve the database host, so API calls failed even after the Render instance woke. Recovery required **Power on service** in the Aiven Console; after restoration, API health returned HTTP 200 with a connected database.

Aiven documents that it may power off free services without continuing activity, but does not specify the inactivity threshold or guarantee that `SELECT 1` qualifies. These scheduled database checks provide activity on a best-effort basis. An HTTP request cannot restart an Aiven database that is already powered off, and this Worker intentionally has no Aiven administrative credentials.

If the database check fails with a hostname error, inspect the existing service's status in Aiven. If it is **Powered off**, open **Services → fixmycampus → Actions → Power on service**, wait until it is **Running**, then check both API health URLs again. Preserve the existing service and data; do not delete it or create a replacement database to resolve the outage. Aiven restoration may take minutes or longer. See [Aiven's free-tier activity policy](https://aiven.io/docs/products/mysql/concepts/mysql-free-tier) and [MySQL power-on and restoration procedure](https://aiven.io/docs/products/mysql/howto/power-cycle-service).

## Check and deploy

From the repository root, using Node.js 24:

```powershell
npm test -- tests/unit/wake-worker.test.ts
npm exec --yes --package=wrangler@4.151.1 -- wrangler deploy --config deploy/wake-worker/wrangler.jsonc --dry-run --outdir .runtime/wake-worker-build
```

To deploy, sign in to the intended Cloudflare account through Wrangler, then run:

```powershell
npm exec --yes --package=wrangler@4.151.1 -- wrangler login
npm exec --yes --package=wrangler@4.151.1 -- wrangler deploy --config deploy/wake-worker/wrangler.jsonc
```

The Worker is named `fixmycampus-wakeup`. Its separate configuration must be used: the repository-root `wrangler.jsonc` configures **Pages**, not this Worker. The configuration pins the intended Cloudflare account ID, so noninteractive deployments do not need to enumerate account memberships. An authorized deployment token can be limited to that account's **Workers Scripts: Edit** and **Account Settings: Read** permissions. Keep such a token in the provider's secret input; never add it to this configuration or source code. The Worker runtime has no paid bindings, storage, secret environment variables, or other provisioned resources. Keep the account on Workers Free. Do not enable a paid plan to complete this setup.

Alternatively, use Cloudflare's Worker editor to deploy `index.mjs` as an ES module named `fixmycampus-wakeup`, disable public `workers.dev` and preview URLs, enable Workers Logs, and add one Cron Trigger for every five minutes. The schedule is managed in `wrangler.jsonc` for subsequent CLI deployments. Cron changes can take up to 15 minutes to propagate. Review **Workers & Pages → fixmycampus-wakeup → Observability** for actual scheduled invocations and all three successful checks; a dry run or successful upload alone does not prove the schedule ran.

For local runtime testing:

```powershell
npm exec --yes --package=wrangler@4.151.1 -- wrangler dev --config deploy/wake-worker/wrangler.jsonc --test-scheduled
```

In another terminal, request `http://localhost:8787/__scheduled?cron=%2A%2F5%20%2A%20%2A%20%2A%20%2A`. This invokes the scheduled handler and makes real health requests to the three public targets. Normal HTTP requests return 404. Remove the Cron Trigger, or set `triggers.crons` to an empty array and redeploy, to stop scheduled checks.

## Free-tier limits

The schedule makes 288 invocations and 864 outbound checks per day, including 288 Pages Function calls. Each run uses three simultaneous connections. These are below Cloudflare Free's per-invocation subrequest/connection limits, but all other account traffic shares its quotas. Confirm actual CPU usage in Observability; Workers Free allows 10 ms of CPU per cron invocation, while network wait does not count toward CPU time. Each invocation can wait up to 15 minutes; this code stops its requests after 90 seconds.

Continuous traffic keeps the Render instance using its monthly hours. Render provides **750 free instance-hours per workspace per calendar month**, shared by all free services. One continuously running instance uses at most 744 hours in a 31-day month; additional services or overlapping activity can exhaust the allowance. Quota exhaustion, provider policy, maintenance, restarts, or a suspended database can still interrupt service. These checks reduce idle cold starts; **they do not guarantee permanent availability or repair a provider outage**. Monitor the actual account usage and retain the application's backup procedure.

Official references: [Cloudflare Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/), [scheduled handlers](https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), and [Render Free limitations](https://render.com/docs/free).
