# Campus service desk design

FixMyCampus uses a campus operations console: a persistent navy navigation rail, a compact service queue, report evidence, and a chronological audit trail. The primary actions are reporting an issue, reviewing an assignment, and resolving it. There is no marketing content in the workspace.

- Palette: `#172F3E` text/navigation, `#006D77` primary actions, `#F3F7F9` background, white surfaces, `#DAE4E9` rules. Red, amber, and green appear with written status labels.
- Type: locally bundled Source Sans 3, 16 px body, 14 px forms, 12–13 px table labels, 28–32 px page headings, tabular figures. Muted text remains readable against its surface.
- Rhythm: 4/8/12/16/24/32 px spacing, 4 px controls, 6 px panels, 8 px structural marks. No decorative gradients, shadows, or motion.
- Layout: a connected metrics strip and real complaint table lead the overview. Reporting has a guided form and a process explanation. Complaint detail pairs its evidence timeline with the next permitted action.
- Accessibility: explicit input labels, separately described hints, visible focus, keyboard navigation, skip link, Escape-close mobile navigation, semantic tables and landmarks, server errors as alerts, loading/success status announcements, reduced-motion support.
- Responsive: collapsible navigation below 800 px; a single form column on mobile; horizontal overflow contained within data tables; mobile actions remain visible.

Reviewed with the `anti-ai-slop-ui` and `frontend-design` skill criteria. AI Slop Score: 1/10 (a familiar administration shell); Distinctiveness Score: 8/10 (campus identity, complaint reference ledger, contextual workflow actions, restrained connected metrics). Remaining tradeoff: dense queue columns scroll horizontally on small screens to preserve readable service details.

Visual QA: actual seeded student dashboard/report/detail, Incharge queue, administrator account management, login, and 375 px mobile report/dashboard. Screenshots live in ignored `.runtime/qa-*.png`; they are not production assets.
