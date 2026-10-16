# Verification record

Measured locally on **16 October 2026 (IST)**. This records executed checks and their limits; the requirement matrix in `requirements.md` distinguishes automated evidence from deployment acceptance work.

## Functional checks

| Check                       | Observed result                                                                                                                                                 |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit/client suite           | **184/184 passed** across 11 files                                                                                                                              |
| Service coverage            | **92.73% lines/statements**, **93.46% branches**, **97.82% functions**; all configured 70% gates passed                                                         |
| Workspace checks            | TypeScript typecheck, production build, and Prettier format check passed                                                                                        |
| Compiled application        | Without Vite/tsx, smoke test returned SPA 200, JavaScript asset 200, and Administrator login 200                                                                |
| Production dependency audit | **0 vulnerabilities** after updating Nodemailer to 10.1.1                                                                                                       |
| Real MySQL integration      | **11/11 passed**, final run 6.18 seconds, dedicated disposable `fixmycampus_test` database                                                                      |
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

These browser tests used installed Chrome through `PLAYWRIGHT_CHANNEL=chrome`. They were run against the development SPA at port 5173 and API at port 3001. Mailpit captured messages locally; no external email recipients were contacted. Additional frontend review checked desktop/mobile screens, visible labels, status text, focus/contrast, and role-specific navigation. This does not replace a complete assistive-technology accessibility audit.

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

## Deployment work not certified by local tests

- Docker image/Compose launch and the backup/restore execution were not run because Docker was unavailable on the authoring host. The scripts received syntax review; a real isolated restore rehearsal remains required.
- Production TLS/certificates, real institutional SMTP, private Cloudinary credentials, and off-host backup storage were not configured. Local SMTP capture and local private files were exercised.
- A timed 10 MB submission, first-time-user 90-second usability study, full WCAG 2.1 AA audit, and sustained academic-term uptime have not been certified.
- Retention protections and backup policy are implemented/documented; 90-day notification history, 12-month audit retention, daily backup operation, RPO 24 hours, and RTO four hours require continued operational monitoring and a measured restore exercise.

## Cloudflare Pages deployment preparation — 16 October 2026

After adding the Pages API proxy, managed MySQL TLS, and private ImageKit storage, the full unit suite passes **232 tests**. The real local MySQL integration suite passes **11 tests**, including migration `004_imagekit_storage.sql`. The production build passes, and Cloudflare Wrangler **4.151.1** compiles the Pages Function successfully.

The new Aiven Free service was checked through verified TLS: MySQL **8.4.11**, binary logging enabled, and trusted trigger creators enabled. All four migrations and the initial administrator/catalog bootstrap succeeded. Its application account requires SSL and has only SELECT, INSERT, UPDATE, and DELETE privileges on the application database. No demo accounts or complaint data were seeded into this service.

Live ImageKit round trips passed for PNG (1,052 bytes), JPEG (2,721 bytes), and a valid PDF (10,484,730 bytes, 1,030 bytes below 10 MiB). Each file reported private metadata, returned byte-identical contents through the storage helper, and denied unsigned access with HTTP 403. Every synthetic fixture was deleted and confirmed absent. The check found that default ImageKit optimization altered JPEG evidence bytes; signed reads now explicitly request original delivery, covered by a regression assertion.

A two-second provider-signed URL returned HTTP 200 before expiry, remained accessible at approximately three seconds, and returned HTTP 403 at approximately thirteen seconds. This measures provider timing tolerance rather than strict second-level expiration. The application fetches its 60-second URLs server-side after authorization and never returns them to browsers.

These checks do not yet certify the complete public deployment or delivered production email. The free API host can sleep; background jobs and emergency notifications cannot satisfy continuous-service targets while it is asleep. See [the free hosting guide](../deploy/pages-free.md).
