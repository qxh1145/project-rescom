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

Status: ready-for-dev

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

- [ ] Task 1: Shared Storage Schemas & Validation Contracts (`packages/schemas`)
  - [ ] 1.1 Create `packages/schemas/src/storage/file-storage.schema.ts` with enums and Zod schemas.
  - [ ] 1.2 Export storage contracts from `packages/schemas/src/index.ts`.
  - [ ] 1.3 Add unit tests in `packages/schemas/src/storage/file-storage.schema.spec.ts`.
  - [ ] 1.4 Verify schemas build and tests pass.

- [ ] Task 2: Database Storage Model & Migration (`apps/backend/prisma/schema.prisma`)
  - [ ] 2.1 Add `StoredObjectStatus`, `StoredObjectScanStatus`, `StorageDataClass` enums.
  - [ ] 2.2 Add `StoredObject` model adhering to AD-22.
  - [ ] 2.3 Run `npx prisma generate` to update Prisma client.

- [ ] Task 3: Backend Storage Module & Domain Architecture (`apps/backend/src/modules/storage`)
  - [ ] 3.1 Create `StoredObjectEntity` domain entity with immutable state transition methods.
  - [ ] 3.2 Define `StorageRepositoryPort`, `ObjectStoragePort`, and `MalwareScannerPort`.
  - [ ] 3.3 Implement `PrismaStorageRepository` and `InMemoryStorageRepository`.
  - [ ] 3.4 Implement `S3ObjectStorageService` with scoped presigned PUT/GET URL generation.
  - [ ] 3.5 Implement `StubMalwareScannerService` supporting clean scans, malware detection, and fail-closed outage simulation.
  - [ ] 3.6 Implement `StorageService` orchestrating initiation, finalization, scanning, and download URL generation.

- [ ] Task 4: Backend Presentation, Security Controller & API Endpoints
  - [ ] 4.1 Create `StorageController` with `POST /api/storage/uploads/initiate`, `POST /api/storage/uploads/:id/finalize`, `GET /api/storage/objects/:id/download-url`, and `GET /api/storage/objects/:id/status`.
  - [ ] 4.2 Integrate with `SessionAuthGuard` to support authenticated and guest attempt sessions.
  - [ ] 4.3 Register `StorageModule` in `AppModule`.
  - [ ] 4.4 Create unit tests (`storage.service.spec.ts`, `storage.controller.spec.ts`).
  - [ ] 4.5 Create E2E test suite in `apps/backend/test/file-storage.e2e-spec.ts`.

- [ ] Task 5: Frontend File Upload Component & Verification UX (`apps/frontend/my-app`)
  - [ ] 5.1 Upgrade `RespondentFileUploadBlock.tsx` with presigned URL upload flow, direct PUT execution, and status transitions.
  - [ ] 5.2 Add progress indicator, malware scanning state, and clean verified badges.
  - [ ] 5.3 Implement error handling and quarantine failure recovery.
  - [ ] 5.4 Add unit/integration tests in `apps/frontend/my-app/tests/file-upload.test.mjs`.

- [ ] Task 6: Comprehensive Verification & Regression Testing
  - [ ] 6.1 Run all test suites across `@rescom/schemas`, `apps/backend`, and `apps/frontend/my-app`.
  - [ ] 6.2 Verify zero TypeScript or lint errors.
  - [ ] 6.3 Update story status and sprint status to `review`.

### Review Findings

- [ ] [Review][Patch] [High] Require authenticated or owner-bound guest access and enforce ownership for initiate, finalize, status, download, and attach operations [apps/backend/src/modules/storage/presentation/storage.controller.ts:44]
- [ ] [Review][Patch] [High] Replace the production-wired mock storage service with real private S3-compatible storage and enforce signature, expiry, method, key, MIME, and size constraints [apps/backend/src/modules/storage/infrastructure/s3-object-storage.service.ts:35]
- [ ] [Review][Patch] [High] Verify the uploaded object exists and validate authoritative size, content type, signature, and checksum before finalization [apps/backend/src/modules/storage/application/storage.service.ts:120]
- [ ] [Review][Patch] [High] Replace the filename-based malware stub in production with a scanner that inspects quarantined object bytes and fails closed [apps/backend/src/modules/storage/infrastructure/stub-malware-scanner.service.ts:15]
- [ ] [Review][Patch] [High] Resolve the immutable question block and enforce its size, MIME, and file-count constraints server-side [apps/backend/src/modules/storage/application/storage.service.ts:47]
- [ ] [Review][Patch] [High] Persist UPLOADED and QUARANTINED before scanning, record thrown scanner failures as OUTAGE, and make concurrent/repeated finalization safe [apps/backend/src/modules/storage/application/storage.service.ts:125]
- [ ] [Review][Patch] [High] Bind frontend uploads to the real attempt or response owner instead of the nil UUID [apps/frontend/my-app/app/forms/components/renderer/blocks/RespondentFileUploadBlock.tsx:91]
- [ ] [Review][Patch] [High] Add and verify a Prisma migration for the StoredObject enums, table, unique constraint, and indices [apps/backend/prisma/schema.prisma:179]
- [ ] [Review][Patch] [Medium] Reject malformed finalize bodies instead of silently dropping invalid checksums [apps/backend/src/modules/storage/presentation/storage.controller.ts:70]
- [ ] [Review][Patch] [Medium] Apply every signed upload header returned by the initiation response during the direct PUT [apps/frontend/my-app/app/forms/components/renderer/blocks/RespondentFileUploadBlock.tsx:119]
- [ ] [Review][Patch] [Medium] Emit the specified clean attachment fields `fileName`, `fileSize`, and `mimeType` from shared types [apps/frontend/my-app/app/forms/components/renderer/blocks/RespondentFileUploadBlock.tsx:209]
- [ ] [Review][Patch] [Medium] Track actual transferred bytes instead of displaying fixed pseudo-progress values [apps/frontend/my-app/app/forms/components/renderer/blocks/RespondentFileUploadBlock.tsx:80]
- [ ] [Review][Patch] [Medium] Add authorized cancellation/deletion and expiry cleanup so removal and retry do not orphan metadata or blobs [apps/frontend/my-app/app/forms/components/renderer/blocks/RespondentFileUploadBlock.tsx:271]
- [ ] [Review][Patch] [Medium] Make multi-file slot reservation atomic so rapid selections cannot exceed limits or orphan concurrent uploads [apps/frontend/my-app/app/forms/components/renderer/blocks/RespondentFileUploadBlock.tsx:223]
- [ ] [Review][Patch] [Medium] Reject zero-byte and invalid-size files in client-side validation before initiating an upload [apps/frontend/my-app/app/forms/hooks/file-upload-handler.mjs:62]

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
*(Will be populated during implementation)*

### Completion Notes
*(Will be populated upon completion)*

---

## File List
*(Will be populated during implementation)*

---

## Change Log
*(Will be populated during implementation)*
