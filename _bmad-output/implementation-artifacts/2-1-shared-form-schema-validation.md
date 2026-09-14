---
baseline_commit: 0be7a93983bede87701702a5823f7de5a87b574c
context:
  - "_bmad-output/planning-artifacts/epics.md"
  - "_bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/ARCHITECTURE-SPINE.md"
  - "_bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/solution-design.md"
  - "_bmad-output/implementation-artifacts/1-6-security-api-foundation.md"
---

# Story 2.1: Shared Form Schema Validation

Status: done

## Story

As a Full-Stack Developer,
I want a shared Zod schema package defining the Form Definition JSON structure, block types, and integrity metadata,
So that both the frontend Form Builder and backend APIs validate the form structure consistently and enforce data integrity upon publication.

## Acceptance Criteria

### AC1 — Shared Form Definition Contract
**Given** the monorepo architecture (`packages/schemas`)
**When** a form definition payload is validated
**Then**:
1. It must validate against `formDefinitionSchema` exported by `@rescom/schemas`.
2. Top-level fields are strictly validated:
   - `schemaVersion`: positive integer (default `1`).
   - `title`: string (min 1, max 200 characters, trimmed).
   - `description`: optional string (max 2000 characters).
   - `blocks`: non-empty array of block definitions (min 1 block).
   - `settings`: form-level settings object (e.g., `shuffleBlocks`, `progressBar`, `requireAuth`).
   - `metadata`: versioned integrity metadata object.
3. Every block must have a unique `id` within the form's `blocks` array.
4. Schema disallows unrecognized extra fields using `.strict()`.

### AC2 — Comprehensive Form Block Types Support
**Given** a form definition containing survey questions
**When** blocks are parsed and validated
**Then** the schema supports exactly 9 standard block types via discriminated union on `type`:
1. `text`: short text input (rules: `minLength`, `maxLength`, `placeholder`, `pattern`).
2. `textarea`: multi-line text input (rules: `minLength`, `maxLength`, `placeholder`).
3. `number`: numeric input (rules: `min`, `max`, `step`, `integerOnly`).
4. `single_choice`: radio button / dropdown single-select (requires `options` array with min 2 items `{ id, label, value }`, optional `allowOther`).
5. `multiple_choice`: multi-select checkboxes (requires `options` array with min 2 items, optional `minSelections`, `maxSelections`, `allowOther`).
6. `rating`: rating scale (rules: `maxRating` [e.g. 5, 10], `ratingShape` e.g. `'STAR' | 'NUMBER' | 'HEART'`).
7. `linear_scale`: Likert scale (rules: `min` [0 or 1], `max` [3 to 10], `minLabel`, `maxLabel`, `step`).
8. `date`: date picker (rules: `minDate`, `maxDate`, `includeTime`).
9. `file_upload`: file attachment block (rules: `maxFileSizeMb`, `allowedMimeTypes`, `maxFiles`).
All blocks must share common metadata: `id` (UUID or CUID string), `order` (non-negative integer), `title` (min 1, max 500 characters), `description` (optional helper text), and `required` (boolean, default false).

### AC3 — Versioned Integrity Metadata Specification
**Given** a form definition being designed for publication
**When** integrity metadata is defined
**Then**:
1. Form-level metadata includes:
   - `expectedEffortSeconds`: integer representing estimated completion duration (min 10, max 86400).
   - `minTimeBarrierSeconds`: integer threshold below which rapid submissions trigger bot/speedrun flags.
2. Block-level integrity options include:
   - `attentionCheck`: optional configuration `{ isAttentionCheck: boolean, expectedValue: string | number | string[], failAction: 'FLAG' | 'DISQUALIFY' }`.
   - `consistencyPair`: optional configuration `{ pairedBlockId: string, rule: 'EQUIVALENT' | 'OPPOSITE', tolerance?: number }`.
   - `semanticCategory`: optional category tag (`DEMOGRAPHIC`, `PSYCHOGRAPHIC`, `ATTENTION_CHECK`, `BEHAVIORAL`, `FEEDBACK`, `GENERAL`).
3. In-form consistency pairs must refer to existing `blockId`s within the same form definition.

### AC4 — Form Response & Answer Contract
**Given** respondent submissions for a form
**When** answers are validated against the form contract
**Then**:
1. `packages/schemas` exports `formAnswerSubmissionSchema` and `blockAnswerSchema`.
2. Each answer item must contain `blockId` (matching block id) and `value` (typed according to block type).
3. Payload rejects malformed or unmapped answer blocks.

### AC5 — Unit Test Suite & TypeScript Types
**Given** the test suite in `packages/schemas` and `apps/backend`
**When** tested via `npm run build` and `npm test`
**Then**:
1. TypeScript types (`FormDefinition`, `FormBlock`, `FormBlockType`, `FormAnswer`, etc.) are cleanly inferred and exported.
2. Unit tests verify valid form definitions parse successfully.
3. Unit tests verify each of the 9 block types enforces validation boundaries.
4. Unit tests verify that duplicate block IDs, negative effort seconds, or unknown block types fail with descriptive validation errors.
5. All 30 existing unit suites and 8 E2E suites continue to pass 100%.

---

## Tasks / Subtasks

- [x] **Task 1: Core Form Definition Schema (`packages/schemas`)** (AC: 1, 4)
  - [x] 1.1 Create `packages/schemas/src/forms/form-definition.schema.ts` defining `formDefinitionSchema` with `.strict()`.
  - [x] 1.2 Define form-level settings (`formSettingsSchema`) including shuffle, progress bar, and authentication requirements.
  - [x] 1.3 Implement refine check ensuring all block `id`s within `blocks` array are unique.

- [x] **Task 2: Standard Block Types & Discriminated Union** (AC: 2)
  - [x] 2.1 Create `packages/schemas/src/forms/form-blocks.schema.ts` defining the 9 block schemas (`textBlockSchema`, `textareaBlockSchema`, `numberBlockSchema`, `singleChoiceBlockSchema`, `multipleChoiceBlockSchema`, `ratingBlockSchema`, `linearScaleBlockSchema`, `dateBlockSchema`, `fileUploadBlockSchema`).
  - [x] 2.2 Combine blocks into discriminated union `formBlockSchema = z.discriminatedUnion('type', [...])`.
  - [x] 2.3 Export block types enum and TypeScript interfaces (`FormBlock`, `FormBlockInput`, etc.).

- [x] **Task 3: Versioned Integrity Metadata Schemas** (AC: 3)
  - [x] 3.1 Create `packages/schemas/src/forms/form-integrity.schema.ts` defining attention check configuration, consistency pairing, and semantic category tags.
  - [x] 3.2 Add cross-block validation rule verifying `pairedBlockId` references a valid sibling block in the same form and rejects self-pairing.
  - [x] 3.3 Integrate integrity schemas into `formBlockSchema` and `formDefinitionSchema`.

- [x] **Task 4: Response Submission & Answer Contracts** (AC: 4)
  - [x] 4.1 Create `packages/schemas/src/forms/form-answer.schema.ts` defining answer schemas for each block type and full submission payload `formSubmissionSchema`.
  - [x] 4.2 Export all schemas from `packages/schemas/src/index.ts`.

- [x] **Task 5: Unit Tests & Build Verification** (AC: 5)
  - [x] 5.1 Create unit tests `form-definition.schema.spec.ts` in `apps/backend/src/modules/forms/presentation/form-definition.schema.spec.ts`.
  - [x] 5.2 Test edge cases: empty titles, out-of-range ratings, duplicate block IDs, unreferenced paired blocks, extra fields rejection.
  - [x] 5.3 Verify `npm run build` in `packages/schemas` and `apps/backend`.
  - [x] 5.4 Verify all unit tests (`npm test`: 31 suites, 231 tests) and E2E tests (`npm run test:e2e`: 8 suites, 79 tests) pass 100%.

### Review Findings

- [x] [Review][Decision] Form Definition Top-Level `id` Field Requirement — In AC1, `id` was not listed as a required top-level field of `formDefinitionSchema` (only for blocks). Decision made: top-level `id` made optional for draft creation flexibility.
- [x] [Review][Patch] Validate and cap `textBlockSchema.pattern` to prevent ReDoS and invalid RegExp syntax crashes [packages/schemas/src/forms/form-blocks.schema.ts:47]
- [x] [Review][Patch] Enforce `minLength <= maxLength` in text and textarea block schemas [packages/schemas/src/forms/form-blocks.schema.ts:45]
- [x] [Review][Patch] Enforce `min <= max` and `z.number().finite()` in `numberBlockSchema` [packages/schemas/src/forms/form-blocks.schema.ts:67]
- [x] [Review][Patch] Enforce `minSelections <= maxSelections` and `minSelections <= options.length` in `multipleChoiceBlockSchema` [packages/schemas/src/forms/form-blocks.schema.ts:95]
- [x] [Review][Patch] Validate ISO date format and `minDate <= maxDate` in `dateBlockSchema` [packages/schemas/src/forms/form-blocks.schema.ts:131]
- [x] [Review][Patch] Enforce unique option IDs, unique option values, and `.trim().min(1)` on labels/values in choice blocks [packages/schemas/src/forms/form-blocks.schema.ts:18]
- [x] [Review][Patch] Validate linear scale step divisibility and `step <= max - min` [packages/schemas/src/forms/form-blocks.schema.ts:118]
- [x] [Review][Patch] Enforce attention check `expectedValue` validity against host block options or numeric ranges [packages/schemas/src/forms/form-definition.schema.ts:51]
- [x] [Review][Patch] Move `minTimeBarrierSeconds <= expectedEffortSeconds` refinement to `formIntegrityMetadataSchema` [packages/schemas/src/forms/form-integrity.schema.ts:50]
- [x] [Review][Patch] Reject duplicate `blockId`s in `formSubmissionSchema.answers` and enforce string/array payload caps [packages/schemas/src/forms/form-answer.schema.ts:26]
- [x] [Review][Patch] Export contract aliases `formAnswerSubmissionSchema`, `FormAnswer`, `FormAnswerSubmission` [packages/schemas/src/forms/form-answer.schema.ts:22]
- [x] [Review][Patch] Detect mutual circular consistency pairs between blocks [packages/schemas/src/forms/form-definition.schema.ts:51]
- [x] [Review][Patch] Add unit tests for negative effort seconds and adversarial validation boundaries [apps/backend/src/modules/forms/presentation/form-definition.schema.spec.ts:1]
- [x] [Review][Defer] Cross-block semantic type compatibility validation for consistency pairing rules [packages/schemas/src/forms/form-definition.schema.ts:51] — deferred to Story 2.6 (Publish Lifecycle Immutability) / Epic 10
- [x] [Review][Defer] Dynamic form submission validator against specific FormDefinition instances (AC4.2 / AC4.3) [packages/schemas/src/forms/form-answer.schema.ts:1] — deferred to Story 5.4 (Internal Form Submission)

---

## Dev Notes

### Architecture Compliance & Guardrails
- **Single Source of Truth:** `packages/schemas` is the contract shared across backend NestJS controllers and Next.js frontend form builder. No duplicated form schemas are permitted.
- **Strict Validation:** Every schema MUST use `.strict()` so unrecognized fields from malicious requests or corrupted versions are rejected immediately.
- **FormVersion Immutability Seam:** The `schemaJson` stored in Prisma's `FormVersion` model conforms directly to `FormDefinition`. Once `FormVersion.isPublished` is true, this JSON is locked immutably per AD-19.

---

## Dev Agent Record

### Implementation Plan
1. Define integrity metadata schemas (`form-integrity.schema.ts`): attention check, consistency pairing, semantic categories, effort/barrier timing.
2. Define the 9 individual survey block schemas and create a discriminated union on `type` (`form-blocks.schema.ts`).
3. Define the top-level form definition schema (`form-definition.schema.ts`) with `.strict()` and cross-block validations (unique IDs, valid paired references, timing constraints).
4. Define answer and submission contracts (`form-answer.schema.ts`).
5. Re-export all schemas in `packages/schemas/src/forms/index.ts` and root `packages/schemas/src/index.ts`.
6. Compile schemas package via `tsc`.
7. Author comprehensive unit test suite in `apps/backend/src/modules/forms/presentation/form-definition.schema.spec.ts`.
8. Verify all 31 unit test suites (238 tests) and 8 E2E suites (79 tests) pass cleanly with 0 lint errors.

### Completion Notes
- Implemented `formDefinitionSchema` in `@rescom/schemas` with full `.strict()` enforcement.
- Supported all 9 survey block types: `text`, `textarea`, `number`, `single_choice`, `multiple_choice`, `rating`, `linear_scale`, `date`, `file_upload`.
- Configured versioned integrity metadata: effort/time barrier, attention checks, consistency pairing, and semantic category tags.
- Defined `blockAnswerSchema`, `formSubmissionSchema`, and exported aliases `formAnswerSubmissionSchema`, `FormAnswer`, `FormAnswerSubmission`.
- Completed adversarial code review with 3 parallel layers (Blind Hunter, Edge Case Hunter, Acceptance Auditor), resolved 1 decision, and applied 13 patches (ReDoS pattern safety, boundary and range validations, finite numbers, option uniqueness, attention check expectedValue validation, circular pair detection, payload bounds, and expanded unit tests).
- All 31 unit test suites (238 tests) and 8 E2E test suites (79 tests) pass 100%.
- ESLint and Prettier checks passed cleanly.

---

## File List

### New Files
- `packages/schemas/src/forms/form-integrity.schema.ts`
- `packages/schemas/src/forms/form-blocks.schema.ts`
- `packages/schemas/src/forms/form-definition.schema.ts`
- `packages/schemas/src/forms/form-answer.schema.ts`
- `packages/schemas/src/forms/index.ts`
- `apps/backend/src/modules/forms/presentation/form-definition.schema.spec.ts`

### Modified Files
- `package.json`
- `packages/schemas/src/index.ts`

---

## Change Log
- 2026-09-14: Created Story 2.1 specification for Shared Form Schema Validation.
- 2026-09-14: Implemented shared form definition schemas, 9 block types, integrity metadata, answer submission contracts, and comprehensive unit tests. Status transitioned to `review`.
- 2026-09-14: Adversarial code review completed (Blind Hunter, Edge Case Hunter, Acceptance Auditor). Resolved 1 decision-needed item (optional top-level id), applied 13 patches (ReDoS regex validation, range invariants, finite numbers, option deduplication, linear scale divisibility, ISO date constraints, attention check validity, timing refinement, submission duplicate block ID rejection, AC4/5 contract aliases, circular pair detection, and 7 new adversarial unit tests), and deferred 2 items. All 31 unit suites (238 tests) and 8 E2E suites (79 tests) 100% green. Status transitioned to `done`.
