# System Color Design

EveryOps runs on one dark palette. Its job is to keep people's data readable for hours at a time and to make the one thing that matters on a screen easy to find. The tokens live in `src/app/globals.css`; this document explains what each one is for and when to reach for it.

## Principles

1. **One accent, used for intent.** Lagoon teal marks the next action, the current place and live state. If everything is teal, nothing is. A screen normally has one teal button.
2. **Neutrals lean toward the accent.** The grays carry a trace of green-blue, so surfaces and accent read as one family instead of teal pasted on charcoal.
3. **Depth comes from lightness, not shadow.** Each surface step is a little lighter than the one below it. Shadows are reserved for things that float above the page (popovers, the landing page's product shots).
4. **Status colors are never the only signal.** Every status also has a label or an icon.
5. **No pure black or pure white.** `#0A0C0D` is the darkest value and `#E8EDEC` the lightest, which keeps contrast high without glare.

## Surfaces

From the back of the screen to the front:

| Token | Hex | Use |
|---|---|---|
| `--shell` | `#0A0C0D` | Page background, top bar, sidebar |
| `--background` | `#0F1213` | Main content area inside a workspace |
| `--card` | `#131718` | Cards, the prompt box, panels |
| `--muted` | `#161B1C` | Hover fills, skeletons, quiet wells |
| `--popover` | `#171C1D` | Menus, popovers, floating cards |
| `--secondary` | `#1A2021` | Secondary buttons, selected sidebar row |
| `--accent` | `#1E2526` | Highlighted menu item |

## Lines

| Token | Hex | Use |
|---|---|---|
| `--border` | `#232A2B` | Default divider and card edge |
| `--input` | `#2A3233` | Form field borders, which must be findable at a glance |
| `foreground/10` | — | Edges of floating and featured surfaces (prompt box, product shots) |

## Text

| Token | Hex | Contrast on `--shell` | Use |
|---|---|---|---|
| `--foreground` | `#E8EDEC` | 16.6 : 1 | Body text, headings, values |
| `--muted-foreground` | `#95A19F` | 7.4 : 1 (6.8 : 1 on `--card`) | Descriptions, labels, metadata |
| `muted-foreground/80` | — | 5.0 : 1 | Timestamps and tertiary detail only |

Large display headings on marketing pages may fade from `foreground` to `foreground/55` top to bottom. Never apply that fade to body text.

## Accent: Lagoon

| Token | Hex | Use |
|---|---|---|
| `--primary` | `#34C3A6` | Primary button, active nav underline, focus ring, current-time line, selected state |
| `--glow` | `#5BE0C2` | Hover state of primary buttons; nothing else |
| `--primary-foreground` | `#03130F` | Text and icons on a primary fill (8.6 : 1) |
| `primary/10` to `primary/14` | — | Tinted wells: workspace tiles, booking blocks, "you" chat bubbles |
| `primary/12` to `primary/25` + blur | — | Ambient glow behind hero sections. One per page, never behind data |

Focus uses `--ring` (the same teal) at 50% opacity, 2 to 3px, on every interactive element.

## Status

| Token | Hex | Meaning |
|---|---|---|
| `--success` | `#34C3A6` | Done, paid, approved (shares the accent on purpose) |
| `--warning` | `#E3A64B` | Needs attention: pending, low stock, overdue soon |
| `--destructive` | `#EB6F5F` | Failed, declined, delete |

Destructive buttons are tinted (`destructive/10` fill with `destructive` text) rather than solid red, so they don't outshout the primary action.

## Charts

Charts use a fixed order so the same series keeps its color across a workspace.

| Token | Hex | Typical series |
|---|---|---|
| `--chart-1` | `#34C3A6` | The main measure (revenue, bookings) |
| `--chart-2` | `#7F8B89` | Comparison or previous period |
| `--chart-3` | `#E3A64B` | Costs, expenses |
| `--chart-4` | `#6B9BD1` | A second category (also used for "blue" booking blocks) |
| `--chart-5` | `#4A5452` | Everything else |

## Motion and color

Color changes on hover and press use `transition-colors` at 150 to 200ms. The landing page's parallax, reveal and tilt only move `transform`, `translate` and `opacity`; color never animates on scroll. Reduced motion removes movement and keeps the color changes.

## Light theme

There isn't one yet. When it comes, it needs its own surface ramp; inverting these values won't work, because the accent was tuned against dark surfaces.
