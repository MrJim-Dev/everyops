# Hulma

Describe your business, and Hulma builds the systems it needs (bookings, POS, content, finance, HR) inside one workspace. Built for the Google Cloud AI Builder Cup 2026.

This is the **frontend build**. Every screen works with data saved in the browser. The AI steps are scripted stand-ins with the same inputs and outputs Gemini will use, so the backend can replace them without UI changes.

## Run it

```bash
pnpm install
pnpm dev          # http://localhost:3000
pnpm test         # engine tests (Vitest)
pnpm typecheck    # route types + TypeScript
pnpm lint         # Biome
pnpm build
```

The first visit seeds four demo workspaces: Court House PH, Tita Nena's Canteen, Kapé Ilaya and Sunrise Bakeshop.

## How it works

A client's system is a **blueprint**: a small JSON document that lists entities, fields, formulas, screens, widgets and rules (`src/lib/blueprint/types.ts`). One engine and one set of view components render any blueprint, so nothing is generated or deployed per client.

```
blueprint (JSON) ──► engine (src/lib/engine) ──► views (src/components/views, widgets)
        ▲                         │
  Ask Hulma (src/lib/assistant)   └──► records (JSON fields per record)
```

| Folder | What lives there |
|---|---|
| `src/lib/blueprint` | Types, lookups and validation for blueprints |
| `src/lib/engine` | Formula language, compute, records and rules, availability, aggregates, change plans with undo |
| `src/lib/catalog` | Community systems (blueprint + sample data) and the demo workspaces |
| `src/lib/assistant` | Setup interview and change planner. **Gemini plugs in here.** |
| `src/lib/store` | Workspaces saved in localStorage (Zustand), versions and change history |
| `src/components/views` | One component per view type: table, kanban, calendar, schedule, checkout, approval queue |
| `src/components/widgets` | Dashboard stats, charts, progress and lists |
| `src/components/records` | Shared field display/input, record panel, create dialog |
| `src/components/workspace` | Workspace context, used by saved workspaces and previews alike |

## Design rules

- Dark, compact, Linear-inspired. Tokens live in `src/app/globals.css` with one accent (#3FA796).
- Geist and Geist Mono. Numbers are tabular.
- Motion follows Emil Kowalski's rules. ⌘K opens with no animation. Panels use a 220 ms ease-out curve. Buttons scale to 0.97 when pressed. Reduced motion is respected.
- shadcn/ui on Base UI with Phosphor icons. Vendored components live in `src/components/ui` and are excluded from lint.
- Times are Asia/Manila. Money is PHP.

## Known limits of this build

- Data is saved per browser. Bumping `DATA_VERSION` in `src/lib/store/workspaces.ts` replaces saved data with fresh demos.
- The interviewer guides booking businesses. Other business types are pointed to a matching community system.
- The change planner understands pricing changes, adding a field, and renaming a workspace.
- Community authors and usage counts are sample catalog data. Systems you publish are stored in this browser.
- Invites only work for accounts in the same browser until the backend lands.

## Accounts

Workspaces need an account. Community systems and their previews stay public.

| Page | What it does |
|---|---|
| `/sign-in` | Email and password, a "Fill in the demo account" shortcut, and a return to the page you were on (`?next=`) |
| `/sign-up` | Name, email and password with a strength meter. Duplicate emails are rejected |
| `/forgot-password` | Always shows the same confirmation. Email isn't connected yet, so the page shows the reset link directly |
| `/reset-password` | Single-use link, valid for 30 minutes, with a confirmation field |

Demo account: `james@hulma.app` / `hulma2026`.

Each account has its own workspaces; the demo workspaces are created on an account's first sign-in.

| Page | What it does |
|---|---|
| `/account` | Change name and password; delete the account and its workspaces (password required) |
| `/w/[workspace]/settings` | Rename (versioned and undoable), export the blueprint and records as JSON, delete (type the name to confirm) |
| `/terms`, `/privacy` | Plain-language policies for the prototype |

In this frontend build, accounts live in the browser (`src/lib/auth/store.ts`) with salted SHA-256 hashes. Pages only call `signIn`, `signUp`, `requestReset`, `resetPassword` and `signOut`, so Firebase Auth can replace that one file. Google sign-in arrives with Firebase.

## Team and Community publishing

Both are tabs in workspace Settings, next to General. Publish only shows for owners and admins.

| Page | What it does |
|---|---|
| `/w/[workspace]/settings/team` | Invite by email with a role, copy or revoke invite links, change roles, remove people, or leave a shared workspace |
| `/invite/[token]` | Shows who invited you and the role, then joins after you sign in or create an account |
| `/w/[workspace]/settings/publish` | Publish the workspace design to Community, publish new versions, or unpublish. Records, team and history stay private |

| Role | Can do |
|---|---|
| Owner | Everything, including deleting the workspace |
| Admin | Ask Hulma for changes, undo, rename, publish, manage the team |
| Staff | Add and edit records |
| Viewer | View only |

Shared workspaces show "Shared with you" on the home page. Roles live in `src/lib/store/workspaces.ts` (`roleOf`, `canManage`, `canEdit`); published systems live in `src/lib/community/published.ts`.
