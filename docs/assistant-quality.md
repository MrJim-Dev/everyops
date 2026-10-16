# Assistant quality checks

The assistant now shows the data it checked and reviews each requested change before offering a plan. Setup applies the same requirement review to the generated design. These checks add evidence and repair opportunities; they do not make the model infallible.

## Behavior

- Scoped numbers require fresh tool evidence, including zero results. Lookup failures, successful empty results, and capped results have distinct states. A failed lookup gets one fresh attempt; an unresolved failure or incomplete result asks for clarification without generating a numerical answer or change plan.
- Lookup context keeps complete JSON entries within its budget. Search, linked-record and grouped-aggregate caps are surfaced, rather than silently treated as complete data.
- A separate, small structured review checks every explicit requirement against actual operations or existing configuration. Unknown evidence references are rejected. Explicitly preserved pages include their fields, tabs and widgets. Missing requirements return to the existing repair loop; ambiguity or an unavailable reviewer withholds the plan.
- Setup repairs missing choice options with a focused schema, then uses the general patch path for missing screens and widgets. The right-side setup panel lists the requirements in neutral text: tiny filled bullets mean checked, hollow bullets mean pending. The conversation preview has no highlighted review box. On mobile, Setup details opens the same panel from the right.
- Answers retain query filters, counts and the Manila check time across saved conversations. Plans retain their checklist. Mobile chat keeps these details readable.
- Generated dashboard `view:` shortcuts resolve only through known views in the current workspace; unknown targets become text. The existing Markdown URL sanitizer remains in place.
- The branch also includes the previously unmerged assistant improvements: proactive checks, memory suggestions, propagated renames, future-effective changes, persistent dismissed findings, and attribution for applied changes.

## Reproduce

Use an isolated database and a running local server with Vertex ADC configured. These commands call the real model. Do not point the evaluation at a customer workspace/database.

```sh
EVAL_BASE=http://localhost:3017 EVAL_REPEAT=2 EVAL_REPORT=/tmp/assistant-results.json pnpm eval:assistant
```

`EVAL_EMAIL` and `EVAL_PASSWORD` override the demo account. `EVAL_ONLY` selects an assistant case by name. `EVAL_KEEP=1` keeps the temporary assistant workspace for browser inspection; otherwise the script deletes it. Setup's design stage has its own eval, `pnpm eval:design` (docs/design-quality.md).

The assistant fixture has 32 bookings, including data beyond the 25-record digest sample, plus courts and players. This month's paid total is ₱1,200; GCash is ₱400. Unpaid, cancelled and previous-month bookings are separate. Checks include Taglish, a follow-up filter, exact record ids, preservation of unrelated records and Bookings configuration, absent-record deletion, future dates, new areas, and persistent deduplicated memory. The absent-record case accepts an evidence-backed no-match answer or a clarification, and never a deletion plan.

## Verification on 2026-10-15

Local application, isolated PostgreSQL database, synthetic data, real Vertex `gemini-3.7-flash`. No production deployment or customer-data test was performed.

| Check | Result |
| --- | --- |
| Typecheck / lint / production build | Passed |
| Vitest | 375 tests across 65 files passed |
| Final assistant batch | 16/16 passed; median 13.1 s, slowest 29.8 s |
| Repair-shop setup | 11/11 structural/requirement assertions passed in 33.9 s |
| Additional setup runs | Passed in 66 s after repair and 33 s without repair |
| Multi-part preservation repeat | 3/3 passed |
| Browser | Desktop at 1440/1710 px widths and mobile 390×844; saved conversation evidence, plan reload, apply, undo, setup creation, generated overview and status-board shortcut |

Raw synthetic responses: [assistant results](qa/assistant-quality/assistant-results.json), [setup results](qa/assistant-quality/setup-results.json). The repeated investigation batch initially reported 30/32 because its old deletion assertion rejected two correct no-match answers; the corrected assertion is used by the final 16/16 batch. The dataset's derived fields were normalized before acceptance to avoid counting fixture initialization as an unrelated record edit.

Setup screenshots use a real `/api/ai/design` result saved as a resumable local setup draft. The browser then created that workspace and opened its generated screens. They demonstrate the resulting draft and application, not a full conversational interview. No model responses or screenshot pixels were mocked.

## Screenshots

| Proof | Screenshot |
| --- | --- |
| Exact total, filters, timestamp and record links | [Desktop answer](pr-screenshots/assistant-quality/01-grounded-answer-desktop.png) |
| Responsive answer and evidence | [Mobile answer](pr-screenshots/assistant-quality/02-grounded-answer-mobile.png) |
| Three-part request checklist | [Reviewed plan](pr-screenshots/assistant-quality/03-request-coverage.png) |
| Applied names in the sidebar | [Applied](pr-screenshots/assistant-quality/04-applied.png) |
| Original names restored | [Undone](pr-screenshots/assistant-quality/05-undone.png) |
| Verified zero matches | [Empty result](pr-screenshots/assistant-quality/06-no-matching-records.png) |
| Quiet checklist in the right-side panel | [Setup draft](pr-screenshots/assistant-quality/07-setup-brief-checked.png) |
| Working generated collection dashboard | [Overview](pr-screenshots/assistant-quality/08-generated-overview.png) |
| Shortcut opens the requested status board | [Status board](pr-screenshots/assistant-quality/09-generated-status-board.png) |

Follow-up UI verification: desktop checked state (6/6), a seeded pending state (0/6 with hollow bullets), and the mobile right-side details panel. The pending fixture represents planned requirements before a draft exists; it is a UI-state test rather than another model-generation run. Typecheck, lint, 375 tests and production build passed after the layout change.

| Additional setup proof | Screenshot |
| --- | --- |
| Pending requirements with transparent bullets | [Pending checklist](pr-screenshots/assistant-quality/10-setup-checklist-pending.png) |
| Minimal mobile side panel | [Mobile setup details](pr-screenshots/assistant-quality/11-setup-checklist-mobile.png) |

## Limits and release notes

The reviewer is another model call, so it adds latency and can miss semantics or request unnecessary repairs. These fixtures are a regression sample, not a production accuracy benchmark. Large/incomplete lookups conservatively ask for narrowing; this may also affect intentionally bounded list requests. Query evidence proves what was retrieved, not that every sentence in a response is correct. Setup coverage checks the design before sample filling and overview layout; final layout still uses the existing structural validation.

The inherited proactive-check feature adds migration `0009_assistant_checkup.sql`; run `pnpm db:migrate` in the normal release procedure before enabling the branch in production. This PR does not deploy or merge anything.
