# SRS decisions and amendments

Source: user-provided **FixMyCampus_SRS.pdf**, version 1.0, September 2026, requirements REQ-001 through REQ-068. The source PDF is not copied into the repository. The user's accepted implementation plan resolves ambiguities as follows.

| Subject                 | Agreed implementation                                                                                                                                                                                                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Department count        | **11 departments**, derived from the user's category/department list, replaces the SRS's ten. The initial category count remains 15.                                                                                                                                                       |
| Technology versions     | Current supported Node 24, React 19, Express 5, MySQL 8.4 replace the SRS's older Node 18 / React 18 / Express 4 versions while retaining its fixed stack. The lockfile is the exact version authority.                                                                                    |
| Confidential identity   | The SRS section 2.5 blanket masking statement conflicts with REQ-025 and business rules. Identity is hidden in handling views only when anonymous submission is selected; confidential case visibility is always restricted.                                                               |
| Sensitive categories    | Mental Health and Anti-Ragging are confidential and permit anonymous submission. Anonymous means authenticated ownership with identity withheld from case handlers, not unauthenticated reporting.                                                                                         |
| Administrator access    | Administrators manage the system and see aggregates, with redacted confidential escalation alerts. They do not receive confidential case details or attachment access.                                                                                                                     |
| Routing alternatives    | Where the user listed several possible teams, one default department is selected per category; Incharge may override to another active department. No multi-department assignment.                                                                                                         |
| Emergency path          | Medical, Mental Health, Anti-Ragging, and Security immediately receive Critical priority and system assignment, bypassing ordinary verification. Emergency state survives category renaming.                                                                                               |
| Self-registration roles | New users register as Student. An Administrator assigns Faculty/Staff or operational roles after institutional verification; public registration cannot grant elevated permissions.                                                                                                        |
| Low-priority SLA        | 168 hours, alongside Medium 72h and High/Critical 24h. Resolution cycles snapshot their SLA. Priority changes recalculate from the current cycle's original start.                                                                                                                         |
| Reopening               | Only the reporter, within 72 hours; returns to Assigned and starts a new SLA cycle. Prior history, assignment chain, proof, and resolution history are retained. One feedback record remains immutable across reopening and retains its original resolving department if later reassigned. |
| Returning               | Incharge must provide a reason. A reporter may correct description/location and resubmit; the established category remains unchanged. Time spent Returned counts toward the cycle SLA.                                                                                                     |
| SLA department trend    | Flag only when each of the two preceding completed IST Monday-Sunday weeks has resolved cycles with average `(resolution hours / snapshot SLA hours)` above 1. Empty weeks do not establish a breach trend.                                                                                |
| Attachment cap          | Five files total per complaint across initial evidence and resolution proof, each at most 10 MB. Reporter-authored content may itself disclose identity; the system masks account metadata and evidence names in anonymous handler views.                                                  |
| Polling                 | Five-second visible-view polling. SMTP outbox retries are durable; critical submission triggers an immediate delivery attempt rather than waiting for a scheduled batch.                                                                                                                   |

## Initial routing

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
