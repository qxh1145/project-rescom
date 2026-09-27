# Design system

Source of truth: Figma "Rescom – Design System & Screens"
(`mkudD5Ngi5RPyIAVxCcxXi`). Tokens live in `app/globals.css` (`@theme inline`) and are
used as Tailwind classes (`bg-primary`, `text-ink-muted`, `rounded-card`, `text-title`…).

The Figma file has no bound variables yet, and the Foundations/Components pages were not
reachable through MCP. Values below come from page `55:3` (login) and the Cover page.
**ASSUMED** = not in Figma; keep them centralized and reconcile when Foundations exist.

## Color

| Token | Value | Use |
|---|---|---|
| `primary` | `#2B7A33` | Primary button, outline button, links, headline accent |
| `primary-hover` | `#236A2A` ASSUMED | Hover of primary |
| `primary-foreground` | `#FFFFFF` | Text on primary |
| `brand` | `#4DB848` | Cover page; reserved |
| `ink` | `#1E2446` | Headings, labels, input text |
| `ink-muted` | `#596078` | Body copy, subtitles, divider caption |
| `ink-placeholder` | `#757575` | Input placeholder |
| `line` | `#E1E6EF` | Card border, dividers |
| `line-strong` | `#7C869C` | Input border |
| `surface` / `surface-muted` / `surface-hero` | `#FFF` / `#F7F9FC` / `#F9FAFD` | Card / desktop right panel / desktop hero |
| `tone-{green,teal,amber}-{bg,fg}` | `#EAF6E8`/`#1F6B2A`, `#E3F5F1`/`#1B7466`, `#FFF6D8`/`#7A5200` | Chips |
| `danger` / `danger-soft` | `#C0362C` / `#FDF0EF` ASSUMED | Errors |
| `info-soft` | `#EEF4FB` ASSUMED | Info alert |

## Typography — Be Vietnam Pro (`next/font`, weights 400/600/700/800)

| Token | Size / line-height | Weight | Tracking |
|---|---|---|---|
| `text-display` | 50 / 56 | 800 | -1.5px |
| `text-title` | 26 / 31.2 | 800 | -0.5px |
| `text-body-lg` | 18 / 28.8 | 400 | — |
| `text-body` | 15 / normal | 400 | — |
| `text-body-sm` | 14 / 21 | 400 | — |
| `text-label` | 14 / normal | 600 (labels), 700 (chips, links) | — |
| `text-button` | 16 / normal | 700 | — |
| `text-caption` | 13 / normal | 400 | — |

## Radius & elevation

`rounded-field` 12px (inputs) · `rounded-control` 14px (buttons) · `rounded-card` 24px ·
chips `rounded-full`. No shadows on the login screen (1px `line` border only).

## States (ASSUMED — not drawn in Figma)

- Input focus: border `primary` + 3px `primary/20` ring. Error: border `danger`, 13px message.
- Button hover: primary → `primary-hover`; outline → `primary/5` fill.
  Disabled/loading: 60% opacity, spinner + loading label.
- Focus-visible on links/buttons: 2px `primary` outline, 2px offset. The legacy global
  `*:focus-visible` rule is in `@layer base`, so component utilities override it.

## Primitives (`components/ui`)

| Component | Props | Figma |
|---|---|---|
| `Button` / `ButtonLink` / `buttonClassName()` | `variant: primary \| outline`, `size: lg (52px) \| xl (54px)`, `fullWidth`, `loading`, `loadingLabel`, `leadingIcon` | `62:142`, `62:155` |
| `TextField` | `id`, `label`, `hint`, `error` + native input props | `62:150` |
| `Chip` | `tone: green \| teal \| amber` | `62:112` |
| `TextDivider` | caption text | `62:146–148` |
| `Alert` | `tone: danger \| info`, `onDismiss` | ASSUMED |
| `Spinner` | `className` | ASSUMED |

Brand: `RescomLogo` (`size: md 30px \| lg 40px`), `Mascot` (`size: md \| lg`, Figma
component `58:22`, temporary art the designer will replace).

## Breakpoints

`lg` (1024px) switches the login screen from the mobile frame (`62:427`, 390px) to the
desktop split (`62:106`, 1440px). Below `lg`, content is capped at 440px and centered.
