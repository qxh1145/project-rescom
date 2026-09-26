---
baseline_commit: a40a63c202dfab9d3bac0b818eb5287211e1070d
context:
  - "_bmad-output/planning-artifacts/epics.md"
  - "_bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/ARCHITECTURE-SPINE.md"
  - "_bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/solution-design.md"
  - "_bmad-output/planning-artifacts/prds/prd-project-rescom-2026-08-08/prd.md"
  - "apps/backend/prisma/schema.prisma"
  - "packages/schemas/src/forms/form-blocks.schema.ts"
  - "apps/frontend/my-app/app/forms/components/renderer/blocks/RespondentFileUploadBlock.tsx"
---

# Story 5.3: File Upload Validation & Secure Storage

Status: done

## Story

As a Respondent,
I want to upload files securely if a question requires it,
So that I can provide complete data without risking system security.

## Acceptance Criteria

### AC1 — Shared Storage Contracts & Validation Schemas (`packages/schemas`)
**Given** the shared schemas package
**When** defining file storage and upload contracts (FR-ADD-10, AD-22)
**Then**:
1. Defines `storedObjectStatusEnum`: `INITIATED`, `UPLOADED`, `QUARANTINED`, `CLEAN`, `ATTACHED`, `REJECTED`, `EXPIRED`, `DELETED`.
2. Defines `storedObjectScanStatusEnum`: `PENDING`, `CLEAN`, `INFECTED`, `OUTAGE`, `SKIPPED`.
3. Defines `storageDataClassEnum`: `SURVEY_ATTACHMENT`, `EVIDENCE`, `EXPORT`.
4. `initiateUploadInputSchema` validates:
   - `fileName`: string (1-255 characters, stripped of dangerous path traversals)
   - `fileSize`: positive integer bytes (capped by global safety maximum 50MB)
   - `mimeType`: valid MIME format string
   - `ownerContext`: enum or string (`participation`, `forms`, `research`)
   - `ownerRecordId`: UUID string (survey attempt ID, response ID, or form ID)
   - `questionId`: optional string identifying the form question block
   - `checksum`: optional string (e.g. SHA-256)
5. `finalizeUploadInputSchema` validates:
   - `objectId`: string UUID
   - `checksum`: optional string
6. `storedObjectDtoSchema` and `getDownloadUrlResponseSchema` provide typed representations of stored objects and scoped presigned download URLs.
7. TypeScript types are exported from `@rescom/schemas`.

### AC2 — Durable Prisma StoredObject Model (`apps/backend/prisma/schema.prisma`)
**Given** the PostgreSQL schema
**When** modeling object storage metadata according to AD-22
**Then**:
1. Defines `StoredObject` table with fields: `id`, `ownerContext`, `ownerRecordId`, `dataClass`, `storageKey` (unique), `bucket`, `fileName`, `fileSize`, `mimeType`, `checksum`, `status`, `scanStatus`, `scanPolicy`, `scanResult`, `uploadedAt`, `scannedAt`, `attachedAt`, `expiresAt`, `createdAt`, `updatedAt`.
2. Adds indices on `[ownerContext, ownerRecordId]` and `[status, scanStatus]` for efficient lookups.
3. Implements the durable state machine: `INITIATED` -> `UPLOADED` -> `QUARANTINED` -> `CLEAN` -> `ATTACHED`, with terminal `REJECTED`, `EXPIRED`, `DELETED`.

### AC3 — Backend Storage Module & Presigned Upload Flow (`apps/backend`)
**Given** an authorized client answering a survey requiring file upload
**When** calling `POST /api/storage/uploads/initiate`
**Then**:
1. Backend validates the file metadata against question block configuration (if questionId is supplied) and global security constraints:
   - File size must not exceed `block.maxFileSizeMb` (or default 10MB, max 50MB).
   - MIME type must match `block.allowedMimeTypes` (e.g., `image/*`, `application/pdf`).
   - Dangerous/executable types (`application/x-msdownload`, `application/x-sh`, scripts, HTML) are strictly rejected.
2. Generates an owner-bound, opaque storage key (e.g. `participation/{ownerRecordId}/{uuid}-{sanitizedFileName}`).
3. Generates a secure, time-limited S3 presigned PUT URL (15 minutes expiry) scoped strictly to that storage key.
4. Persists a `StoredObject` record in `INITIATED` state and returns `{ objectId, uploadUrl, storageKey, expiresAt }`.

### AC4 — Upload Finalization, Quarantine & Malware Scanning (`apps/backend`)
**Given** a file uploaded to object storage
**When** calling `POST /api/storage/uploads/:id/finalize`
**Then**:
1. Transitions the object from `INITIATED` to `UPLOADED` then immediately `QUARANTINED`.
2. Triggers malware inspection via `MalwareScannerPort`:
   - If clean: transitions status to `CLEAN` and `scanStatus` to `CLEAN`.
   - If infected: transitions status to `REJECTED` and `scanStatus` to `INFECTED`.
   - If scanner outage / error: status remains `QUARANTINED`, `scanStatus` set to `OUTAGE`, and fails closed (object cannot be attached or downloaded, per AD-22).
3. Download endpoint `GET /api/storage/objects/:id/download-url`:
   - Strictly enforces that only `CLEAN` or `ATTACHED` objects can generate download URLs.
   - Any attempt to download `INITIATED`, `UPLOADED`, `QUARANTINED`, or `REJECTED` objects returns HTTP 403 Forbidden.
   - Verifies owner access permissions before issuing short-lived signed GET URLs.

### AC5 — Frontend Secure File Upload & Verification UX (`apps/frontend/my-app`)
**Given** a survey respondent encountering a `file_upload` block
**When** selecting or dragging a file
**Then**:
1. Client-side validation checks file size and allowed MIME types instantly with clear error feedback.
2. Initiates presigned upload with the backend, tracks upload progress, and uploads directly via HTTP PUT.
3. Automatically triggers finalization and malware scanning upon upload completion.
4. Displays visual status badges: uploading progress spinner, "Scanning for malware...", and verified "Clean & Verified" checkmark.
5. If scanning detects malware or quarantine fails, displays a clear warning and allows file removal and retry.
6. Updates form answer state with clean file metadata (`objectId`, `fileName`, `fileSize`, `mimeType`, `status: 'CLEAN'`).

---

## Tasks / Subtasks

- [x] Task 1: Shared Storage Schemas & Validation Contracts (`packages/schemas`)
  - [x] 1.1 Create `packages/schemas/src/storage/file-storage.schema.ts` with enums and Zod schemas.
  - [x] 1.2 Export storage contracts from `packages/schemas/src/index.ts`.
  - [x] 1.3 Add unit tests in `packages/schemas/src/storage/file-storage.schema.spec.ts`.
  - [x] 1.4 Verify schemas build and tests pass.

- [x] Task 2: Database Storage Model & Migration (`apps/backend/prisma/schema.prisma`)
  - [x] 2.1 Add `StoredObjectStatus`, `StoredObjectScanStatus`, `StorageDataClass` enums.
  - [x] 2.2 Add `StoredObject` model adhering to AD-22.
  - [x] 2.3 Run `npx prisma generate` to update Prisma client.

- [x] Task 3: Backend Storage Module & Domain Architecture (`apps/backend/src/modules/storage`)
  - [x] 3.1 Create `StoredObjectEntity` domain entity with immutable state transition methods.
  - [x] 3.2 Define `StorageRepositoryPort`, `ObjectStoragePort`, and `MalwareScannerPort`.
  - [x] 3.3 Implement `PrismaStorageRepository` and `InMemoryStorageRepository`.
  - [x] 3.4 Implement `S3ObjectStorageService` with scoped presigned PUT/GET URL generation.
  - [x] 3.5 Implement `StubMalwareScannerService` supporting clean scans, malware detection, and fail-closed outage simulation.
  - [x] 3.6 Implement `StorageService` orchestrating initiation, finalization, scanning, and download URL generation.

- [x] Task 4: Backend Presentation, Security Controller & API Endpoints
  - [x] 4.1 Create `StorageController` with `POST /api/storage/uploads/initiate`, `POST /api/storage/uploads/:id/finalize`, `GET /api/storage/objects/:id/download-url`, and `GET /api/storage/objects/:id/status`.
  - [x] 4.2 Integrate with `SessionAuthGuard` to support authenticated and guest attempt sessions.
  - [x] 4.3 Register `StorageModule` in `AppModule`.
  - [x] 4.4 Create unit tests (`storage.service.spec.ts`, `storage.controller.spec.ts`).
  - [x] 4.5 Create E2E test suite in `apps/backend/test/file-storage.e2e-spec.ts`.

- [x] Task 5: Frontend File Upload Component & Verification UX (`apps/frontend/my-app`)
  - [x] 5.1 Upgrade `RespondentFileUploadBlock.tsx` with presigned URL upload flow, direct PUT execution, and status transitions.
  - [x] 5.2 Add progress indicator, malware scanning state, and clean verified badges.
  - [x] 5.3 Implement error handling and quarantine failure recovery.
  - [x] 5.4 Add unit/integration tests in `apps/frontend/my-app/tests/file-upload.test.mjs`.

- [x] Task 6: Comprehensive Verification & Regression Testing
  - [x] 6.1 Run all test suites across `@rescom/schemas`, `apps/backend`, and `apps/frontend/my-app`.
  - [x] 6.2 Verify zero TypeScript or lint errors.
  - [x] 6.3 Update story status and sprint status to `review`.

### Review Findings

- [x] [Review][Patch] [High] Require authenticated or owner-bound guest access and enforce ownership for initiate, finalize, status, download, and attach operations [apps/backend/src/modules/storage/presentation/storage.controller.ts:44]
- [x] [Review][Patch] [High] Replace the production-wired mock storage service with real private S3-compatible storage and enforce signature, expiry, method, key, MIME, and size constraints [apps/backend/src/modules/storage/infrastructure/s3-object-storage.service.ts:35]
- [x] [Review][Patch] [High] Verify the uploaded object exists and validate authoritative size, content type, signature, and checksum before finalization [apps/backend/src/modules/storage/application/storage.service.ts:120]
- [x] [Review][Patch] [High] Replace the filename-based malware stub in production with a scanner that inspects quarantined object bytes and fails closed [apps/backend/src/modules/storage/infrastructure/stub-malware-scanner.service.ts:15]
- [x] [Review][Patch] [High] Resolve the immutable question block and enforce its size, MIME, and file-count constraints server-side [apps/backend/src/modules/storage/application/storage.service.ts:47]
- [x] [Review][Patch] [High] Persist UPLOADED and QUARANTINED before scanning, record thrown scanner failures as OUTAGE, and make concurrent/repeated finalization safe [apps/backend/src/modules/storage/application/storage.service.ts:125]
- [x] [Review][Patch] [High] Bind frontend uploads to the real attempt or response owner instead of the nil UUID [apps/frontend/my-app/app/forms/components/renderer/blocks/RespondentFileUploadBlock.tsx:91]
- [x] [Review][Patch] [High] Add and verify a Prisma migration for the StoredObject enums, table, unique constraint, and indices [apps/backend/prisma/schema.prisma:179]
- [x] [Review][Patch] [Medium] Reject malformed finalize bodies instead of silently dropping invalid checksums [apps/backend/src/modules/storage/presentation/storage.controller.ts:70]
- [x] [Review][Patch] [Medium] Apply every signed upload header returned by the initiation response during the direct PUT [apps/frontend/my-app/app/forms/components/renderer/blocks/RespondentFileUploadBlock.tsx:119]
- [x] [Review][Patch] [Medium] Emit the specified clean attachment fields `fileName`, `fileSize`, and `mimeType` from shared types [apps/frontend/my-app/app/forms/components/renderer/blocks/RespondentFileUploadBlock.tsx:209]
- [x] [Review][Patch] [Medium] Track actual transferred bytes instead of displaying fixed pseudo-progress values [apps/frontend/my-app/app/forms/components/renderer/blocks/RespondentFileUploadBlock.tsx:80]
- [x] [Review][Patch] [Medium] Add authorized cancellation/deletion and expiry cleanup so removal and retry do not orphan metadata or blobs [apps/frontend/my-app/app/forms/components/renderer/blocks/RespondentFileUploadBlock.tsx:271]
- [x] [Review][Patch] [Medium] Make multi-file slot reservation atomic so rapid selections cannot exceed limits or orphan concurrent uploads [apps/frontend/my-app/app/forms/components/renderer/blocks/RespondentFileUploadBlock.tsx:223]
- [x] [Review][Patch] [Medium] Reject zero-byte and invalid-size files in client-side validation before initiating an upload [apps/frontend/my-app/app/forms/hooks/file-upload-handler.mjs:62]


### Review Findings (Epic 5 code review, 2026-09-26)

_Second review pass (triage IDs in brackets; applied after the Epic 4 and Epic 6 review patches). The block above is the earlier 2026-09-24 review and is unchanged. Dismissed items are summarized in Story 5.1; the attach-side checks (P3/P4 — `questionId` now required for participation uploads) and the AD-20 CSRF guard on storage mutations (P12) are recorded in Story 5.4._

- [x] [Review][Patch] The presigned PUT stays valid after finalize, so the bytes served are not the bytes that were scanned (P10, medium) — fixed: `ObjectStoragePort.getObjectMetadata` returns an `etag`; new `copyObject(…, ifMatchEtag)` (S3 `CopySourceIfMatch`; in-memory MD5 ETag). Finalize: HEAD (size, type, ETag — the object stays INITIATED on failure) → claim INITIATED → QUARANTINED persisting the server-owned key `verified/{ownerContext}/{ownerRecordId}/{objectId}` → conditional copy (412 → REJECTED, "Object changed during finalization") → delete the upload key → signature, checksum and scan on the verified key. Downloads and attachments use only the verified key, which no presigned URL can write. Deviation from the plan: claim before copy, so a losing concurrent finalize can no longer overwrite the verified key after the winner scanned it. Behaviour changes: checksum/signature failures now leave the object REJECTED (400; a repeated finalize returns 200 with REJECTED) instead of INITIATED, and finalize returns a `storageKey` different from initiate's. The optional ContentLength signing was not applied (size is enforced by HEAD + ETag + the verified bytes). In-memory tests: a re-PUT after CLEAN does not change the downloaded bytes; a re-PUT between HEAD and copy → rejected. [apps/backend/src/modules/storage/application/storage.service.ts:215]
- [x] [Review][Patch] The storage cleanup timer can crash the API on a transient error, and one failure aborts the batch (P11, medium) — fixed: the timer calls `runCleanup()`, which never rejects and logs through Nest `Logger` (object id + message only); per-object try/catch; `findExpiredUnattached(now, limit = 200)` oldest first; each object is claimed EXPIRED (compare-and-set, P18) before its bytes are deleted; `cleanupExpired` returns `{ expired, failures }`. A byte delete that fails after the claim is logged and the bytes stay orphaned (recommended backstop: a bucket lifecycle rule expiring non-`verified/` prefixes after ~1 day). New `storage-cleanup.service.spec.ts`. The multi-replica lease stays DF11. [apps/backend/src/modules/storage/infrastructure/storage-cleanup.service.ts:35]
- [x] [Review][Patch] Storage owner authorization makes no read/write distinction (P16, low) — fixed: `authorize(…, access: 'read' | 'write')`; **write** (initiate, finalize, attach, delete) requires an IN_PROGRESS attempt with `startedAt ≥ now − RESERVATION_EXPIRY_MS` (constant moved to `@rescom/schemas`, shared with Participation); **read** (status, download-url) allows IN_PROGRESS or COMPLETED, so the owner can read their own ATTACHED file. Owner rules and the forms path are unchanged. Spec cases for each. [apps/backend/src/modules/storage/infrastructure/prisma-storage-owner-authorization.service.ts:28]
- [x] [Review][Patch] Upload type checks are a thin denylist (P17, low) — fixed: `image/svg+xml`, `application/x-httpd-php`, `application/java-archive` added to `DISALLOWED_MIME_TYPES`; `.ps1 .jar .hta .php .phtml .msc .lnk .vbe .jse .wsf .xhtml .shtml .svgz` added to the extension denylist, checked after stripping trailing dots and whitespace; the first 512 bytes (after a BOM and leading whitespace) are sniffed for `<!doctype html`, `<html`, `<script`, `<svg`, `<?php` and `<?xml` containing `<svg`. The frontend's UX copy of the denylist mirrors the new entries. Schema, service and frontend tests. [apps/backend/src/modules/storage/application/storage.service.ts:698]
- [x] [Review][Patch] Storage state transitions are not compare-and-set: deleting a file during its scan resurrects it as CLEAN with no bytes, still counting toward `maxFiles` (P18, low) — fixed: `StorageRepositoryPort.transition(id, expectedStatus, entity)` (Prisma `updateMany` + `count === 1`; the in-memory repository now returns copies so the compare-and-set is real; the redundant `claimForScan` is removed); finalize, delete, attach and cleanup use it; a lost race re-reads (finalize returns the latest DTO; delete refuses an object that became ATTACHED). Tests: delete during scan stays DELETED and no longer counts toward `maxFiles`; concurrent attach; idempotent delete. [apps/backend/src/modules/storage/infrastructure/prisma-storage.repository.ts:41]
- [x] [Review][Defer] The Publisher cannot download ATTACHED survey files (DF4, medium) [apps/backend/src/modules/storage/infrastructure/prisma-storage-owner-authorization.service.ts:28] — deferred: there is no Publisher response viewer (Epic 9 dashboards are Phase 2) and AD-17 row-authorization projections need Privacy input; P16 restores the respondent's own read access.
- [x] [Review][Defer] Finalize buffers the whole object twice (up to 50 MB each, unbounded concurrency); files above clamd's `StreamMaxLength` are reported as an outage (DF9, low) [apps/backend/src/modules/storage/application/storage.service.ts:215] — deferred: performance/ops only, fails closed. Rework with P10's copy flow (a Range read for the signature, a streaming hash and scan); set clamd `StreamMaxLength ≥ 50M` explicitly in ops config.
- [x] [Review][Defer] Parallel `initiateUpload` calls can exceed `block.maxFiles` (count, then insert) (DF10, low) [apps/backend/src/modules/storage/application/storage.service.ts] — deferred: only the uploader can trigger it and extra objects expire; after P3/P4 at most `maxFiles` objects can be attached.
- [x] [Review][Defer] The cleanup runs on every API instance with no lease (DF11, low) [apps/backend/src/modules/storage/infrastructure/storage-cleanup.service.ts] — deferred: the single-replica profile (`REDIS_DISABLED_SINGLE_REPLICA`) is in use; move it to the AD-5/AD-17 leased worker (P11 added the error handling and batching).

---

## Dev Notes

### Architecture & AD-22 Compliance
- **Private Object Storage Boundary:** Object storage is completely private. Neither the frontend nor external parties ever receive permanent credentials.
- **Durable State Machine:** `INITIATED` -> `UPLOADED` -> `QUARANTINED` -> `CLEAN` -> `ATTACHED`. Only `CLEAN` objects may become `ATTACHED` to a Response or downloadable.
- **Fail-Closed on Outage:** If malware scanning fails or experiences an outage, the object remains `QUARANTINED` with `scanStatus: OUTAGE`. It cannot be attached or downloaded.
- **Sanitized Keys & Scoping:** Keys are owner-bound: `participation/{ownerRecordId}/{uuid}-{sanitizedFileName}`. Path traversal attempts (`../`, `..\`) are stripped immediately.

---

## Dev Agent Record

### Debug Log
- Validated shared storage schemas in `@rescom/schemas` (`file-storage.schema.ts`).
- Verified Prisma `StoredObject` schema model, enums (`StoredObjectStatus`, `StoredObjectScanStatus`, `StorageDataClass`), and migration `20260916090000_add_secure_stored_objects`.
- Verified backend domain `StoredObjectEntity` with state machine and transition guards.
- Verified `S3ObjectStorageService` using AWS SDK client S3 and signed PUT/GET URLs.
- Verified ClamAV streaming socket scanner `ClamAvMalwareScannerService` and test stub `StubMalwareScannerService` with fail-closed behavior on outage.
- Verified server-side question block resolution and size/MIME/file count constraints via `PrismaStorageOwnerAuthorizationService`.
- Verified ownership verification for authenticated and guest attempts (via signed storage capability tokens) across all storage endpoints.
- Resolved ESLint rules (`@typescript-eslint/no-explicit-any` and React 19 purity warnings) in `RespondentFileUploadBlock.tsx`.

### Completion Notes
- Implemented and verified the full end-to-end secure file upload lifecycle per AD-22:
  1. Presigned scoped PUT upload URL generation with 15-minute expiry.
  2. Direct client PUT with progress tracking and exact header propagation.
  3. Authoritative server verification (existence, size, content type, magic byte signature, and sha256 checksum).
  4. Quarantined status persistence followed by malware inspection (ClamAV stream socket / stub scanner).
  5. Fail-closed behavior on scanner outage (remains QUARANTINED, scanStatus OUTAGE, HTTP 503).
  6. Secure download URL generation restricted strictly to CLEAN / ATTACHED objects (HTTP 403 otherwise).
  7. Client cancellation/deletion and backend expired unattached object cleanup.
- All unit, integration, and E2E test suites pass across `@rescom/schemas`, `apps/backend`, and `apps/frontend/my-app`.

---

## File List
- `packages/schemas/src/storage/file-storage.schema.ts`
- `packages/schemas/src/storage/file-storage.schema.spec.ts`
- `packages/schemas/src/storage/index.ts`
- `packages/schemas/src/index.ts`
- `apps/backend/prisma/schema.prisma`
- `apps/backend/prisma/migrations/20260916090000_add_secure_stored_objects/migration.sql`
- `apps/backend/src/modules/storage/domain/stored-object.entity.ts`
- `apps/backend/src/modules/storage/application/ports/storage-repository.port.ts`
- `apps/backend/src/modules/storage/application/ports/object-storage.port.ts`
- `apps/backend/src/modules/storage/application/ports/malware-scanner.port.ts`
- `apps/backend/src/modules/storage/application/ports/storage-owner-authorization.port.ts`
- `apps/backend/src/modules/storage/application/exceptions/storage.exceptions.ts`
- `apps/backend/src/modules/storage/application/storage.service.ts`
- `apps/backend/src/modules/storage/application/storage.service.spec.ts`
- `apps/backend/src/modules/storage/infrastructure/prisma-storage.repository.ts`
- `apps/backend/src/modules/storage/infrastructure/in-memory-storage.repository.ts`
- `apps/backend/src/modules/storage/infrastructure/s3-object-storage.service.ts`
- `apps/backend/src/modules/storage/infrastructure/in-memory-object-storage.service.ts`
- `apps/backend/src/modules/storage/infrastructure/clamav-malware-scanner.service.ts`
- `apps/backend/src/modules/storage/infrastructure/stub-malware-scanner.service.ts`
- `apps/backend/src/modules/storage/infrastructure/prisma-storage-owner-authorization.service.ts`
- `apps/backend/src/modules/storage/infrastructure/prisma-storage-owner-authorization.service.spec.ts`
- `apps/backend/src/modules/storage/infrastructure/storage-cleanup.service.ts`
- `apps/backend/src/modules/storage/presentation/storage.controller.ts`
- `apps/backend/src/modules/storage/presentation/storage.controller.spec.ts`
- `apps/backend/src/modules/storage/storage.module.ts`
- `apps/backend/test/file-storage.e2e-spec.ts`
- `apps/frontend/my-app/app/forms/components/renderer/blocks/RespondentFileUploadBlock.tsx`
- `apps/frontend/my-app/app/forms/hooks/file-upload-handler.mjs`
- `apps/frontend/my-app/tests/file-upload.test.mjs`
- `apps/backend/src/modules/storage/infrastructure/storage-cleanup.service.spec.ts`
- `packages/schemas/src/participation/survey-attempt.schema.ts`

---

## Change Log
- 2026-09-24: Addressed all code review findings (15 items resolved). Completed and verified end-to-end file upload lifecycle, ClamAV fail-closed scanning, signed upload/download flows, ownership enforcement, and clean UX feedback. Updated story status to `review`.
- 2026-09-26: Code review 2026-09-26: Epic 5 review findings written as a new dated block (5 patches applied — P10 verified-key finalize, P11, P16, P17, P18; 4 deferred — DF4, DF9, DF10, DF11; attach/CSRF items tracked in Story 5.4); no decisions open; status set to done.
