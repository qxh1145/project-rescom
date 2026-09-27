# Screen implementation guide (Figma → Next.js)

Read with `architecture.md`, `api-conventions.md`, `mock-strategy.md`, `design-system.md`
and `figma-screen-inventory.md` (frame ids). App: `apps/frontend/my-app`
(Next 16 — read `node_modules/next/dist/docs/` before using an unfamiliar API).

## 1. Getting the design

1. Load the `figma:figma-design-to-code` skill, then call `get_design_context`
   (file `mkudD5Ngi5RPyIAVxCcxXi`) for **every** frame you implement, desktop and mobile.
   Pass `skillNames: "figma-design-to-code"`. The screenshot is the visual target.
2. If a response is too large it is saved to a file: extract the code with `jq -r '.[0].text'`
   and read it in slices, or call `get_design_context` on child frames.
3. Translate absolute positioning into flex/grid. Keep Figma sizes, spacing, radii, font
   sizes/weights and colors exactly; map colors to tokens (`app/globals.css`).
   Missing token → add it to `globals.css` (`@theme inline`) with a comment, never hardcode
   a repeated hex in components.
4. Only one breakpoint drawn? Derive the other from sibling screens and mark `ASSUMED` in a
   comment. Breakpoint: `lg` (1024px) = desktop layout.

## 2. Assets

- **Icons** (monochrome): download the SVG from the design-context asset URL to
  `public/icons/<kebab-name>.svg` (semantic name, no color in the name; check the folder
  first — reuse an existing file when the shape is identical). Render with
  `<Icon name="…" size={…} className="text-…" />` (CSS mask → `currentColor`).
  Two-tone art (e.g. stars) → `<img>`.
- **Mascots**: `<Mascot name="think" height={160} />` — all 21 exist in
  `public/brand/mascots`. Never download mascots again.
- **Logo**: `<RescomLogo size="xs|sm|md|lg" />` (22/24/30/40px high).
- **Background images** (`Image` layers: hills): download to `public/brand/`, reuse
  `hills-desktop.jpg` / `hills-mobile.jpg` when identical.
- No temporary Figma URLs may remain in code.

## 3. Building blocks (reuse before creating)

`components/ui`: `Button`/`ButtonLink`/`buttonClassName` (variants primary · secondary ·
outline · ghost · danger; sizes sm 40 · md 44 · base 48 · lg 52 · xl 54), `TextField`,
`fieldClassName`, `Select`, `Textarea`, `Checkbox`, `Radio` (`variant="card"`),
`ToggleChip`, `Chip`, `Tag` (status pills), `ProgressBar`, `StarRating`, `OtpInput`,
`SegmentedControl`, `Dialog` (native modal), `IconButton`/`IconLink` (44px round),
`Avatar`/`initialsOf`, `Alert`, `Spinner`, `TextDivider`, `Icon`.

Layout (`components/layout/app`): `AppShell` (desktop `AppHeader` + mobile `BottomNav`),
`FocusShell` (no chrome), `MobileBrandBar`, `MobileTitleBar`, `MobileBackBar`,
`PointsChip`, `NotificationBellLink`, `SessionGate`. Session data: `useSession()`
(`user`, `profile`, `balance`, `unreadCount`, `displayName`, `refresh()`).

Route groups (URLs unchanged):
- `app/(signed-in)/layout.tsx` owns the one `SessionProvider` shared by both groups below
  (session, points, badge survive moving between them; it also keeps the access cookie
  fresh via `lib/auth/session-refresh.ts`). Each group's shell keeps its own `SessionGate`.
- `app/(signed-in)/(app)/…` → header + bottom nav (Khám phá, Ví, Khảo sát của tôi, Tài khoản, Thông báo…).
- `app/(signed-in)/(focus)/…` → signed-in, no chrome (làm khảo sát, onboarding, nạp điểm steps…).
- Public pages (login, register, errors) stay at the top level.

`SessionGate` routes a failed session check by cause: 401 → `/login?returnTo=…`,
`AUTH_USER_LOCKED` → `/login?error=AUTH_USER_LOCKED`, network → `/offline?from=…`,
anything else → `/server-error?from=…` (rules in `lib/session/session-status.ts`).

When a Figma pattern repeats across screens of your phase, make one component in the
route folder (`app/(signed-in)/(group)/<route>/components/`). Promote to `components/ui` only if it
is generic; say so in your report.

## 4. Data (mock first, backend later)

```
page/component → hook (app/<route>/hooks) → service (lib/<domain>/*-service.ts) → apiRequest
                                                                    ↓
                                     MSW handler (mocks/handlers/<domain>.ts) + mocks/data/<domain>.ts
```

- UI never imports `mocks/*` or `lib/mock/*`.
- Services validate responses with `@rescom/schemas` when the contract exists, otherwise
  with a local zod schema in the service file.
- Label every endpoint: **VERIFIED** (checked in `apps/backend/src/modules/**/presentation/*.controller.ts`
  + `packages/schemas`), **ASSUMED API CONTRACT** (no backend route; frontend-designed),
  **MOCK-ONLY**. Prefer existing backend routes and shapes.
- `apiRequest` sends CSRF for non-GET automatically.
- Fetch in client components with `useApiQuery(key, signal => service(…, signal))`.
- Mock state: `createCollection(name, seed)` from `mocks/db/store.ts` (localStorage, reset
  with `?msw-reset=1`); current user via `getMockSessionUser()` (`mocks/db/session.ts`).
  Seed data = the exact content shown in Figma. Call `applyScenario("<domain>")` first in
  every handler so `?msw=slow|api-error|api-offline|unauthenticated` works.
- Register new handler arrays in `mocks/handlers/index.ts`.
- Error copy in Vietnamese lives in the domain (`lib/<domain>/…-messages.ts`), not in JSX.

## 5. States every screen needs

Loading (skeleton or spinner), empty (Figma empty state when drawn), error (inline `Alert`
with retry; session failures on load are handled by `SessionGate`), disabled/busy buttons (page 8 states),
form validation messages. Accessibility: semantic landmarks, labels, `aria-current` on nav,
focus-visible outlines (global), `alt=""` for decorative art, 44px touch targets.

## 6. Legacy code

Replacing a legacy page: delete the old `app/<route>/page.tsx` (and its now-unused
helpers) when the new one lands in a route group — two pages cannot own one URL. Do not
touch unrelated legacy routes.

## 7. Done =

- `npx tsc --noEmit` and `npx eslint <your paths>` clean; `npm test` still green.
  Several agents may work in parallel: do **not** run `next dev`/`next build` (they share
  `.next`); the lead checks every screen in the browser at 390px and 1440px against the
  Figma screenshots (mock mode, demo account `minh.le@fpt.edu.vn` / `Password123!`).
- Report: routes added, files, endpoints with labels, ASSUMED decisions, anything skipped.
