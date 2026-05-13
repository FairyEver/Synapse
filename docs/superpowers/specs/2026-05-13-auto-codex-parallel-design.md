# auto Codex Web Console Design

## Goal

Convert `auto/` from a Claude SDK based single-agent scheduler into a local Codex web console. `pnpm start` starts a lightweight HTTP service, opens a browser page, lets the user configure the prompt and runtime settings, and then launches multiple Codex workers in parallel against the same working directory.

The first version is intentionally direct: workers share one working directory, the runner does not isolate them with git worktrees, and it does not block commits. It makes parallel execution visible, logs each worker separately, and uses a per-worker prompt wrapper to constrain git behavior.

## Non-goals

- Do not add a Codex SDK abstraction. Codex is invoked through `codex exec`.
- Do not use per-worker worktrees or temporary repository copies.
- Do not add file locks, claim files, or automatic conflict resolution.
- Do not block `git commit`.
- Do not introduce a React or Vite app for the console in the first version.
- Do not start the Synapse Electron development server for this work.

## Start Behavior

`pnpm start` starts a local HTTP server and opens the browser to the control page. It does not start Codex workers until the user clicks Start.

Default behavior:

- Bind to `127.0.0.1`.
- Try a default port, then increment if the port is occupied.
- Open `http://127.0.0.1:<port>` with the system browser.
- Load the last saved UI config from `auto/state/ui-config.json`.

`pnpm once` may remain as a non-UI path that reads the saved UI config and runs one batch.

## Persistent UI Config

Persist user-edited settings in:

```text
auto/state/ui-config.json
```

Saved fields:

- `prompt`
- `workingDirectory`
- `concurrency`
- `intervalMinutes`
- `timeoutMinutes`
- `maxLogs`
- `codex.command`
- `codex.model`
- `codex.sandbox`
- `codex.approvalPolicy`
- `codex.json`

The server saves this file when the user clicks Save or Start. `auto/config.json` can remain only for service defaults such as initial port or fallback values.

## Web UI

Build the web console as static HTML, CSS, and browser JavaScript served by the local HTTP service. The UI must follow `/Users/liyang/Documents/code/github/Synapse/DESIGN.md`.

Practical interpretation for this console:

- Use a Vercel-like developer console surface: near-white canvas, ink text, hairline borders, compact controls, and mono captions for technical labels.
- Define design tokens once as CSS custom properties derived from `DESIGN.md`; components should use those tokens instead of scattered literal colors.
- Use Geist/Inter/system sans for normal UI and a mono stack for command, path, and worker labels.
- Keep copy terse: labels, button text, empty states, and errors only.
- Do not use marketing hero sections, decorative emoji, neon effects, rainbow text, or decorative gradients.
- Do not use inline `style` attributes.
- Keep layout utilitarian: left-side configuration form and right-side run status/log summary on desktop, stacked sections on narrow screens.

Primary controls:

- Prompt textarea
- Working directory input
- Concurrency input
- Interval minutes input
- Timeout minutes input
- Max logs input
- Codex command input
- Codex model input
- Sandbox select
- Approval policy select
- Save
- Start
- Stop after current batch

Primary status views:

- Scheduler state: idle, running, waiting, stopping, stopped, error
- Current batch id and start time
- Worker list with status, duration, exit code, and log path
- Recent stdout line or final message per worker
- Last batch summary path

## HTTP API

Use Node's built-in `http` module. Avoid adding Express or frontend build dependencies for the first version.

Endpoints:

- `GET /`: serve the console page.
- `GET /assets/*`: serve static CSS and JavaScript.
- `GET /api/config`: return saved UI config with defaults applied.
- `PUT /api/config`: validate and persist UI config.
- `POST /api/start`: validate, persist config, and start the scheduler loop.
- `POST /api/stop-after-current`: set a drain flag so no next batch starts after the current batch finishes.
- `GET /api/status`: return the current scheduler snapshot.
- `GET /events`: Server-Sent Events stream for status updates.

The server should return structured JSON errors. UI error text should be short and actionable.

## Execution Model

Starting from the UI creates a scheduler loop from the active config. The first batch starts immediately. In loop mode, the scheduler waits for the full batch to finish, then waits `intervalMinutes`, then starts the next batch unless the drain flag is set.

Each batch starts `concurrency` worker processes at the same time. Each worker runs:

```bash
codex exec --cd <workingDirectory> --sandbox <sandbox> --ask-for-approval <approvalPolicy> --json -
```

Optional arguments are omitted when empty. The original prompt is passed through stdin after the per-worker wrapper.

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

`summary.md` records the batch start time, working directory, prompt source, concurrency, worker durations, exit codes, result status, and log paths.

Each `worker-N.md` records the effective worker id, command arguments, stdout events, stderr, timeout status, exit code, and final message when available. If Codex JSONL output parsing fails for a line, the raw line is preserved in the worker log.

`maxLogs` pruning should count batch directories and remove the oldest batch directories after the limit is exceeded.

## Status Model

Worker statuses:

- `pending`
- `running`
- `success`
- `error`
- `timeout`

Batch statuses:

- `running`
- `success`: all workers exit with code `0` and none time out.
- `partial`: at least one worker succeeds and at least one worker fails or times out.
- `error`: all workers fail or time out.

Scheduler statuses:

- `idle`
- `running`
- `waiting`
- `stopping`: stop-after-current is set while a batch is active.
- `stopped`
- `error`

A failed worker does not cancel sibling workers. A batch-level failure does not crash the HTTP service.

## Implementation Shape

- `src/config.ts`: load defaults, validate saved UI config, and resolve paths.
- `src/server.ts`: HTTP routing, static assets, JSON body parsing, SSE client management, browser opening.
- `src/scheduler.ts`: loop orchestration, drain flag, status snapshots, batch lifecycle.
- `src/runner.ts`: child-process based Codex worker execution.
- `src/logger.ts`: batch log directories and per-worker logs.
- `src/index.ts`: choose UI server for `start` and non-UI batch for `--once`.
- `src/web/`: static `index.html`, `styles.css`, and `app.js` following `DESIGN.md`.
- `package.json`: remove `@anthropic-ai/claude-agent-sdk` if no longer used.
- `README.md`: document web console usage, same-directory concurrency risk, saved config, and git commit guidance.

The code should stay small and local to `auto/`.

## Verification

Use source-level checks and package-level validation:

- `pnpm --dir auto exec tsc --noEmit` verifies TypeScript.
- Start the `auto` service manually and confirm the browser page opens.
- Save config, restart the service, and confirm values persist from `state/ui-config.json`.
- Start a harmless batch and confirm SSE status updates and batch logs are written.

Do not start the Synapse Electron development server.
