# FixMyCampus architecture

The browser uses a versioned Express JSON API and Bearer access JWTs. The API uses parameterized MySQL queries and transactions. Private files are streamed only after complaint authorization. A transactional outbox separates successful complaint writes from SMTP delivery. The API process runs the outbox and SLA workers; database locking prevents duplicate job effects.

## Use cases

```mermaid
flowchart LR
  Student --> Report[Report and track issue]
  Faculty --> Report
  Staff --> Report
  Student --> Feedback[Rate resolved issue]
  Faculty --> Feedback
  Staff --> Feedback
  Incharge[Campus Incharge] --> Triage[Verify, return, reject, prioritize]
  Incharge --> Assign[Assign, reassign, escalate]
  Officer[Department Officer] --> Work[Post progress and resolve assigned issue]
  Administrator --> Manage[Manage users, routing, SLA, templates]
  Administrator --> Reports[Analytics and reports]
  Incharge --> Summary[Read category summary]
```

## Entity relationships

Roles are constrained values on users, not a separate mutable role table. All times are UTC. Complaint references use the IST submission date.

```mermaid
erDiagram
  DEPARTMENTS ||--o{ USERS : employs
  DEPARTMENTS ||--o{ CATEGORIES : routes
  USERS ||--o{ COMPLAINTS : reports
  CATEGORIES ||--o{ COMPLAINTS : classifies
  DEPARTMENTS ||--o{ COMPLAINTS : owns
  COMPLAINTS ||--o{ ATTACHMENTS : contains
  COMPLAINTS ||--o{ STATUS_HISTORY : records
  COMPLAINTS ||--o{ ASSIGNMENT_HISTORY : routes
  COMPLAINTS ||--o{ PROGRESS_NOTES : describes
  COMPLAINTS ||--|{ RESOLUTION_CYCLES : measures
  COMPLAINTS ||--o| FEEDBACK : receives
  DEPARTMENTS ||--o{ FEEDBACK : rated_at_resolution
  USERS ||--o{ NOTIFICATIONS : receives
  USERS ||--o{ EMAIL_OUTBOX : receives
  USERS ||--o{ AUDIT_EVENTS : performs
```

SLA setting values are copied into each resolution cycle, rather than linked by a foreign key, so later configuration edits do not rewrite historical deadlines.

## Service responsibilities

The implementation uses TypeScript modules with exported functions; this responsibility diagram does not imply class instances or an ORM.

```mermaid
classDiagram
  class Routes {
    validateRequest()
    requireAuthentication()
    requireRole()
  }
  class AuthService {
    register()
    login()
    refresh()
    resetPassword()
  }
  class ComplaintService {
    createComplaint()
    getComplaint()
    applyAction()
    addFeedback()
  }
  class Workflow {
    authorizeAction()
    nextStatus()
    calculateDeadline()
  }
  class NotificationService {
    enqueueNotification()
    deliverOutbox()
    scanSlaBreaches()
  }
  class ReportingService {
    dashboard()
    generateReport()
    exportReport()
  }
  class Database {
    parameterizedQueries()
    transaction()
  }
  Routes --> AuthService
  Routes --> ComplaintService
  Routes --> ReportingService
  ComplaintService --> Workflow
  ComplaintService --> NotificationService
  AuthService --> Database
  ComplaintService --> Database
  NotificationService --> Database
  ReportingService --> Database
```

## Ordinary complaint sequence

```mermaid
sequenceDiagram
  actor Reporter
  participant Web
  participant API
  participant DB as MySQL
  actor Incharge
  actor Officer
  participant Worker
  Reporter->>Web: Submit category, location, description, files
  Web->>API: POST complaints (Bearer JWT)
  API->>DB: Transaction: sequence, complaint, cycle, history, outbox
  DB-->>API: Commit
  API-->>Web: Reference and Submitted detail
  Worker->>DB: Claim pending outbox
  Worker-->>Reporter: SMTP notification
  Incharge->>API: Verify then assign department
  API->>DB: Transaction: authorization, history, assignment, alerts
  Officer->>API: Start, progress, resolution summary/proof
  API->>DB: Transaction: resolve cycle, complaint, history, alerts
  Web->>API: Poll detail and notifications every 5 seconds
  API-->>Web: Resolved timeline
  Reporter->>API: Submit immutable rating once
```

## Workflow activity

```mermaid
flowchart TD
  Login[Authenticate and verify account] --> Submit[Submit valid report]
  Submit --> Emergency{Emergency category?}
  Emergency -->|Yes| Critical[Critical priority and immediate assignment]
  Emergency -->|No| Submitted
  Submitted --> Verify{Incharge decision}
  Verify --> Verified
  Verify --> Returned
  Returned -->|Reporter corrects| Submitted
  Verify --> Rejected
  Verified --> Assigned
  Critical --> Assigned
  Assigned --> Progress[In Progress]
  Progress --> Resolved
  Resolved --> Rating[One immutable feedback]
  Resolved --> Window{Reporter reopens within 72 hours?}
  Window -->|Yes: new SLA cycle| Assigned
  Assigned --> Breach{SLA overdue?}
  Progress --> Breach
  Breach -->|Once per cycle| Escalated[Alert Incharge and Administrator]
```

## Context and data flow

```mermaid
flowchart LR
  Reporter -->|Details, files, feedback| Reporting
  Reporting -->|Own timeline, alerts| Reporter
  Incharge -->|Verification and routing| Triage
  Triage -->|Queues and SLA alerts| Incharge
  Officer -->|Progress and resolution proof| Resolution
  Resolution -->|Assigned department queue| Officer
  Admin[Administrator] -->|Accounts and configuration| Administration
  Administration -->|Redacted analytics and reports| Admin
  Reporting <--> Data[(MySQL)]
  Triage <--> Data
  Resolution <--> Data
  Administration <--> Data
  Reporting <--> Files[(Private file store)]
  Resolution <--> Files
  Data --> Outbox[Transactional outbox]
  Outbox --> SMTP[SMTP relay]
```

## Privacy and correctness boundaries

- Students, Faculty, and Staff see their own complaints. Officers see their assigned department. Incharge handles triage. Administrators receive aggregate confidential information rather than confidential case details.
- Mental Health and Anti-Ragging reporter names are hidden only when the reporter selects anonymous submission. Authentication and internal ownership remain intact. Descriptions and uploaded file contents are authored by the reporter and may themselves contain identity details.
- Read authorization applies consistently to detail, list/search, attachment streams, notifications, dashboards, and exports. Client-side hiding is never the authorization boundary.
- History, prior resolution proof, assignment history, audit records, and historical SLA snapshots are retained. Complaint deletion is not exposed. Reopening creates a new cycle and does not erase previous resolution data.
- Supported deployment is one campus and one application instance. Local files must be shared or replaced with private Cloudinary storage before adding replicas. Production TLS and SMTP delivery depend on deployment configuration.
