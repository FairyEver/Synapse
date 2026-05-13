# auto Codex Parallel Runner Design

## Goal

Convert `auto/` from a Claude SDK based single-agent scheduler into a Codex CLI based scheduler that can launch multiple Codex workers in parallel against the same working directory and the same user prompt.

The first version is intentionally direct: it does not isolate workers with git worktrees, does not merge results, and does not prevent workers from committing. It makes parallel execution explicit, logs each worker separately, and relies on the prompt wrapper to constrain git behavior.

## Non-goals

- Do not add a Codex SDK abstraction. Codex is invoked through `codex exec`.
- Do not use per-worker worktrees or temporary repository copies.
- Do not add file locks, claim files, or automatic conflict resolution.
- Do not block `git commit`.
- Do not change the target project structure outside `auto/`.

## Configuration

Extend `auto/config.json` with a `concurrency` field and a small Codex command section:

```json
{
  "intervalMinutes": 1,
  "timeoutMinutes": 30,
  "concurrency": 3,
  "workingDirectory": "/Users/liyang/Documents/code/github/Synapse",
  "promptFile": "./prompt.md",
  "maxLogs": 50,
  "codex": {
    "command": "codex",
    "model": "",
    "sandbox": "danger-full-access",
    "approvalPolicy": "never",
    "json": true
  }
}
```

`concurrency` must be an integer greater than or equal to `1`. Empty optional Codex values are omitted from the CLI arguments.

## Execution Model

`pnpm once` runs one batch. A batch starts `concurrency` worker processes at the same time. Each worker runs:

```bash
codex exec --cd <workingDirectory> --sandbox <sandbox> --ask-for-approval <approvalPolicy> --json -
```

The original `prompt.md` is passed through stdin after a per-worker wrapper. In loop mode, the scheduler waits for the full batch to finish before waiting `intervalMinutes` and starting the next batch.

Each worker gets its own timeout. When a worker exceeds `timeoutMinutes`, the runner kills that child process, records a timeout result, and continues waiting for the remaining workers.

## Prompt Wrapper

The runner prepends a small wrapper to the user prompt for each worker:

```md
你是 Codex 并行 worker 2/5。

运行约束：
- 你和其他 worker 正在同一个工作目录中并行执行同一个任务。
- 你可以正常修改代码、运行允许的命令、按任务要求完成工作。
- 不要回滚或覆盖你没有明确创建/修改的内容。
- 如果你决定执行 git commit，只能 stage 和 commit 你本轮亲自修改的文件。
- 不要使用 git add .。
- 提交前必须检查 git diff / git status，确认没有包含其他 worker 或用户的改动。

下面是用户任务：
```

The wrapper adds identity and safety constraints without changing the core task.

## Logging

Change logs from one file per run to one directory per batch:

```text
logs/
  2026-05-13T12-00-00/
    summary.md
    worker-1.md
    worker-2.md
    worker-3.md
```

`summary.md` records the batch start time, working directory, prompt file, concurrency, worker durations, exit codes, result status, and log paths.

Each `worker-N.md` records the effective worker id, command arguments, stdout events, stderr, timeout status, exit code, and final message when available. If Codex JSONL output parsing fails for a line, the raw line is preserved in the worker log.

`maxLogs` pruning should count batch directories and remove the oldest batch directories after the limit is exceeded.

## Error Handling

- A failed worker does not cancel sibling workers.
- A timed-out worker is marked as `timeout`.
- A non-zero Codex exit code is marked as `error`.
- A batch is marked `success` only when all workers exit with code `0` and none time out.
- A batch is marked `partial` when at least one worker succeeds and at least one worker fails or times out.
- A batch is marked `error` when all workers fail or time out.

Scheduler stop behavior remains the same: the existing `state/stop` signal is checked before and after each batch, not between individual worker completions.

## Implementation Shape

- `src/config.ts`: add config fields and validation.
- `src/runner.ts`: replace Claude SDK streaming with child-process based Codex execution and batch orchestration.
- `src/logger.ts`: support batch log directories and per-worker logs.
- `src/index.ts`: keep the scheduler loop, update console copy to show concurrency and batch result.
- `package.json`: remove `@anthropic-ai/claude-agent-sdk` if it is no longer used.
- `README.md`: document Codex prerequisites, concurrency behavior, same-directory risk, and git commit guidance.

The code should stay small and local to `auto/`.

## Verification

Use source-level checks and package-level TypeScript validation:

- `pnpm --dir auto run once` can be used manually with a harmless prompt after implementation.
- `pnpm --dir auto exec tsc --noEmit` verifies TypeScript.
- Inspect generated logs after a test run to confirm batch and worker files are written.

Do not start the Synapse Electron development server for this work.
