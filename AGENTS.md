# AGENTS.md — RESCOM Project

## Project Context

Read `PROJECT_SUMMARY.md` at the project root for a comprehensive overview of the project, including architecture, tech stack, core features, database schema, business rules, and current development status.

## Skills

This project uses BMAD (Build Measure Analyze Deliver) methodology skills located in `.claude/skills/`:

### Planning & Strategy
- `.claude/skills/bmad-forge-idea` — Brainstorm and forge new ideas
- `.claude/skills/bmad-brainstorming` — Facilitated brainstorming sessions
- `.claude/skills/bmad-domain-research` — Domain-specific research
- `.claude/skills/bmad-market-research` — Market research and analysis
- `.claude/skills/bmad-technical-research` — Technical research and evaluation

### Product & Requirements
- `.claude/skills/bmad-product-brief` — Create product briefs
- `.claude/skills/bmad-prfaq` — Write PR/FAQ documents
- `.claude/skills/bmad-create-prd` — Create Product Requirements Documents
- `.claude/skills/bmad-edit-prd` — Edit existing PRDs
- `.claude/skills/bmad-validate-prd` — Validate PRD completeness
- `.claude/skills/bmad-prd` — PRD reference and templates
- `.claude/skills/bmad-spec` — Technical specifications

### Architecture & Design
- `.claude/skills/bmad-create-architecture` — Create architecture documents
- `.claude/skills/bmad-architecture` — Architecture reference and patterns
- `.claude/skills/bmad-ux` — UX design workflows

### Epic & Story Management
- `.claude/skills/bmad-create-epics-and-stories` — Break down PRD into epics and stories
- `.claude/skills/bmad-create-story` — Create individual user stories
- `.claude/skills/bmad-sprint-planning` — Plan sprints
- `.claude/skills/bmad-sprint-status` — Track sprint status

### Development
- `.claude/skills/bmad-dev-story` — Implement a user story
- `.claude/skills/bmad-dev-auto` — Automated development workflow
- `.claude/skills/bmad-quick-dev` — Quick development tasks
- `.claude/skills/bmad-code-review` — Code review
- `.claude/skills/bmad-check-implementation-readiness` — Verify story is ready for implementation

### Quality & Review
- `.claude/skills/bmad-review-adversarial-general` — Adversarial review
- `.claude/skills/bmad-review-edge-case-hunter` — Edge case discovery
- `.claude/skills/bmad-qa-generate-e2e-tests` — Generate end-to-end tests
- `.claude/skills/bmad-editorial-review-prose` — Prose quality review
- `.claude/skills/bmad-editorial-review-structure` — Document structure review

### Documentation & Utilities
- `.claude/skills/bmad-document-project` — Generate project documentation
- `.claude/skills/bmad-generate-project-context` — Generate project context
- `.claude/skills/bmad-index-docs` — Index documentation
- `.claude/skills/bmad-shard-doc` — Shard large documents
- `.claude/skills/bmad-checkpoint-preview` — Preview checkpoints
- `.claude/skills/bmad-correct-course` — Course correction
- `.claude/skills/bmad-retrospective` — Sprint retrospectives

### Agent Personas
- `.claude/skills/bmad-agent-analyst` — Business Analyst agent
- `.claude/skills/bmad-agent-architect` — Software Architect agent
- `.claude/skills/bmad-agent-dev` — Developer agent
- `.claude/skills/bmad-agent-pm` — Product Manager agent
- `.claude/skills/bmad-agent-tech-writer` — Technical Writer agent
- `.claude/skills/bmad-agent-ux-designer` — UX Designer agent
- `.claude/skills/bmad-advanced-elicitation` — Advanced requirement elicitation
- `.claude/skills/bmad-party-mode` — Multi-agent collaboration mode

### Configuration
- `.claude/skills/bmad-customize` — Customize BMAD configuration
- `.claude/skills/bmad-help` — BMAD help and documentation

## Key Documents

| Document | Path | Description |
|:---------|:-----|:------------|
| Project Summary | `PROJECT_SUMMARY.md` | AI-readable project overview |
| SRS | `srs_rescom.md` | Software Requirements Specification v1.0 |
| Architecture | `rescom.md` | Detailed architecture decisions |
| Epics | `_bmad-output/planning-artifacts/epics.md` | Full epic & story breakdown |
| DB Schema | `apps/backend/prisma/schema.prisma` | Prisma database schema |
| Docker | `docker-compose.yml` | Local dev infrastructure |
