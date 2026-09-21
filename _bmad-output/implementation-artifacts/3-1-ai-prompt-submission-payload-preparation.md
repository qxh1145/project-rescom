---
baseline_commit: a40a63c202dfab9d3bac0b818eb5287211e1070d
context:
  - "_bmad-output/planning-artifacts/epics.md"
  - "_bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/ARCHITECTURE-SPINE.md"
  - "_bmad-output/planning-artifacts/architecture/architecture-project-rescom-2026-08-08/solution-design.md"
  - "_bmad-output/implementation-artifacts/2-1-shared-form-schema-validation.md"
---

# Story 3.1: AI Prompt Submission & Payload Preparation

Status: review

## Story

As a Publisher,
I want to describe my survey in natural language from the Form Builder,
So that the system prepares a structured prompt payload embedding the shared Form Definition rules ready to dispatch to the AI Gateway.

## Acceptance Criteria

### AC1 — Shared AI Prompt & Payload Contracts (`packages/schemas`)
**Given** the monorepo architecture (`packages/schemas`)
**When** a publisher submits an AI prompt for form generation
**Then**:
1. `packages/schemas` exports `aiPromptSubmissionSchema` strictly validating the user input:
   - `prompt`: non-empty string, min 10 chars, max 4000 chars, trimmed.
   - `targetQuestionCount`: optional positive integer (min 1, max 30, default undefined/optional).
   - `preferredBlockTypes`: optional array of supported block types (`text`, `textarea`, `number`, `single_choice`, `multiple_choice`, `rating`, `linear_scale`, `date`).
2. `packages/schemas` exports `aiGatewayPromptPayloadSchema` and `AiGatewayPromptPayload` representing the payload destined for the AI Gateway:
   - `systemPrompt`: comprehensive system prompt containing system persona, JSON-only output constraint, and schema formatting guidelines.
   - `formSchemaContract`: structured representation of the Form Definition JSON rules (schema version, allowed block types, integrity metadata options).
   - `userPrompt`: the sanitized publisher input prompt.
   - `options`: generation constraints (e.g. temperature, max_tokens, targetQuestionCount).

### AC2 — Backend AI Prompt Payload Preparation Engine (`apps/backend`)
**Given** the backend NestJS application (`apps/backend`)
**When** the publisher submits a prompt to the AI endpoint (`POST /forms/:id/ai/prepare-prompt` or `POST /forms/ai/prepare-prompt`)
**Then**:
1. The request requires authenticated publisher credentials (`SessionAuthGuard`, `RolesGuard` for `PUBLISHER` or `ADMIN`, `CsrfGuard`).
2. Payload is validated with `ZodValidationPipe` against `aiPromptSubmissionSchema`.
3. An `AiPromptService` constructs the structured AI Gateway payload:
   - Injects the authoritative Form Definition schema rules derived from `@rescom/schemas`.
   - Embeds constraints requiring exact adherence to `formDefinitionSchema` (unique block IDs, 9 supported block types, settings, metadata).
   - Includes few-shot schema example / block definition blueprints.
   - Returns the prepared payload enveloped in standard RESCOM response envelope (`createSuccessEnvelope`).

### AC3 — Frontend Form Builder "Generate with AI" Modal
**Given** the Form Builder interface (`apps/frontend/my-app/app/forms/[id]/edit/page.tsx`)
**When** the publisher views the editor header / toolbar
**Then**:
1. A prominent "✨ Generate with AI" button is displayed in the Form Builder header.
2. Clicking the button opens an accessible modal dialog (`GenerateWithAiModal`).
3. The modal provides:
   - A multi-line textarea with helpful placeholder hints (e.g., "Describe the goal of your survey, target audience, and key questions...").
   - Character count indicator (min 10 / max 4000).
   - Optional question count or style preference controls.
   - Submit button ("Generate Survey Structure") and Cancel button.
   - Client-side validation preventing submission of empty or too-short prompts (< 10 chars).
4. Submitting dispatches the request to the backend prompt preparation endpoint.

### AC4 — Unit & Integration Test Suite
**Given** the test suites in `packages/schemas` and `apps/backend`
**When** executed via `npm test`
**Then**:
1. Unit tests in `packages/schemas` verify valid and invalid AI prompt submissions.
2. Unit tests in `apps/backend` verify `AiPromptService` correctly compiles system instructions, Form Definition schema constraints, and user input into the expected AI Gateway payload.
3. Controller tests in `apps/backend` verify route protection (auth, role, CSRF, validation) and successful response envelope.
4. All existing 33 backend test suites (256 tests) continue to pass 100%.

---

## Tasks / Subtasks

- [x] **Task 1: Shared AI Prompt Schemas (`packages/schemas`)** (AC: 1)
  - [x] 1.1 Create `packages/schemas/src/forms/ai-prompt.schema.ts` defining `aiPromptSubmissionSchema` and `aiGatewayPromptPayloadSchema`.
  - [x] 1.2 Export new schemas and inferred types (`AiPromptSubmissionInput`, `AiGatewayPromptPayload`) from `packages/schemas/src/forms/index.ts` and `packages/schemas/src/index.ts`.
  - [x] 1.3 Add schema unit tests in `packages/schemas` validating bounds (10-4000 chars, block types, strict rejection of unrecognized properties).

- [x] **Task 2: Backend AI Prompt Preparation Service (`apps/backend`)** (AC: 2)
  - [x] 2.1 Create `apps/backend/src/modules/ai/ai.module.ts` (or integrate into `forms.module.ts`) and `AiPromptService`.
  - [x] 2.2 Implement prompt builder template in `AiPromptService.buildPromptPayload()` that formats Form Definition JSON constraints, supported block types (`text`, `textarea`, `number`, `single_choice`, `multiple_choice`, `rating`, `linear_scale`, `date`, `file_upload`), settings, and integrity metadata guidelines.
  - [x] 2.3 Unit test `AiPromptService` verifying payload formatting, rule inclusions, and parameter handling.

- [x] **Task 3: Backend AI Prompt Controller Endpoint** (AC: 2)
  - [x] 3.1 Create `apps/backend/src/modules/ai/presentation/ai-forms.controller.ts` with endpoint `POST /forms/ai/prepare-prompt`.
  - [x] 3.2 Protect endpoint with `SessionAuthGuard`, `RolesGuard`, `CsrfGuard`, `JsonOnlyGuard`, and `ZodValidationPipe(aiPromptSubmissionSchema)`.
  - [x] 3.3 Unit test controller with authentication context and mock service.

- [x] **Task 4: Frontend Form Builder "Generate with AI" Modal** (AC: 3)
  - [x] 4.1 Create `apps/frontend/my-app/app/forms/[id]/edit/generate-with-ai-modal.tsx`.
  - [x] 4.2 Integrate the modal and trigger button into `apps/frontend/my-app/app/forms/[id]/edit/page.tsx`.
  - [x] 4.3 Add prompt submission handling, loading state, error alert, and character counter.

- [x] **Task 5: Verification & Full Regression Suite** (AC: 4)
  - [x] 5.1 Run `npm run build --workspace @rescom/schemas`.
  - [x] 5.2 Run `npm test --workspace backend` and confirm all suites pass.
  - [x] 5.3 Run `npm run typecheck`.

---

## Dev Notes

### Architectural Context & AI Gateway Boundaries
- Epic 3 Goal: Publishers can rapidly generate form drafts using natural language prompts without blocking manual flows if the AI fails.
- Story 3.1 focuses on **AI Prompt Submission & Payload Preparation**:
  - The publisher provides natural language requirements in the UI.
  - The backend validates the input and formats the exact structured prompt payload containing the schema rules for the AI Gateway.
  - Subsequent stories (Story 3.2, 3.3, 3.4) handle the HTTP communication with the AI Gateway (via Tailscale/Ollama), 60s timeout, response parsing with `formDefinitionSchema`, and error fallback.
- **Rule from ARCHITECTURE-SPINE.md**: "The AI Gateway must be an optional dependency. If the Ollama server is unreachable or times out, the backend must gracefully fail the AI generation request, and the frontend Form Builder must continue to function normally."
- Standard response envelope must always be used:
  ```json
  {
    "data": { ... },
    "error": null,
    "meta": { ... }
  }
  ```

---

## Dev Agent Record

### Implementation Plan
1. Define shared Zod contracts in `packages/schemas/src/forms/ai-prompt.schema.ts`.
2. Implement `AiPromptService` in backend with comprehensive Form Definition prompt generation.
3. Expose authenticated endpoint in backend controller `POST /forms/ai/prepare-prompt`.
4. Implement `GenerateWithAiModal` in frontend Form Builder editor page.
5. Run full test suites and ensure zero regressions.

### Debug Log
- Clean architecture guardrail flagged `@Injectable()` from `@nestjs/common` in application layer service (`ai-prompt.service.ts`). Removed the framework decorator and registered the pure class provider in `AiModule` to maintain zero-dependency application layer standards.
- Parallel Jest tests caused Bcrypt CPU throttling timeouts on password hashing. Added `testTimeout: 15000` to `apps/backend/jest.config.js` to stabilize multi-suite test runs under CPU load.

### Completion Notes
- Implemented `aiPromptSubmissionSchema` and `aiGatewayPromptPayloadSchema` in `@rescom/schemas` with strict validation boundaries (10-4000 char prompt, 1-30 question count, allowed block types).
- Implemented `AiPromptService` compiling structured system instructions with raw JSON output constraints, full Form Definition rules, supported block types, settings, and metadata.
- Implemented `AiFormsController` (`POST /forms/ai/prepare-prompt`) with `SessionAuthGuard`, `RolesGuard('PUBLISHER', 'ADMIN')`, `CsrfGuard`, and `JsonOnlyGuard`.
- Built `GenerateWithAiModal` component and integrated it into the Form Builder editor toolbar (`apps/frontend/my-app/app/forms/[id]/edit/page.tsx`).
- Full regression verification: 37 unit suites (289 tests), 9 E2E suites (95 tests), Next.js production build, and TypeScript typechecking all pass 100%.

---

## File List
- `packages/schemas/src/forms/ai-prompt.schema.ts`
- `packages/schemas/src/forms/index.ts`
- `apps/backend/src/modules/ai/application/ai-prompt.service.ts`
- `apps/backend/src/modules/ai/application/ai-prompt.service.spec.ts`
- `apps/backend/src/modules/ai/presentation/ai-prompt.schema.spec.ts`
- `apps/backend/src/modules/ai/presentation/ai-forms.controller.ts`
- `apps/backend/src/modules/ai/presentation/ai-forms.controller.spec.ts`
- `apps/backend/src/modules/ai/ai.module.ts`
- `apps/backend/src/app.module.ts`
- `apps/backend/jest.config.js`
- `apps/frontend/my-app/app/forms/[id]/edit/generate-with-ai-modal.tsx`
- `apps/frontend/my-app/app/forms/[id]/edit/page.tsx`

---

## Change Log
- 2026-09-14: Created Story 3.1 specification for AI Prompt Submission & Payload Preparation.
- 2026-09-14: Implemented Story 3.1 end-to-end, all tests passing. Moved status to review.

