---
baseline_commit: a40a63c202dfab9d3bac0b818eb5287211e1070d
context:
  - "_bmad-output/planning-artifacts/epics.md"
  - "_bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/ARCHITECTURE-SPINE.md"
  - "_bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/solution-design.md"
  - "_bmad-output/implementation-artifacts/2-1-shared-form-schema-validation.md"
---

# Story 2.3: Form Builder Canvas & Block Types

Status: done

## Story

As a Publisher,
I want to build my form using a drag-and-drop canvas supporting various input blocks,
So that I can construct complex surveys intuitively.

## Acceptance Criteria

### AC1 — Drag-and-Drop Toolbox & Canvas Dropzone
**Given** the Form Builder interface (`apps/frontend/my-app/app/forms/[id]/edit/page.tsx`)
**When** the user views the toolbox or drags a block type onto the canvas
**Then**:
1. The toolbox displays all 9 supported block types with distinct icons, descriptive labels, and category metadata.
2. Dragging a block type over the canvas highlights the drop insertion target with visual drop indicators (e.g. between blocks or inside empty canvas dropzone).
3. Releasing/dropping the item inserts a new block of that type at the targeted position and updates the internal JSON block list.
4. Clicking a block in the toolbox also appends it to the canvas as an accessible keyboard/click fallback.

### AC2 — Visual Rendering of All 9 Block Types
**Given** a canvas with blocks of various types
**When** the canvas renders each block
**Then** each block displays dedicated preview UI reflecting its type and configuration:
1. `text`: Short text input with title, optional description, placeholder, and required badge.
2. `textarea`: Multi-line text input preview with styled textarea.
3. `number`: Numeric input preview with min/max indicator and number input field.
4. `single_choice`: Radio buttons with option labels and optional "Other" choice.
5. `multiple_choice`: Checkboxes with option labels and optional "Other" choice.
6. `rating`: Interactive visual rating stars or numbered scale (up to maxRating, e.g. 5 or 10).
7. `linear_scale`: Likert scale displaying min and max boundary labels (e.g. 1 "Strongly Disagree" to 5 "Strongly Agree").
8. `date`: Date picker component with calendar icon and optional time indicator.
9. `file_upload`: File dropzone preview with upload icon, allowed MIME types summary, and max file size badge.

### AC3 — Internal JSON State & Schema Conformance
**Given** blocks added or manipulated on the canvas
**When** the block collection is serialized to JSON
**Then**:
1. Every block strictly satisfies `formBlockSchema` from `@rescom/schemas`.
2. Each block has a unique `id` (e.g., `blk-${crypto.randomUUID()}`), sequential `order` index, and valid type-specific properties.
3. The canvas state synchronizes seamlessly with the existing `useFormAutosave` hook in `apps/frontend/my-app`, triggering debounced autosave to `/api/forms/:id/draft`.

### AC4 — Canvas Interactions & Empty State
**Given** the canvas editor
**When** no blocks exist
**Then** an intuitive empty state is shown guiding the publisher to drag or click blocks from the toolbox.
**And** each rendered block provides quick actions (delete button, block type badge, order index).

### AC5 — Type Safety & Build Verification
**Given** the monorepo TypeScript environment
**When** building and validating the frontend
**Then**:
1. `apps/frontend/my-app` compiles cleanly (`npm run build`) with zero TypeScript or ESLint errors.
2. Unit tests verify block instantiation defaults for all 9 types and drop handlers.
3. Root `npm run verify` continues to pass 100%.

---

## Tasks / Subtasks

- [x] **Task 1: Block Definitions & Default Factories (`apps/frontend/my-app`)** (AC: 2, 3)
  - [x] 1.1 Create `app/forms/components/block-definitions.ts` defining metadata, icons, labels, and default factories for all 9 block types conforming to `@rescom/schemas`.
  - [x] 1.2 Implement type-safe default block creator `createDefaultBlock(type: FormBlockType, order: number): FormBlock`.

- [x] **Task 2: Block Renderers for All 9 Types (`apps/frontend/my-app`)** (AC: 2, 4)
  - [x] 2.1 Create `app/forms/components/blocks/` directory with individual block preview renderers:
    - `TextBlockPreview.tsx`
    - `TextareaBlockPreview.tsx`
    - `NumberBlockPreview.tsx`
    - `SingleChoiceBlockPreview.tsx`
    - `MultipleChoiceBlockPreview.tsx`
    - `RatingBlockPreview.tsx`
    - `LinearScaleBlockPreview.tsx`
    - `DateBlockPreview.tsx`
    - `FileUploadBlockPreview.tsx`
  - [x] 2.2 Create `QuestionBlockRenderer.tsx` registry component that dynamically routes any `FormBlock` to its specialized preview renderer.

- [x] **Task 3: Drag-and-Drop Toolbox & Canvas Components** (AC: 1, 4)
  - [x] 3.1 Create `app/forms/components/Toolbox.tsx` featuring the 9 block types, native HTML5 drag attributes (`draggable`, `onDragStart`), and click-to-add accessibility.
  - [x] 3.2 Create `app/forms/components/BuilderCanvas.tsx` handling `onDragOver`, `onDragLeave`, `onDrop`, drop insertion indicators between blocks, and the empty state.
  - [x] 3.3 Add block removal and title inline editing triggers to each canvas item card.

- [x] **Task 4: Integration into Form Draft Editor Page** (AC: 1, 3, 4)
  - [x] 4.1 Update `app/forms/[id]/edit/page.tsx` to embed `Toolbox` in a side or top panel and `BuilderCanvas` as the primary workspace.
  - [x] 4.2 Connect canvas block additions, updates, and removals to `handleFieldChange({ newBlocks })` so changes trigger `autosave.triggerAutosave`.

- [x] **Task 5: Verification & Automated Tests** (AC: 5)
  - [x] 5.1 Add unit tests for block factory creation and schema validation in `apps/backend/src/modules/forms/presentation/form-builder-blocks.spec.ts`.
  - [x] 5.2 Verify `npm run build` in `apps/frontend/my-app`.
  - [x] 5.3 Run root `npm run verify` to confirm 0 regressions.

### Review Findings — 2026-09-15

- [x] [Review][Patch] Correct downward drag/drop index semantics and allow the final dropzone; the canvas passes `blocks.length`, which `reorderBlocks` rejects, and unchanged target indices insert one position too far after source removal. [apps/frontend/my-app/app/forms/components/BuilderCanvas.tsx:178]
- [x] [Review][Patch] Enforce unique contiguous block `order` values in draft/publish validation or normalize them before persistence; current schemas accept duplicates and gaps and the preview parser only sorts them. [packages/schemas/src/forms/form-draft.schema.ts:45]
- [x] [Review][Patch] Add automated frontend interaction coverage for toolbox insertion and drop handlers instead of testing only shared factories from the backend Jest project. [apps/frontend/my-app/package.json:5]

---

## Dev Notes

### Architecture Compliance & Guardrails
- **Shared Schema Package:** All block structures conform directly to `@rescom/schemas` (`FormBlock`, `FormBlockType`, `formBlockSchema`, `createDefaultBlock`).
- **Drag & Drop Strategy:** Built with native HTML5 Drag and Drop API (`dataTransfer.setData('application/rescom-block-type', type)`), ensuring zero extra runtime dependencies and 100% compatibility with Next.js 16 and React 19.
- **Component Registry Pattern:** Follows the architectural pattern with `QUESTION_REGISTRY` in `QuestionBlockRenderer.tsx` mapping each of the 9 block types to its dedicated preview component.
- **Turbopack Configuration:** Set `transpilePackages: ["@rescom/schemas"]` and `turbopack.root` in `next.config.ts` so Next.js seamlessly resolves monorepo packages across boundaries.

### References
- [Architecture Spine](file:///_bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/ARCHITECTURE-SPINE.md)
- [Project Summary Form Builder Architecture](file:///PROJECT_SUMMARY.md#6.4-Form-Builder-Architecture)
- [Story 2.1 Shared Form Schema Validation](file:///_bmad-output/implementation-artifacts/2-1-shared-form-schema-validation.md)
- [Form Blocks Schema](file:///packages/schemas/src/forms/form-blocks.schema.ts)

---

## Dev Agent Record

### Agent Model Used
Gemini 3.8 Flash (High)

### Debug Log References
- Addressed Turbopack module resolution for `@rescom/schemas` in `apps/frontend/my-app/next.config.ts` by setting `transpilePackages: ["@rescom/schemas"]` and monorepo `turbopack.root`.
- Ran unit test suite for form builder blocks factory (`form-builder-blocks.spec.ts`) with 19 passing assertions.
- Ran full root verification `npm run verify` (37 suites, 289 unit tests) and `npm run test:e2e` (9 suites, 95 tests).

### Completion Notes List
- Implemented `createDefaultBlock` factory function in `@rescom/schemas` supporting all 9 block types (`text`, `textarea`, `number`, `single_choice`, `multiple_choice`, `rating`, `linear_scale`, `date`, `file_upload`).
- Created frontend `block-definitions.ts` with metadata, categories, and icon identifiers.
- Created preview renderers for all 9 block types under `app/forms/components/blocks/`.
- Implemented `QuestionBlockRenderer.tsx` adhering to the `QUESTION_REGISTRY` pattern.
- Implemented `Toolbox.tsx` supporting native HTML5 drag-and-drop and click-to-add.
- Implemented `BuilderCanvas.tsx` with dynamic drop insertion indicators, between-block drops, re-indexing, and interactive empty state.
- Integrated `Toolbox` and `BuilderCanvas` into `app/forms/[id]/edit/page.tsx` with debounced autosave state synchronization.
- Verified Next.js build (`npm run build` in `apps/frontend/my-app`) compiles in 411ms without errors.
- Verified test suite: 100% pass rate across unit and e2e tests.

### File List
- `packages/schemas/src/forms/form-blocks.schema.ts` (modified)
- `apps/frontend/my-app/next.config.ts` (modified)
- `apps/frontend/my-app/app/forms/components/block-definitions.ts` (new)
- `apps/frontend/my-app/app/forms/components/blocks/TextBlockPreview.tsx` (new)
- `apps/frontend/my-app/app/forms/components/blocks/TextareaBlockPreview.tsx` (new)
- `apps/frontend/my-app/app/forms/components/blocks/NumberBlockPreview.tsx` (new)
- `apps/frontend/my-app/app/forms/components/blocks/SingleChoiceBlockPreview.tsx` (new)
- `apps/frontend/my-app/app/forms/components/blocks/MultipleChoiceBlockPreview.tsx` (new)
- `apps/frontend/my-app/app/forms/components/blocks/RatingBlockPreview.tsx` (new)
- `apps/frontend/my-app/app/forms/components/blocks/LinearScaleBlockPreview.tsx` (new)
- `apps/frontend/my-app/app/forms/components/blocks/DateBlockPreview.tsx` (new)
- `apps/frontend/my-app/app/forms/components/blocks/FileUploadBlockPreview.tsx` (new)
- `apps/frontend/my-app/app/forms/components/QuestionBlockRenderer.tsx` (new)
- `apps/frontend/my-app/app/forms/components/Toolbox.tsx` (new)
- `apps/frontend/my-app/app/forms/components/BuilderCanvas.tsx` (new)
- `apps/frontend/my-app/app/forms/[id]/edit/page.tsx` (modified)
- `apps/backend/src/modules/forms/presentation/form-builder-blocks.spec.ts` (new)
- `_bmad-output/implementation-artifacts/2-3-form-builder-canvas-block-types.md` (new)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified)

---

## Change Log
- 2026-09-14: Implemented Story 2.3 Form Builder Canvas & Block Types across frontend and shared schemas package. All 9 block types, drag-and-drop toolbox, canvas renderer, and autosave integration complete and verified.
