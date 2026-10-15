# Requirement traceability and verification

Source: FixMyCampus SRS v1.0, September 2026. See `decisions.md` for the agreed 11-department amendment, supported stack updates, and anonymous identity interpretation. This is a checklist connecting requirements to code and verification; it is **not a blanket pass certificate**.

Verification keys:

- **A**: `auth-service.test.ts` / authentication API and MySQL integration scenarios.
- **W**: workflow, complaint service, storage, notifications, and reporting unit tests under `apps/api/src`.
- **I**: `tests/api.integration.test.ts`, requiring a separate `TEST_DATABASE_URL`.
- **B**: `tests/e2e/campus.spec.ts`, requiring a seeded running app and Chromium; captured-email scenario also requires `E2E_MAILPIT_URL`.
- **M**: manual/deployment exercise described in `demo.md` or `operations.md`; performance, external delivery, retention duration, WCAG conformance, and uptime cannot be certified by source inspection.

The exact executed commands, result counts, coverage, and environmental limitations belong in `verification.md`. A skipped scenario is pending, not passed. Unit tests exercise service logic with controlled dependencies; I tests validate actual MySQL transactions/triggers and HTTP authorization; B tests exercise actual browser forms.

| ID      | Requirement                                         | Implementation                                                   | Verification                                         |
| ------- | --------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------- |
| REQ-001 | Institutional registration and strong password      | Shared schemas; auth routes; registration page                   | A, I, B                                              |
| REQ-002 | Reject unapproved domains                           | Domain allowlist on server                                       | I                                                    |
| REQ-003 | Verification email and blocked unverified login     | Hashed single-use auth token; outbox                             | I, B with Mailpit; M real SMTP                       |
| REQ-004 | Hashed credentials and signed JWT                   | scrypt, JOSE, account-version checks                             | A, I                                                 |
| REQ-005 | Five failures lock for 15 minutes and email owner   | Transactional login counter/lock and outbox                      | A/I account scenarios; M SMTP                        |
| REQ-006 | Single-use 30-minute reset                          | Hashed reset tokens and revocation                               | A/I account scenarios; M email link                  |
| REQ-007 | View name/email/contact/role                        | Protected profile and account page                               | I API; M profile                                     |
| REQ-008 | Contact, affiliation, photo edits                   | Profile patch and private photo upload                           | I API; M photo round-trip                            |
| REQ-009 | Current password before change                      | Password verification and token-version increment                | A/I security scenarios                               |
| REQ-010 | Audit profile/password edits                        | Transactional immutable audit events                             | I trigger test; M profile audit                      |
| REQ-011 | Fifteen categories, one required                    | Shared catalog seed and complaint schema                         | I catalog and validation, B report                   |
| REQ-012 | Description >=15 and location                       | Client/server schemas                                            | W, I, B                                              |
| REQ-013 | Unique dated reference                              | IST day sequence transaction                                     | W, I eight concurrent submissions                    |
| REQ-014 | Submitted status and timestamp                      | Complaint transaction/history                                    | I; emergency then system assignment                  |
| REQ-015 | Optional anonymous sensitive report                 | Stable confidential category flag and mask                       | W, I, B                                              |
| REQ-016 | Invalid input gives field errors                    | Zod error envelope and form errors                               | I                                                    |
| REQ-017 | JPEG/PNG/PDF only                                   | Signature and MIME validation                                    | W, I spoofed upload                                  |
| REQ-018 | 10 MB/file and five total                           | Multer bounds and transaction count check                        | W, I 6-file/oversize boundaries                      |
| REQ-019 | Local or Cloudinary references                      | Private storage adapter and attachment metadata                  | I local; M credentialed Cloudinary                   |
| REQ-020 | Server MIME validation                              | Byte-signature/mimetype match                                    | W, I                                                 |
| REQ-021 | Reference/category/status/date tracking             | Authorized list and detail screens                               | I, B                                                 |
| REQ-022 | Timeline with actor role                            | Immutable status history and detail timeline                     | I history; B workflow                                |
| REQ-023 | Restricted sensitive case visibility                | Server complaint/attachment scope                                | W, I, B                                              |
| REQ-024 | Tracking updates in five seconds                    | TanStack Query polling visible views                             | B resolution update; M deployed timing               |
| REQ-025 | Incharge queue and anonymous masking                | Shared serialization, scoped queue                               | W, I, B                                              |
| REQ-026 | Verify or reasoned return/rejection                 | Workflow state machine and action route                          | W, I validation; B verify; M return                  |
| REQ-027 | Change priority before resolution                   | Workflow guard and cycle recalculation                           | W, I resolved guard                                  |
| REQ-028 | Assign/reassign verified cases                      | Department transaction and assignment chain                      | W, I, B; 11-department amendment                     |
| REQ-029 | SLA auto-escalation and alerts                      | Minute scanner with row locks/event keys                         | W, I concurrent scan                                 |
| REQ-030 | Configurable routing with override                  | Category mapping and Incharge department selector                | I, B; M routing edit                                 |
| REQ-031 | Alert all active assigned officers                  | Transactional recipient queries and outbox                       | W, I notification recipients; M SMTP                 |
| REQ-032 | Officer department boundary                         | Every action checks department and visibility                    | W, I cross-department action                         |
| REQ-033 | Full assignment chain                               | Assignment records with actor and timestamp                      | I, B timeline                                        |
| REQ-034 | Progress visible to reporter/Incharge               | Progress notes and timeline                                      | I, B                                                 |
| REQ-035 | Resolution proof uploads                            | Authorized proof uploads before resolution                       | W/I local files; M proof workflow                    |
| REQ-036 | Resolution summary >=10                             | Workflow guard and form constraint                               | W, I, B                                              |
| REQ-037 | Resolved immutability                               | Action/file guards and no delete API                             | W, I                                                 |
| REQ-038 | Owner reopen within 72h to Assigned                 | Time guard and new resolution cycle                              | W boundary; I 73-hour rejection; B reopen            |
| REQ-039 | Reporter notification per transition                | Transactional notifications                                      | W, I                                                 |
| REQ-040 | Verification/assignment/resolution/escalation email | Event templates and durable retry outbox                         | W/I enqueue; M real SMTP delivery                    |
| REQ-041 | Immediate assigned-officer alert                    | Assignment/critical recipients                                   | W, I; M delivery latency                             |
| REQ-042 | Individual/all notifications read                   | User-scoped read endpoint and controls                           | I/API; M notification UI                             |
| REQ-043 | Notification retention >=90 days                    | No automatic purge; operations policy                            | M retention monitoring                               |
| REQ-044 | Incharge real-time status counts                    | Scoped dashboard and five-second polling                         | W/I aggregates; M dashboard refresh                  |
| REQ-045 | Officer counts by priority                          | Department-scoped dashboard response                             | W/I role scope; M dashboard                          |
| REQ-046 | Admin volume/mean/median                            | Aggregate report service                                         | W numeric tests; M analytics                         |
| REQ-047 | Two-week department SLA flag                        | Completed IST weeks, normalized averages                         | W week-boundary tests                                |
| REQ-048 | Reference/description/permitted reporter search     | Parameterized scoped filters                                     | W, I search privacy; M combined search               |
| REQ-049 | Combined filters and date range                     | Server filter builder and queue controls                         | W, B queue; M filter combinations                    |
| REQ-050 | Search normal-load <2 seconds                       | Indexed queries and guarded load probe                           | M measured p95; no assumed pass                      |
| REQ-051 | No unauthorized anonymous search results            | Department scope before text matching                            | W, I                                                 |
| REQ-052 | Owner rating 1-5 after resolution                   | Shared schema and row-lock owner/state guard                     | I, B                                                 |
| REQ-053 | One immutable feedback                              | Unique complaint feedback constraint                             | I duplicate409; B read-only display                  |
| REQ-054 | Department rating aggregates                        | Resolving-department feedback snapshot and admin aggregate query | W/I rating survives reopen/reassignment; M dashboard |
| REQ-055 | Critical emergency categories                       | Stable emergency seed flags                                      | W, I, B                                              |
| REQ-056 | Simultaneous emergency routing bypass               | Create transaction and system assignment history                 | I, B                                                 |
| REQ-057 | Immediate critical in-app/email alert               | Transactional recipients and immediate outbox attempt            | W/I enqueue; M measured SMTP latency                 |
| REQ-058 | Critical first, red/text flagged                    | Server priority order and accessible badges                      | W, B critical view; M queue ordering                 |
| REQ-059 | Count reports with dates                            | Aggregated type/date report service                              | W/I; B report screen                                 |
| REQ-060 | Department SLA compliance                           | Snapshot-based report metrics                                    | W/I; M report result                                 |
| REQ-061 | CSV/PDF export                                      | Authorized export route, CSV injection mitigation, PDFKit        | W CSV; B downloads; M PDF visual check               |
| REQ-062 | Incharge category summary read-only                 | Server report-type/export restrictions                           | W/I authorization; M UI                              |
| REQ-063 | User search/role/deactivation                       | Admin user API, security-token revocation                        | Admin unit/API tests; M account UI                   |
| REQ-064 | Department CRUD/officer assignment                  | Active-dependency guards, officer invariant                      | Admin tests; B department create                     |
| REQ-065 | Category CRUD/routing                               | Stable codes and immutable security flags                        | Admin tests; B category create                       |
| REQ-066 | Per-priority SLA settings                           | Strict settings schema and snapshots                             | Admin tests; M settings                              |
| REQ-067 | Editable email templates                            | Existing-event plain-text templates persisted                    | Admin/W template tests; M SMTP render                |
| REQ-068 | Server-only Administrator management                | Auth middleware before all admin routes                          | Admin/I security tests                               |

## Non-functional acceptance

| Target                                             | Evidence/remaining exercise                                                      |
| -------------------------------------------------- | -------------------------------------------------------------------------------- |
| >=70% service coverage                             | `npm run test:coverage` threshold; preserve measured output                      |
| 500-user p95 reads <=2s                            | `scripts/load-test.mjs`, dedicated benchmark environment and hardware disclosure |
| 5,000 users / 10,000 complaints, <=20% degradation | Guarded `scripts/benchmark-data.mjs`, compare before/after probe                 |
| 10 MB submit <=5s                                  | Timed authenticated upload on deployment with realistic disk/network             |
| First-time report <90s                             | Timed student usability exercise, not an automated speed claim                   |
| TLS, secure cookies, SMTP/Cloudinary               | Production proxy and real provider validation                                    |
| WCAG 2.1 AA primary screens                        | Browser keyboard/mobile checks plus manual focus/contrast/screen-reader review   |
| Audit >=12 months / notifications >=90 days        | Database protections/no purge, retention monitoring and capacity planning        |
| Daily backup, 30-day retention, RPO24h/RTO4h       | Backup script plus isolated measured restore rehearsal                           |
| 99.5% uptime                                       | External monitoring across academic term; cannot be proven locally               |
