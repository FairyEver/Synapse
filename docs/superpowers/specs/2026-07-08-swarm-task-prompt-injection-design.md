# Swarm Task Prompt Injection Design

Date: 2026-07-08
Status: Approved for planning

## Context

Swarm Task should be treated as a generic concurrent task runner plus configurable prompt injection. It should not assume that users are analyzing GitHub issues, reviewing documents, writing reports, or following any fixed business workflow.

The current implementation already supports several injection behaviors, but some of them are enabled by default:

- `injectOptions.workerIdentity`
- `injectOptions.roundContext`
- `injectOptions.runContext`
- `injectOptions.parallelContext`

The prompt builder therefore injects runtime, worker, round, and parallel coordination context unless users explicitly turn individual flags off. The UI does not expose a clear "inject sequence and batch" control.

The current implementation also has `handoff.enabled`, but it injects only the last available handoff. That is weaker than a round-to-round handoff model where the next batch can see the previous batch's handoff outputs.

File writing is currently reduced to `summaryFile.enabled` and a project-relative path. That only injects append guidance. It does not support a user-selected write strategy, and it does not inject a lock protocol for concurrent workers writing the same file.

## Goals

- Make Swarm Task default to a pure executor. New tasks do not inject sequence, batch, handoff, file writing, or summary protocol content by default.
- Group prompt injection settings under one explicit product concept.
- Add a user-facing "sequence and batch" injection switch.
- Make previous-round handoff injection explicit and based on the previous batch, not the last worker record only.
- Add optional file writing rule injection with append-only and update modes.
- Add optional file lock rule injection for concurrent file writes.
- Keep Swarm Task generic. User prompts decide how to use injected context.
- Preserve existing run scheduling, Agent Runtime conversation linkage, MCP actions, and Workflow node integration unless their config schemas need to follow the new model.

## Non-Goals

- Do not implement a managed file merge service.
- Do not guarantee that Agents write files correctly.
- Do not create business-specific templates for GitHub issue triage, document review, or report generation.
- Do not introduce new dependencies.
- Do not move Swarm Task out of the existing app capability package.
- Do not add hidden default prompt rules that are not represented in saved task config.

## Product Semantics

Swarm Task has two jobs:

1. Run multiple Agent sessions with bounded concurrency and optional multiple rounds.
2. Optionally inject selected context blocks into each Agent prompt.

Everything else belongs in the user's prompt.

The default new task should send only the user's task prompt, plus the minimum wrapper required by Agent Runtime. No sequence context, handoff protocol, summary ending protocol, file write rule, or coordination warning should appear unless configured.

## Configuration Model

Use a single prompt injection group instead of exposing implementation-shaped flags:

```ts
promptInjection: {
  sequenceBatch: {
    enabled: boolean
  }
  previousHandoff: {
    enabled: boolean
  }
  summary: {
    enabled: boolean
    injectRecent: boolean
    recentLimit: number
  }
  fileWrite: {
    enabled: boolean
    path: string
    mode: "append-only" | "update"
    lock: {
      enabled: boolean
    }
  }
  customAppendix: string
}
```

Defaults for new tasks:

```ts
promptInjection: {
  sequenceBatch: { enabled: false },
  previousHandoff: { enabled: false },
  summary: { enabled: false, injectRecent: false, recentLimit: 3 },
  fileWrite: {
    enabled: false,
    path: "",
    mode: "append-only",
    lock: { enabled: true }
  },
  customAppendix: ""
}
```

`fileWrite.lock.enabled` can default to `true` inside disabled file writing config because it only matters when `fileWrite.enabled` is true. When file writing is enabled, lock guidance should be on by default.

## Sequence And Batch Context

When `promptInjection.sequenceBatch.enabled` is false, do not inject Swarm runtime context.

When enabled, inject stable values that user prompts can reference:

- `taskId`
- `runId`
- `runMode`
- `concurrency`
- `maxRounds`
- `sequenceIndex`
- `batchIndex`
- `slotIndex`

Use one-based values in the prompt because they are easier for users to reference. If zero-based values are useful for formulas, include them explicitly as separate fields, for example `sequenceIndexZeroBased`.

The current scheduler has `workerIndex` and `roundIndex`, but `roundIndex` is a global worker sequence rather than a batch number. Implementation should add or derive explicit scheduling metadata:

```ts
sequenceIndex = global worker launch order, one-based
slotIndex = active concurrency slot, one-based
batchIndex = Math.floor((sequenceIndex - 1) / concurrency) + 1
```

This makes formulas like "concurrency * previous batches + slot" stable without turning that formula into product logic.

## Previous Handoff

`promptInjection.previousHandoff.enabled` controls two related behaviors:

- Workers should be asked to emit a structured handoff block.
- Workers after the first batch should receive previous batch handoff content.

Do not inject handoff when the switch is disabled.

The injected handoff should include the previous batch's handoff outputs, ordered by sequence or slot. It should not include the entire run history by default.

For continuous mode, "previous batch" means the most recent completed group whose `batchIndex` is less than the current worker's `batchIndex`. If the scheduler launches uneven final batches, inject all handoffs from the immediately preceding batch that have completed before prompt construction.

If no previous handoff exists, omit the section.

## Summary Collection

Summary collection is separate from handoff. It exists so the app can store concise worker summaries in run history.

`promptInjection.summary.enabled` controls whether the prompt asks for a structured summary block and whether the service stores fallback summaries.

`promptInjection.summary.injectRecent` controls whether recent stored summaries are injected into new worker prompts. This should remain optional and default off.

Summary is not a file write feature. It should not imply that Synapse will merge or publish results.

## File Write Injection

`promptInjection.fileWrite.enabled` controls whether any file writing guidance appears in the prompt.

The file path must be project-relative. Reject absolute paths, parent traversal, and empty paths when file writing is enabled.

### Append-Only Mode

Prompt guidance:

```text
Write file: <path>
Mode: append-only

Before writing, read the current file content. Do not overwrite, rewrite, delete, or modify existing content. Only append new content to the end of the file.
```

This is suitable for concurrent workers appending findings to the same report, but the UI should not name that scenario.

### Update Mode

Prompt guidance:

```text
Write file: <path>
Mode: update

You may insert, modify, reorganize, or delete existing content when the task requires it. Preserve unrelated user content.
```

This is suitable for structured documents or evolving reports, but the UI should not name that scenario.

### File Lock Rule

When `promptInjection.fileWrite.lock.enabled` is true, inject a lock protocol into the file write section.

The prompt-level rule should say:

```text
Before changing the file, acquire an atomic lock for that file. Release the lock after the write finishes. If the lock cannot be acquired, wait and retry instead of writing concurrently.
```

The injected guidance should name the available lock mechanism. If Synapse later provides a dedicated lock tool, tell the Agent to use that tool. Until then, use an atomic project-local lock directory such as `<path>.lock` created with an atomic filesystem operation. The Agent must remove the lock directory after writing.

This design is still prompt injection, not a Synapse-owned file writer. The implementation does not need to add a managed merge service or intercept file writes.

## Prompt Builder

Prompt sections should be included only when their config is enabled.

Recommended order:

1. Sequence and batch context
2. Recent summaries
3. Previous handoff
4. File write rules
5. Custom appendix
6. User prompt
7. Structured ending protocol

The structured ending protocol should include only enabled blocks:

- Summary block when summary collection is enabled.
- Handoff block when previous handoff is enabled.

Do not inject a generic "multiple workers may run" warning unless sequence/batch or file writing rules make it relevant.

## UI Design

Keep the form dense and operational. Use existing shadcn/Radix components and Tailwind tokens only.

Groups:

- `任务`
- `运行`
- `注入`
- `文件`

Controls:

- `序列和批次` switch
- `上一轮交接` switch
- `记录摘要` switch
- `最近摘要` switch, shown or enabled only when `记录摘要` is on
- `文件写入` switch
- `文件路径` input, shown when file writing is on
- `写入方式` select or segmented control: `只追加`, `允许更新`
- `文件锁` switch, shown when file writing is on

Copy should be minimal. Acceptable helper text:

- `相对项目路径`
- `多个 worker 写同一文件时开启`

Avoid visible text that explains implementation details, example business scenarios, or how formulas should be written.

## Data Migration

Existing config should normalize into the new model.

Suggested mapping:

```text
injectOptions.workerIdentity
injectOptions.roundContext
injectOptions.runContext
injectOptions.parallelContext
  -> promptInjection.sequenceBatch.enabled
```

If any of those legacy values are true, enable sequence/batch injection for migrated tasks. This preserves behavior for saved tasks while new tasks default off.

```text
handoff.enabled -> promptInjection.previousHandoff.enabled
summary -> promptInjection.summary
summaryFile.enabled/path -> promptInjection.fileWrite.enabled/path
```

Legacy `output.targetFilePolicy` mapping if encountered:

```text
append-only -> fileWrite.mode = "append-only"
section-update -> fileWrite.mode = "update"
free-edit -> fileWrite.mode = "update"
```

Do not preserve legacy Git context injection.

## MCP And Workflow Impact

Swarm Task remains in the same capability namespace and uses the same MCP actions.

Update schemas and examples for:

- task create
- task update
- run start overrides
- run snapshots

Workflow node overrides may stay limited to prompt, run mode, max rounds, and concurrency. It does not need to expose every prompt injection field unless a later task asks for that.

Update the built-in `synapse-skill` Automation API reference because Swarm Task MCP docs live there.

## Error Handling

- Reject enabled file writing with an empty path.
- Reject file paths outside the selected project.
- If no handoff exists for a worker, omit the handoff section.
- If summary or handoff blocks are missing from worker output while the corresponding feature is enabled, keep the existing fallback behavior for summary and store no handoff.
- A worker failing to follow injected file rules is not automatically a Swarm run failure because Synapse is not the file writer.

## Tests

Schema:

- New task defaults have all prompt injection switches off.
- Legacy runtime context flags migrate into `sequenceBatch.enabled`.
- Legacy summary file config migrates into `fileWrite`.
- File write path validation rejects empty, absolute, and parent traversal paths.

Scheduler/service:

- Worker metadata includes stable sequence, batch, and slot values.
- Batch mode computes batch indexes consistently.
- Continuous mode computes batch indexes consistently.
- Previous handoff injection uses the previous batch instead of the last arbitrary worker.

Prompt builder:

- Omits runtime context by default.
- Injects sequence and batch context only when enabled.
- Injects handoff only when enabled and available.
- Injects append-only file rules only when enabled with append-only mode.
- Injects update file rules only when enabled with update mode.
- Injects lock rules only when file writing and lock are enabled.
- Emits structured summary and handoff ending blocks only for enabled features.

Renderer:

- New task config uses pure executor defaults.
- Renders the `注入` and `文件` groups.
- Shows file path, write mode, and lock controls only when file writing is on.
- Blocks save or run when file writing is enabled without a valid path.
- Does not render business-specific examples or implementation explanation copy.

MCP/docs:

- Built-in `synapse-skill` API reference shows the new config shape.
- Dispatcher tests accept the new schema and preserve action names.
