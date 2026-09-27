# Frontend architecture (apps/frontend/my-app)

Next.js 16 App Router · React 19 · TypeScript strict · Tailwind CSS v4. Read
`apps/frontend/my-app/AGENTS.md` first: this Next version differs from older docs.

## Folders

| Path | Holds |
|---|---|
| `app/<route>/` | Route + its feature code (`components/`, `hooks/`, `*-api.ts`), colocated |
| `app/(signed-in)/` | Signed-in route groups `(app)` (header + bottom nav) and `(focus)` (no chrome); its `layout.tsx` mounts the one `SessionProvider` |
| `components/ui/` | Generic, token-based primitives (Button, TextField, Chip, Alert…). No domain knowledge |
| `components/brand/` | Logo, mascot — Figma assets in `public/brand/` |
| `components/layout/` | Legacy app shells (PublicShell, PortalShell, Sidebar) |
| `components/providers/` | App-wide client providers (`MswProvider`) |
| `lib/api/` | Transport: `config.ts` (env), `client.ts` (`apiRequest`), `api-error.ts` |
| `lib/<domain>/` | Domain services, types, pure helpers (e.g. `lib/auth/`) |
| `lib/session/` | `SessionProvider`/`useSession` and the pure status rules used by `SessionGate` |
| `mocks/` | MSW only — handlers, scenarios, mock data. See `mock-strategy.md` |
| `lib/mock/` | **Legacy** localStorage demo store. Do not use in new UI code |

Naming: components `PascalCase.tsx` with named exports; hooks/utilities `kebab-case.ts`.

## Data flow

```
UI component → hook (app/<route>/hooks) → service (lib/<domain>) → lib/api/client → fetch
                                                                              ↓
                                                  MSW (NEXT_PUBLIC_API_MOCKING=enabled)
                                                  or Next /api rewrite → NestJS backend
```

- UI never imports `mocks/*` or `lib/mock/*`. Switching mock ↔ real backend changes no UI code.
- Services validate every response with the shared zod schemas from `@rescom/schemas`.
- Errors surface as `ApiError`; each domain maps codes to Vietnamese copy in one place
  (`lib/auth/auth-error-messages.ts` for auth).

## Server vs Client components

Default to Server Components. `"use client"` only where state, effects, browser APIs or
event handlers are needed, and as low in the tree as possible. Example (`/login`):
`page.tsx`, `AuthSplitLayout`, `AuthHero`, `AuthMobileHeader` are Server;
`LoginPanel` (search params + form state) is the client boundary, wrapped in `<Suspense>`.

## Migration status

Screens rebuilt from Figma with the new layering: `/login`, `/auth/callback`, `/auth/error`.
All other pages still read the legacy `mockRepository`; MSW auth handlers delegate to it
so the session stays shared. Migrate screen by screen; delete `lib/mock` when unused.
