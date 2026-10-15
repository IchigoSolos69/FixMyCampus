# API contract

Base path: `/api/v1`. JSON request/response objects use camelCase. Successful responses are returned directly, without a `data` envelope. Errors use `{ "error": { "code": "...", "message": "...", "fields": { "field": ["message"] } } }`; `fields` is present for field-validation failures. Common statuses are 401 (authentication), 403 (permission), 404 (missing or inaccessible case), 409 (state/version conflict), and 422 (validation).

Use `Authorization: Bearer <accessToken>` for protected calls. Access tokens are held only in browser memory. Login/refresh return `{user, accessToken, csrfToken}` and set HttpOnly refresh and CSRF cookies. Cookie refresh/logout require the configured `Origin` and matching `X-CSRF-Token`; the browser first obtains a CSRF token from `/auth/csrf` when restoring a session. Browser writes use the application origin. Tokens expire after 60 minutes; password changes, role/department/security changes, and deactivation invalidate old tokens through an account version check.

## Authentication and profile

| Method/path                  | Request                               | Result                                                |
| ---------------------------- | ------------------------------------- | ----------------------------------------------------- |
| GET `/health`                | Public                                | API/database status; 503 if database unavailable      |
| GET `/auth/csrf`             | Public                                | `{csrfToken}` plus HttpOnly CSRF cookie               |
| POST `/auth/register`        | `{name,email,password}`               | 201 message; sends verification; creates Student only |
| POST `/auth/verify-email`    | `{token}`                             | Message; token is single use                          |
| POST `/auth/login`           | `{email,password}`                    | Authentication response                               |
| POST `/auth/forgot-password` | `{email}`                             | Generic message, whether account exists or not        |
| POST `/auth/reset-password`  | `{token,password}`                    | Message; single-use 30-minute reset                   |
| POST `/auth/refresh`         | Cookie, Origin, CSRF header           | New authentication response                           |
| POST `/auth/logout`          | Cookie, Origin, CSRF header           | Message; invalidates account tokens                   |
| GET `/auth/me`, `/profile`   | Bearer                                | Current public user                                   |
| PATCH `/profile`             | `{name?,contactNumber?,affiliation?}` | Updated user; email and role cannot be edited here    |
| POST `/profile/password`     | `{currentPassword,newPassword}`       | Message; sign in again                                |
| POST `/profile/photo`        | Multipart `photo` JPEG/PNG            | Updated user                                          |
| GET `/profile/photo`         | Bearer                                | Own private photo                                     |

Passwords require 12-128 characters with uppercase, lowercase, a number, and a symbol. Five consecutive failed logins lock the account for 15 minutes. Institutional domains come from `APPROVED_EMAIL_DOMAINS`. Verification links expire after 24 hours.

## Complaints

| Method/path                        | Request/result                                                                                                                   |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| GET `/catalog`                     | Active `{categories,departments}` with stable category codes, default routing, emergency/confidential flags                      |
| GET `/complaints`                  | `{items,total,page,pageSize}`; authorized cases only                                                                             |
| POST `/complaints`                 | JSON or multipart `{categoryId,description,location,anonymous?}`; optional repeated multipart `files`; 201 full complaint detail |
| GET `/complaints/:id`              | Full detail: timeline `history`, `notes`, `attachments`, `assignments`, immutable `feedback`                                     |
| POST `/complaints/:id/actions`     | Action request below; updated full detail                                                                                        |
| POST `/complaints/:id/attachments` | Multipart repeated `files`, `kind=report                                                                                         | proof`; updated full detail |
| GET `/attachments/:id`             | Authorized private download, never public static storage                                                                         |
| POST `/complaints/:id/feedback`    | `{rating:1..5,comment?:string}`; 201 full detail; owner, resolved, once only                                                     |

List filters combine `q`, `categoryId`, `departmentId`, `status`, `priority`, `from`, `to`, `page`, and `pageSize` (maximum 100). Dates use `YYYY-MM-DD`; the date range includes both selected dates in IST. Results put Critical first, then High/Medium/Low. Reporter-name search does not reveal anonymously submitted identities.

Action body: `{action,version?,reason?,departmentId?,priority?,note?,summary?,description?,location?}`. Sending the current `version` detects a concurrent update with 409. The server always locks the complaint and checks role, department, and current status.

| Action             | Authorized actor | Required data/behavior                                                            |
| ------------------ | ---------------- | --------------------------------------------------------------------------------- |
| `verify`           | Incharge         | Submitted to Verified                                                             |
| `return`, `reject` | Incharge         | `reason`; permitted triage state                                                  |
| `assign`           | Incharge         | Active `departmentId`; Verified/Assigned/In Progress to Assigned; preserves chain |
| `priority`         | Incharge         | `priority`; emergency categories remain Critical                                  |
| `start`            | Assigned officer | Assigned to In Progress                                                           |
| `progress`         | Assigned officer | Nonempty `note`                                                                   |
| `resolve`          | Assigned officer | `summary` at least 10 characters; Assigned/In Progress to Resolved                |
| `reopen`           | Reporter         | `reason`, within 72 hours after resolution; Assigned with a new SLA cycle         |
| `escalate`         | Incharge         | `reason`; oversight notification                                                  |
| `resubmit`         | Reporter         | Returned only; corrected `description`/`location`; category remains unchanged     |

Descriptions require at least 15 characters; location and one category are required. Uploads require matching MIME and file signature: JPEG, PNG, PDF; maximum 10 MB each and five total across original reports and proof. Add report files while Returned; add proof while Assigned/In Progress before resolving. Emergency submissions pass through Submitted history then immediate system assignment. Anonymous reporting is available only for Mental Health and Anti-Ragging. Unauthorized case reads return 404, including attachment reads.

## Notifications, dashboards, and reports

| Method/path                              | Behavior                                                                                              |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| GET `/notifications`                     | `{items,unread}` for current user; latest 100 notifications                                           |
| POST `/notifications/read`               | `{id}` marks one; `{}` marks all owned notifications read                                             |
| GET `/dashboard`                         | Role-filtered counts, priority/status groups, resolution metrics, department aggregates, recent cases |
| GET `/reports?type=category              | department                                                                                            | status                                  | sla&from=...&to=...` | Report `{type,from,to,rows}`; Administrator full reports; Incharge category summary |
| GET `/reports/export?type=...&format=csv | pdf&from=...&to=...`                                                                                  | Administrator only; attachment download |

Admin confidential case details are excluded from complaint access. Dashboard/report aggregates include confidential cases without descriptions or reporter identities. SLA compliance uses retained resolution-cycle deadlines. Department flags require average normalized resolution time above 1.0 in each of the two preceding completed IST calendar weeks.

## Administration

Every `/admin` route requires Administrator on the server.

| Method/path                           | Request/result                                                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| GET `/admin/users?q=&page=&pageSize=` | Paginated public users                                                                                             |
| PATCH `/admin/users/:id`              | `{name?,role?,active?,departmentId?}`; officer requires one active department; last active Administrator protected |
| GET `/admin/departments`              | `{items}` including inactive departments                                                                           |
| POST `/admin/departments`             | `{name}`                                                                                                           |
| PATCH `/admin/departments/:id`        | `{name?,active?}`; deactivation blocked while officers, mappings, or open cases depend on it                       |
| GET `/admin/categories`               | `{items}` including inactive categories                                                                            |
| POST `/admin/categories`              | `{name,departmentId}`; creates ordinary category                                                                   |
| PATCH `/admin/categories/:id`         | `{name?,departmentId?,active?}`; security/emergency flags remain stable                                            |
| GET `/admin/settings`                 | `{sla:{Low,Medium,High,Critical},emailTemplates:[{event,subject,body}]}`                                           |
| PUT `/admin/settings`                 | Same shape; SLA whole hours 1-8760; existing template event names                                                  |

Template variables include `{{name}}`, `{{email}}`, `{{reference}}`, `{{message}}`, `{{url}}`, and `{{minutes}}` where supplied by the event. Templates are plain-text email. Defaults are Low 168h, Medium 72h, High/Critical 24h. Changes apply to new resolution cycles; explicit priority changes recalculate the current deadline from that cycle's original start.
