# START-PROMPT

You are running an unattended Codex development task.

Run directory: `.ai-runs/mcp-tools-docs-20260425-184539`

Read `manifest.yml`, `input/task.md`, and `state/PROGRESS.md` first. Do not rely on chat history. Execute only within the risk budget described by the task template and manifest.

Core rules:

1. Do not push.
2. Do not modify the input task snapshot.
3. Keep state in the run directory.
4. Inspect git status and preserve the current working tree before editing.
5. Create or switch to the configured unattended work branch.
6. Update heartbeat and progress before and after each task.
6a. Update `state/steps.json` when a task starts, completes, blocks, or defers.
7. Commit after each major phase according to manifest git policy.
8. Append every commit checkpoint to `state/checkpoints.ndjson`.
9. Mark blocked work and continue when the task policy allows it.
10. Mark work deferred when it needs a disabled capability.
11. Finish with reports/COMPLETION-REPORT.md and a user review checklist.
