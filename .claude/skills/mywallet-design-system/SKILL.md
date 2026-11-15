---
name: mywallet-design-system
description: The "Graphite" visual charter of myWallet - tokens, typography, components, forbidden patterns and the visual review checklist. Use it before writing or changing ANY myWallet UI (pages, components, charts, empty states, emails, PDF exports), when reviewing screenshots, and whenever a colour, font size, spacing, icon or animation choice comes up, even if the request does not mention design.
---

# Graphite — myWallet design system

Intent: calm, dense, precise personal-finance UI in the spirit of Linear, Mercury, Copilot Money and the Stripe dashboard. The person using it opens the app several times a day to check numbers; the interface should get out of the way and make numbers easy to scan and compare. Anything that looks "AI generated" or decorative breaks trust in the figures, so restraint is the brand.

Dark theme only for now.

## Tokens

Defined in `src/app/globals.css` (CSS variables + Tailwind `@theme`). Use the Tailwind names, never raw hex.

| Token                                  | Tailwind                    | Use                                                |
| -------------------------------------- | --------------------------- | -------------------------------------------------- |
| `--bg` #0C0D0F                         | `bg-bg`                     | page background                                    |
| `--surface` #131518                    | `bg-surface`                | cards, inputs                                      |
| `--surface-2` #1A1C20                  | `bg-surface-2`              | hover, popovers, monogram tiles                    |
| `--border` #24272C                     | `border-border`             | default 1 px separators                            |
| `--border-strong` #2F333A              | `border-border-strong`      | inputs, dialogs, popovers                          |
| `--text` #E8E9EB                       | `text-text`                 | primary text                                       |
| `--text-muted` #8A8F98                 | `text-muted`                | secondary text, labels (AA OK)                     |
| `--text-subtle` #5B606A                | `text-subtle`               | decoration, disabled only (fails AA for body text) |
| `--accent` #3FB68B                     | `text-accent` / `bg-accent` | the one strong colour                              |
| `--accent-subtle`                      | `bg-accent-subtle`          | flat translucent fill, never a gradient            |
| `--danger` #E5484D                     | `text-danger`               | errors, budget overruns only                       |
| `--warning` #F5A524                    | `text-warning`              | warnings, pending claims                           |
| `--radius-sm` 6px / `--radius-md` 10px | `rounded-sm` / `rounded-md` | inputs+badges / cards+dialogs                      |

## Colour semantics (why: colour must mean something in a money app)

- One accent. It marks money coming in (with `+`), primary actions and focus. Nothing else gets a strong colour.
- Expenses stay neutral text with `-`. Red is never used for a normal expense: spending is not an error.
- Claims: pending = `warning`, reimbursed = `accent`, gifted = `muted`. Use `<ClaimBadge status=…>`.
- Charts are monochrome: accent for the main series, greys for comparisons, discreet axes, plain tooltips. Use the `dataviz` skill with this palette.

## Typography

- Geist Sans, base 14 px. Scale: `text-xs` 12, `text-sm` 13, `text-base` 14, `text-md` 16, `text-lg` 20, `text-xl` 28, `text-2xl` 40.
- Weights 400, 500, 600 only (`font-normal`, `font-medium`, `font-semibold`). Bold/black are removed from the theme.
- Every amount goes through `<Amount cents={…} variant="flow|plain" />` (Geist Mono, `tabular-nums`), right-aligned in tables so digits line up.
- French formats: `1 234,56 €` (`formatCents`), dates `15 nov. 2026` (`formatDateFr`), Europe/Paris.

## Layout and density

- 4 px grid. Table rows 40-44 px (`TableRow` = 44). Dense, rigorously aligned.
- Surfaces separated by 1 px borders. No decorative shadow (the shadow scale is removed from the theme).
- Sidebar 240 px collapsible, topbar with search and ⌘K, content max 1280 px. Mobile: bottom tab bar, "Ajouter un ticket" always reachable.
- Lucide icons, 1.5 px stroke (enforced globally on `svg.lucide`), `size-4` in UI.
- Merchant logos: square tiles 28-36 px, rounded, monogram fallback on `surface-2` (`<MerchantLogo>`).

## Motion

120-180 ms, opacity and small translate only (`animate-fade-in`, `animate-rise-in`). `prefers-reduced-motion` is honoured globally. No counting-up numbers.

## Accessibility

AA contrast, visible focus ring (accent outline), full keyboard navigation, 44 px touch targets on coarse pointers (`pointer-coarse:min-h-11`), `aria-label` on icon-only buttons, French labels.

## Forbidden

Gradients (background, text, border, button) · glow/halo · coloured shadows · glassmorphism/backdrop blur · neon or flashy text · emojis in the UI · generic AI illustrations · words like "magique", "boostez", "révolutionnaire" · animated counters · lorem ipsum · new colours outside the tokens.

Empty states: one useful sentence plus one action (`<EmptyState>`), no illustration.

## Components

Primitives live in `src/components/ui`: Button, Input/Textarea/Label/Field, Select, Table, Card, Badge/ClaimBadge, Dialog, Tabs, Toast (`toast()`), Skeleton, EmptyState, Kbd, Amount, MerchantLogo. Shell in `src/components/shell`. Reuse them; extend variants with `cva` rather than restyling inline. `/design` (dev only) shows them all; add any new primitive there.

## Visual review checklist

Use this for each screen at 1440 px and 390 px (`pnpm screens <sprint> <routes>`):

1. Only token colours; accent used for income, primary action and focus only.
2. Expenses neutral with `-`, income accent with `+`, red only for errors/overruns.
3. Claim badges use the right colours.
4. Amounts in mono tabular, right-aligned, French format.
5. Rows 40-44 px, 1 px borders, no shadows, 4 px rhythm, aligned columns.
6. Type scale and weights respected; hierarchy readable at a glance.
7. Nothing forbidden (see list).
8. Empty/loading/error states present and sober.
9. Mobile: no horizontal scroll of the page, 44 px targets, tab bar does not hide content.
10. Focus visible, contrast AA, labels in French.
