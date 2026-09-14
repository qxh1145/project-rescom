# Story 1.1 implementation learnings

- Registration must generate the user ID and sign the access token before calling repository persistence; the same ID is passed to both operations so signer failure leaves no partial account.
- Keep `AuthService` framework-agnostic and construct it in `AuthModule` with a `useFactory` provider over the repository, hasher, and token ports.
- `CreateUserData.id` remains optional for non-registration callers, while both repository adapters honor an explicitly supplied application-generated ID.
- Architecture boundary tests should scan all module source files and classify their layer before applying forbidden-import rules; a synthetic application-service import prevents filename-based exemptions from silently weakening the boundary.
- Shared credential validation rejects ill-formed UTF-16 before applying bcrypt's 72-byte UTF-8 limit; registration length uses `Intl.Segmenter` grapheme clusters, and email normalization is followed by RFC part-length checks.
- Build and cache the dummy bcrypt hash per hasher instance at startup with the configured rounds; this preserves comparable work for unknown accounts without regenerating a salt on a request.
- Let `bcryptjs.compare` return `false` for ordinary mismatches and malformed string hashes, while allowing exceptional failures to propagate; the dummy timing path must propagate failures as well.
- Build `@rescom/schemas` in its `prepare` lifecycle and in backend `prebuild`/`pretest` hooks so clean installs and direct backend workflows resolve its declared `dist` entry point reliably.
