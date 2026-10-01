# Rescom execution and model budget

These project-specific instructions override broader OMC defaults and older
execution plans when choosing models, concurrency, and review scope.

- Main session: Sonnet by default. Use Haiku explicitly for explore/lookup and
  straightforward reference retrieval. Use Sonnet for coding, debugging,
  tests, verification, ordinary planning, and routine code review.
- Reserve Opus for architecture decisions, substantive security analysis, or
  difficult reasoning unresolved after one focused Sonnet attempt. State the
  concrete reason before escalating; do not treat every multi-file task as hard.
- On every Agent call and resume, pass the intended model explicitly. Do not
  replace executor's Sonnet with Opus just because the main session uses Opus.
- Use at most two active subagents per session, including reviewers. Do not
  spawn nested agents or forks. The lead schedules all delegation. With /team,
  request at most two workers; native subagent limits do not cap team workers.
- Small, bounded changes may be implemented and checked directly. Delegate only
  when isolation or specialization helps; do not create an agent per tiny step.
- One independent routine review pass is sufficient. Use the existing BMAD
  review as that pass, without a duplicate OMC approval review. Keep distinct
  required review roles, but run at most two at once; use Sonnet explicitly.
- Re-review only changed fixes and affected acceptance criteria. Stop automatic
  repair after two repair loopbacks and report remaining concrete blockers.
  Never mark unresolved correctness/security failures as complete.
- No minimum finding count. Zero evidence-backed findings is a valid result.
- Give each worker a bounded file/task scope and relevant excerpts or paths.
  Return concise findings, changed files, and verification evidence. Avoid
  repeated whole-repository scans, full-log output, or unrelated cleanup.
- Assign one owner to shared schema/module/config files. Run broad integration
  checks after dependent edits finish; use targeted checks during implementation.
- Do not auto-activate Ralph, ultrawork, autopilot, or consensus planning for
  routine work. Use persistent modes only when explicitly requested, and cancel
  them when their bounded objective is complete or blocked.
