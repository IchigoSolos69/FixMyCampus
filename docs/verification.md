# Verification record

Measured locally and against the public deployment on **16 and 19 October 2026 (IST)**. This records executed checks and their limits; the requirement matrix in `requirements.md` distinguishes automated evidence from deployment acceptance work. The later recovery checks appear in the final section.

## Functional checks

| Check                       | Observed result                                                                                                                                                 |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit/client suite           | **235/235 passed** in the latest full run, including Pages proxy and private ImageKit coverage                                                                  |
| Service coverage            | **92.73% lines/statements**, **93.46% branches**, **97.82% functions**; all configured 70% gates passed                                                         |
| Workspace checks            | TypeScript typecheck, production build, and Prettier format check passed                                                                                        |
| Compiled application        | Without Vite/tsx, smoke test returned SPA 200, JavaScript asset 200, and Administrator login 200                                                                |
| Production dependency audit | **0 vulnerabilities** after updating Nodemailer to 10.1.1                                                                                                       |
| Real MySQL integration      | **11/11 passed** against real local MySQL, including the ImageKit storage migration                                                                             |
| Chrome browser scenarios    | **6/6 passed**, final run 23.6 seconds, real API, Vite, MySQL, and Mailpit                                                                                      |
| PDF export                  | Actual department report downloaded, text extracted with pypdf, rendered using Poppler, and visually inspected: legible one-page report, no clipping or overlap |
| Script syntax               | Both Node benchmark scripts parsed successfully; Bash `-n` accepted backup and isolated-restore helpers                                                         |
| Benchmark safety guards     | Three unit checks passed: missing generation opt-in, ordinary database rejection, and missing explicit probe target                                             |
| Requirement checklist       | All 68 unique REQ IDs present in order                                                                                                                          |

The integration run validated institutional registration, unverified-login blocking, single-use verification, account lockout/expiry, reset expiry/reuse protection, profile/photo auditing, current-password verification, token revocation, eight simultaneous unique references, role/department boundaries, complaint transitions, immutable feedback, reopening limits, assignment history, private attachment access, spoofed MIME rejection, six-file/10 MB boundaries, concurrent SLA escalation deduplication, immutable audit/history triggers, notification ownership, report authorization, CSV/PDF exports, administrator invariants, and feedback attribution after reopening/reassignment. A regression also verifies MySQL connections use UTC sessions; driver-side date conversion alone is insufficient for SQL timestamp defaults.

The six browser scenarios exercised:

1. Student reporting, Incharge verification/assignment, officer progress/resolution, then Student feedback and reopening.
2. Critical anonymous Mental Health routing with handler identity masking.
3. Dedicated urgent reporting limited to four emergency categories, including immediate Medical assignment.
4. Keyboard input and reporting layout at 390-pixel mobile width without document overflow.
5. Administrator department/category creation and actual CSV/PDF downloads.
6. Registration, receipt of captured verification email, verification, and successful login using the updated SMTP library.

These browser tests used installed Chrome through `PLAYWRIGHT_CHANNEL=chrome`. They were run against the development SPA at port 5173 and API at port 3001. Mailpit captured messages locally; those local runs contacted no external email recipients. Additional frontend review checked desktop/mobile screens, visible labels, status text, focus/contrast, and role-specific navigation. This does not replace a complete assistive-technology accessibility audit.

## Read-path capacity measurement

Environment: Windows on an **Intel Core i7-14650HX**, Node.js **24.11.1**, MySQL **8.4.10**, a 12-connection application pool, and a 128 MB MySQL buffer pool. These are local measurements under the available host workload, not a hardware-independent production capacity guarantee. The probe performs 2,000 complaint-list requests with 500 concurrent workers sharing one authenticated Campus Incharge account; it does not model 500 distinct logins, network clients, or all application endpoints.

| Warm paired runs | Baseline p95 (ms) | 10,007-complaint p95 (ms) |
| ---------------- | ----------------: | ------------------------: |
| 1                |               689 |                       806 |
| 2                |               528 |                       733 |
| 3                |               742 |                       733 |
| Median of three  |           **689** |                   **733** |

The larger database held **5,016 users and 10,007 complaints** after synthetic generation. Every paired run completed without request failures. Median p95 increased **6.4%**, below the SRS's 20% degradation threshold for this measured read path; both medians were below the two-second target. An earlier optimized scaled run recorded p50 **671 ms**, p95 **1,057 ms**, p99 **1,129 ms**, zero failures, and 3.01 seconds total for the 2,000 requests.

The first unoptimized large-data run failed: p95 approximately **10,107 ms** and **664 timeouts**. Investigation found the list query joining all matching complaints before sorting/limiting. The implementation now selects the ordered page of complaint IDs before joining detailed rows, supported by queue indexes. The successful results above are from that final approach. The initial cold/warm comparison is not used to establish the 20% result; the paired warm runs are reported separately.

Reproduce using the guarded commands in `operations.md`. Record host hardware, concurrent workloads, warm-up procedure, and raw outputs when repeating these measurements. Measure filtered keyword searches, mixed-role traffic, uploads, SMTP outages, and production network latency separately.

## Deployment limits and remaining acceptance work

- Local Docker/Compose launch and backup/restore execution were not run because Docker was unavailable on the authoring host. Render successfully built and launched the API's Docker image. The backup scripts received syntax review; a real isolated restore rehearsal remains required.
- Public HTTPS, verified MySQL TLS, private ImageKit storage, and Brevo SMTP are configured and checked below. Off-host backup storage is not configured; the optional Cloudinary provider was not exercised in production.
- Production capacity, cold-start delays, sustained uptime, and recovery times have not been measured. The 500-worker results above describe the local read path and do not establish capacity on the free hosting services.
- A timed 10 MB submission, first-time-user 90-second usability study, full WCAG 2.1 AA audit, and sustained academic-term uptime have not been certified.
- Retention protections and backup policy are implemented/documented; 90-day notification history, 12-month audit retention, daily backup operation, RPO 24 hours, and RTO four hours require continued operational monitoring and a measured restore exercise.

## Public deployment verified — 16 October 2026

The public application at [fixmycampus.pages.dev](https://fixmycampus.pages.dev) and the Render API at [fixmycampus-api-7e74.onrender.com](https://fixmycampus-api-7e74.onrender.com) each returned HTTP 200 from `/api/v1/health`, reported a connected database, and sent `Cache-Control: no-store`. The deployed API revision was `5f07bae`.

After adding the Pages API proxy, managed MySQL TLS, private ImageKit storage, and the production configuration guard, the full unit suite passes **235 tests**. The real local MySQL integration suite passes **11 tests**, including migration `004_imagekit_storage.sql`. The production build passes, and Cloudflare Wrangler **4.151.1** compiles the Pages Function successfully. The Docker runtime defaults to production; a missing database URL fails immediately instead of connecting to the development database.

The new Aiven Free service was checked through verified TLS: MySQL **8.4.11**, binary logging enabled, and trusted trigger creators enabled. All four migrations and the initial administrator/catalog bootstrap succeeded. Its application account requires SSL and has only SELECT, INSERT, UPDATE, and DELETE privileges on the application database. No demo accounts or complaint data were seeded into this service.

Live ImageKit round trips passed for PNG (1,052 bytes), JPEG (2,721 bytes), and a valid PDF (10,484,730 bytes, 1,030 bytes below 10 MiB). Each file reported private metadata, returned byte-identical contents through the storage helper, and denied unsigned access with HTTP 403. Every synthetic fixture was deleted and confirmed absent. The check found that default ImageKit optimization altered JPEG evidence bytes; signed reads now explicitly request original delivery, covered by a regression assertion.

A two-second provider-signed URL returned HTTP 200 before expiry, remained accessible at approximately three seconds, and returned HTTP 403 at approximately thirteen seconds. This measures provider timing tolerance rather than strict second-level expiration. The application fetches its 60-second URLs server-side after authorization and never returns them to browsers.

The production API smoke check signed in as the existing Administrator through the Pages proxy. Both refresh and CSRF cookies were separate, host-only cookies with `Secure`, `HttpOnly`, `SameSite=Strict`, and the `/api/v1/auth` path. The catalog returned **15 categories and 11 departments**. The Administrator dashboard returned 11 department aggregates and no recent complaint details. Category, department, status, and SLA reports returned HTTP 200. CSV and PDF exports returned HTTP 200 with the expected content types and no-store headers; the PDF had a valid `%PDF-` signature. Reports were empty because no production complaints had been created.

Live browser checks restored the Administrator session after a page reload. People and access listed one active Administrator. Category settings displayed all 15 expected department routes with the appropriate Critical and Confidential badges. The reports screen loaded with enabled CSV/PDF export controls and the correct zero-complaint empty state.

Negative production checks returned HTTP **403** for refresh from an untrusted origin, **401** for an unauthenticated complaint queue request, and **422** for registration outside the approved institutional domain. A read-only database query confirmed that the rejected registration created no user.

With explicit approval, exactly **one** password-reset request was submitted for the existing Administrator. Verified TLS database queries found exactly one new reset outbox row, marked sent after **one attempt**, with no stored error: Brevo SMTP accepted the message. Brevo's transactional email logs subsequently showed both **Sent** and **Delivered** events for that same message on 16 October 2026. The recipient's mailbox view or reading of the message was not independently verified. No reset link was opened during these checks, and the password and account token version remained unchanged. User, complaint, and attachment counts remained **1, 0, and 0**; no demo users or complaints were created by these checks.

These checks establish public connectivity and the tested production paths; they do not certify sustained availability or all workflows under production load. The free API host can sleep; background jobs and emergency notifications cannot satisfy continuous-service targets while it is asleep. See [the free hosting guide](../deploy/pages-free.md).

## Recovery and endpoint recheck — 19 October 2026

The Aiven database was powered off and its hostname returned NXDOMAIN. The API could not pass its database health check. Powering on the existing Free service restored the database and hostname without creating a replacement service. After recovery, the Pages and direct Render `/api/v1/health` endpoints returned HTTP **200**, with the database connected, in **594 ms** and **582 ms** respectively. The updated frontend, revision `bf657fb`, is served by Pages with bundle `index-BTH9mVXP.js`; the login form was visibly present during its initial session check and usable afterwards. The five-minute Cloudflare wake Worker was deployed as version `e98001fd-fc8f-47d3-83ea-37f1b47a314d`; actual scheduled execution was still being checked when this record was written.

| Check                      | Observed result                                                                                                                                                      |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Current unit suite         | **255/255 passed**                                                                                                                                                   |
| Workspace checks           | TypeScript typecheck and production build passed                                                                                                                     |
| Isolated MySQL integration | **11/11 passed in 8.65 seconds**, using MySQL **8.4.10** and a new disposable local test database; migrations 001–004 applied                                        |
| Production HTTP requests   | **63 requests**: **62 expected results**, one stored bootstrap password declined with HTTP 401, **zero unexpected failures**, and **zero 5xx/unavailable responses** |
| Authenticated read checks  | **33 GET requests and 11 additional assertions**, all **44 checks passed**                                                                                           |
| Measured request latency   | Median **594 ms**, range **241–3,421 ms**, across these sequential smoke requests; the slowest was the declined password request                                     |
| Provider connectivity      | Brevo authenticated STARTTLS verification and ImageKit authenticated folder listing passed; no email was sent and no asset was changed                               |

The initial run contained **32 checks**: 30 HTTP requests and two database diagnostic assertions. Thirty-one checks passed; the old bootstrap credential returned HTTP 401 once and was not retried. The subsequent authenticated run contained **44 checks**: 33 HTTP requests and 11 response-body, configuration, and unchanged-state assertions. These totals explain the difference between **76 checks** and **63 HTTP requests**. An authorized, memory-only access token with a two-minute expiry was used exclusively for the authenticated GET checks. The current human password and browser cookie renewal were not verified in this recheck.

The live checks reached authentication/CSRF validation, catalog, profile, complaint queues and combined filters, private complaint/attachment lookup, notifications, dashboards, and all administration read resources. All four report types and their eight CSV/PDF exports returned HTTP 200; export bodies and no-store headers were checked. Invalid dates, pagination, tokens, JSON, institutional domains, missing authentication, and missing CSRF returned their expected 400/401/403/404/422 errors. Successful production mutations were not exercised. Account creation, verification/reset, role permissions, complaint lifecycle, attachments, notification ownership, SLA jobs, and administrative invariants were exercised by the isolated integration suite.

The address reported for the failed registration was absent from the restored database and had no associated verification outbox row. The database contained two verified accounts, no complaints or attachments, and two previously sent outbox messages with no pending messages or stored delivery errors. The GET checks left those records and the Administrator's password, token version, and login-failure state unchanged. No production account, complaint, attachment, or email was created by this recheck.

Wake requests remain best effort. [Aiven's MySQL Free-tier documentation](https://aiven.io/docs/products/mysql/concepts/mysql-free-tier) permits inactivity power-off and excludes the service from its availability SLA; it does not specify a MySQL inactivity threshold or guarantee that `SELECT 1` prevents power-off. An HTTP wake request cannot power on an already stopped database. Scheduled execution and sustained availability were not yet verified by this recheck.
