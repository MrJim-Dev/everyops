# Workspace currency

Money was hard-coded to Philippine pesos: every price, total, chart, email, public page and Excel export read ₱, so a café in Singapore or a shop in Kuala Lumpur couldn't use EveryOps without its prices looking wrong.

## What owners get

**Settings → General → Currency** picks the currency the workspace's money reads in, with a live sample (RM 1,250.50). Saving is a versioned change, so History can undo it. Only owners and admins can change it.

Seventeen currencies are supported, chosen for JAPAC: PHP (the default), USD, SGD, MYR, IDR, THB, VND, JPY, KRW, CNY, HKD, TWD, INR, AUD, NZD, EUR and GBP. Each one reads the way its own locale writes it (₱1,250, RM 1,250, ¥1,250 with no cents, Rp 1.250). Dollars outside the US say whose they are (S$, HK$, A$, NZ$, NT$), so S$400 never passes for US$400.

Amounts are plain numbers and stay the same. Changing the currency labels money; it doesn't convert it.

## Where it applies

- In the app: tables and their totals, record panels, money inputs (the symbol before the amount), the Register (prices, total, cash received, change, the printed receipt), dashboards and layout pages (stats, charts, goals, leaderboards), and Ask EveryOps plan previews.
- On public pages: prices in cards and lists, the hero's "From S$400 an hour", and add-on totals.
- In email automations (`{{price}}`), MCP and REST text, CSV exports, and Excel exports (the money column's number format uses the symbol).
- Ask EveryOps gets "Money is in SGD, written like S$1,250" in its context, so its answers use the workspace's currency.
- Pasted or imported amounts in any currency are read as numbers: "S$1,250.50", "RM 300", "USD 99", "€(40)", "₱1,250". Price detection on public pages recognizes any currency.

## How it works

- `Blueprint.currency` is optional (older blueprints mean PHP), changed with `set_currency`, and checked by `validateBlueprint`.
- `src/lib/format.ts`: `CURRENCIES`, `currencyOf(bp)`, `formatMoney(value, { currency })`, `currencySymbol`, `stripMoney` and `looksLikeMoney`. `formatMoney` without a currency still means pesos, so nothing that doesn't pass one changes.
- Server-side code that has the blueprint (public pages, emails, MCP, value text, dashboard formatting) passes `currencyOf(bp)`. Components read `useCurrency()` from a `CurrencyProvider` that the workspace and the public site each set. This is a React context and not a module variable because public pages render on the server, where requests for different workspaces run at the same time.

## Verification, 2026-10-22

Local dev server against an isolated PostgreSQL 17 with two synthetic workspaces (`scripts/qa-currency.mts`): the canteen POS sample in pesos and a court-bookings site in SGD with its booking form public. Chrome through Playwright, no page errors. Screenshots are in `docs/pr-screenshots/workspace-currency/`.

- Settings showed PHP. Picking Malaysian ringgit previewed "RM 1,250.50", and Save showed "Money now reads in Malaysian ringgit".
- Orders, the order panel's Cash received input, the Register (prices, total, cash received, Complete sale) and the Overview (Sales today RM 1,065, Average order RM 118, Running low) all read RM.
- History listed "Currency changed to MYR" with Undo.
- Exporting orders to Excel gave a Total column formatted `"RM"#,##0.00` with the value 135.
- The SGD site's public home page showed "From S$400 an hour".
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.

Not covered: setup's interview and designer still assume pesos when they create a workspace (change the currency afterwards), real SMTP delivery, and a deployed environment.

