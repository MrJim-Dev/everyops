# Pages

Pages are what people make in EveryOps to show or share something: a report for the month, a price list, a booking
page, the home page. They are listed under **Pages** in the sidebar (below Systems), and every page in the workspace
is in the Pages library at `/w/[workspace]/pages`. The name replaces "Website", "custom HTML page" and "custom
page" everywhere people read it: the sidebar, the page bar, Ask EveryOps's replies, Community, the MCP and REST
descriptions.

It works like Grok Bot's pages (What's new in Grok Bot, Oct 27 2026): ask for something about your data, and the
assistant answers with a page that tells it visually, saved where you can come back to it, private until you share it.

## Making a page

- In the Pages library, owners and admins describe the page ("October's bookings and revenue by court, with the
  busiest hours") or pick one of the ideas made from the workspace's own record types. The request goes to Ask
  EveryOps as `Make a page: …` (`useAssistant.sendRequest`; the chat sends it once, from whichever chat is mounted).
- Ask EveryOps answers with an ordinary change plan: a sidebar entry and an html view, plus, when no table view holds
  exactly the records the page reports on, a table view with the filter it needs (a page can't report a month from
  a view filtered to upcoming bookings). Nothing changes until Apply, and the page can be undone from History.
- Once applied, the conversation shows the page as a card (`PageMade` in `chat-thread.tsx`) that opens it.
- The page reads the workspace's records each time it opens (`EveryOps.data`), so there is nothing to refresh.
  Team-only pages get each cell's `value` beside its `text` (numbers, ISO times, option ids), so the page counts and
  groups with values instead of parsing what is displayed.

## Who can open a page

A page starts **Team only**. **Share with a link** makes it public at `/s/[workspace]/[page]`; **Stop sharing** takes it
back. Records stay private when a page is shared: a shared page can read only published layouts or tables shared as
public data. When a team page reads the team's own tables, Share explains that outsiders won't see those numbers and
offers to have Ask EveryOps make a version that is safe to share.

## In the code

The blueprint keeps its types: a page is an `html` view (or the standard site's `landing` view). `src/lib/pages.ts` decides
what the sidebar lists under Pages (an entry made only of pages) and what the library shows (title, summary, who can
open it, when it last changed). `pages` is a reserved sidebar id, like `history` and `settings`.

## Proof

Local dev server against an isolated PostgreSQL 17 (`scripts/qa-pages.mts`: the court bookings sample as "Dink & Drop
Pickleball"), Chrome through Playwright, Ask EveryOps on Vertex AI (gemini-3.7-flash) through local ADC. The October
report Ask EveryOps made was checked against the database: 277 bookings, 262 not cancelled, ₱100,800 paid, bookings and
revenue per court, and the busiest hours in Manila time all match. Screenshots are in `docs/pr-screenshots/pages/`.
