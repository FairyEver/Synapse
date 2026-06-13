# Workflow Codex Node Design

> Date: 2026-06-12
> Status: Design confirmed, waiting for user review

## Background

Synapse Workflow already supports Prompt, Switch, HTTP Request, Script, End, and Workflow Call nodes. Prompt and Switch nodes call the existing Agent runtime and create workflow-linked Agent conversations. The requested Codex node has a different boundary: it should run the user's local Codex CLI from a workflow, collect the result, and store workflow run history like Script or HTTP nodes. It must not join the current Synapse Agent conversation system.

Codex CLI documents `codex exec` as the non-interactive entry point for scripts and CI-style runs. The node should use that surface instead of the interactive Codex TUI.

## Goals

- Add a first-class `codex` workflow node.
- Run local `codex exec` in the background through Synapse's controlled process runtime.
- Keep the node independent from `AgentRuntimeService` and Synapse Agent conversations.
- Expose relevant Codex CLI options as node controls.
- Use unattended-friendly defaults.
- Return Codex's final reply text as the node `output`.
- Persist debug-grade workflow history with command metadata, stdout/stderr previews, artifact paths, and local Codex session/log hints when available.
- Preserve existing Workflow project resolution semantics.

## Non-Goals

- Do not add Codex to the Synapse Agent conversation system.
- Do not create Synapse Agent conversations from this node.
- Do not implement Codex app-server, Codex SDK, or remote Codex Cloud execution.
- Do not add new dependencies.
- Do not replace or alter the existing Prompt node.
- Do not store real tokens, Authorization headers, cookies, API keys, or env secrets in workflow history.

## Chosen Approach

Create an independent Workflow node under `desktop/workflow-nodes/codex/` with the same shape as existing node implementations:

```text
desktop/workflow-nodes/codex/
  schema.ts
  manifest.ts
  executor.main.ts
  panel.tsx
  card.tsx
  index.ts
```

The executor calls `runtimeDeps.processRunner.run(...)` with `codex exec`. This keeps the node in the same operational class as Script and HTTP nodes: it runs as a background action inside Workflow, returns a node result, and stores debug metadata in the workflow run snapshot.

The node is registered in:

- `desktop/workflow-nodes/register.main.ts`
- `desktop/workflow-nodes/register.renderer.ts`
- `desktop/workflow-nodes/panel-registry.ts`
- Workflow editor and runner node wrapper maps

## Alternatives Considered

### Extend Prompt Node

Adding a "runner: Claude/Codex" option to the existing Prompt node would reuse UI, but it would mix Agent conversation semantics with Codex CLI execution options. It also risks regressions in the current Claude-backed Prompt node.

### Script Node Preset

A Script node template could run `codex exec`, but users would have to manage CLI flags, output extraction, and debug artifacts manually. It would also make validation and sanitized history inconsistent.

## Node Configuration

```ts
interface CodexNodeConfig {
  variables: WorkflowVariableBinding[]
  prompt: string
  projectId?: string
  timeoutMins?: number

  approvalPolicy: "never" | "on-request" | "untrusted"
  sandbox: "read-only" | "workspace-write" | "danger-full-access"
  model?: string
  profile?: string
  enableSearch: boolean
  features: {
    goals: "default" | "enabled" | "disabled"
  }
  skipGitRepoCheck: boolean
  strictConfig: boolean
  bypassApprovalsAndSandbox: boolean
  bypassHookTrust: boolean
  additionalWritableDirs: string[]
  images: string[]
  configOverrides: Array<{ key: string; value: string }>

  captureDebugArtifacts: boolean
}
```

Default config:

```ts
{
  variables: [],
  prompt: "",
  approvalPolicy: "never",
  sandbox: "workspace-write",
  enableSearch: false,
  features: { goals: "enabled" },
  skipGitRepoCheck: true,
  strictConfig: false,
  bypassApprovalsAndSandbox: false,
  bypassHookTrust: false,
  additionalWritableDirs: [],
  images: [],
  configOverrides: [],
  captureDebugArtifacts: true,
}
```

Defaults are optimized for unattended local workflow runs without defaulting to full bypass mode.

## CLI Mapping

Base command:

```text
codex [global flags] exec [exec flags]
```

Prompt delivery:

- Pass the interpolated prompt through stdin.
- Do not place the full prompt in argv.

Default generated flags:

```text
--ask-for-approval never
exec
--sandbox workspace-write
--json
--output-last-message <artifact-dir>/last-message.txt
--skip-git-repo-check
--cd <workspace-path>
-
```

The trailing `-` is the `codex exec` prompt argument that tells Codex to read the initial instruction from stdin.

Global config mapping before `exec`:

- `approvalPolicy` -> `--ask-for-approval <value>`
- `enableSearch` -> `--search`
- `bypassApprovalsAndSandbox` -> `--dangerously-bypass-approvals-and-sandbox`

Exec config mapping after `exec`:

- `sandbox` -> `--sandbox <value>`
- `model` -> `--model <value>`
- `profile` -> `--profile <value>`
- `features.goals === "enabled"` -> `--enable goals`
- `features.goals === "disabled"` -> `--disable goals`
- `features.goals === "default"` -> no goals feature flag
- `skipGitRepoCheck` -> `--skip-git-repo-check`
- `strictConfig` -> `--strict-config`
- `bypassHookTrust` -> `--dangerously-bypass-hook-trust`
- `additionalWritableDirs[]` -> repeated `--add-dir <path>`
- `images[]` -> repeated `--image <path>`
- `configOverrides[]` -> repeated `--config <key=value>`

When `bypassApprovalsAndSandbox` is true, the command uses the bypass flag and does not also pass `--ask-for-approval` or `--sandbox`, avoiding contradictory permission arguments.

## Project Resolution

The Codex node uses the same project mechanism as Prompt nodes:

```text
node projectId -> workflow defaultProjectId -> inherited run project context
```

At runtime the project id resolves to a workspace path through existing repository/project configuration. The executor passes that path to Codex via `--cd`.

If no usable project path is available, the node fails with a short actionable error. It does not silently choose an unrelated directory.

## Runtime Flow

1. Resolve node variables with the existing Workflow variable resolver.
2. Interpolate `config.prompt` with resolved variables.
3. Resolve the effective project and workspace path.
4. Create a per-run Codex artifact directory:

   ```text
   workflow-runs/<runId>/nodes/<nodeId>/codex/
   ```

5. Prepare artifact paths:
   - `prompt.txt`
   - `last-message.txt`
   - `stdout.jsonl` or `stdout.log`
   - `stderr.log`
6. Build the `codex exec` request with argv array and stdin.
7. Run through `runtimeDeps.processRunner.run(...)`.
8. Read `last-message.txt`.
9. Return `last-message.txt` content as node `output` when exit code is successful.
10. Attach sanitized debug metadata to `outputs.codexDebug`.

Progress phases:

- `preparing_codex`
- `running_codex`
- `reading_result`
- `saving_debug_artifacts`

## Node Output

The node's primary `output` is always Codex's final reply text.

Downstream nodes receive only that final reply when they bind to this Codex node's output. They do not receive stdout, stderr, argv, or debug JSON by default.

Structured debug data is available in `outputs.codexDebug`.

## Debug History

Debug metadata shape:

```ts
interface CodexNodeDebugOutput {
  command: "codex exec"
  args: string[]
  cwd: string
  exitCode: number | null
  signal?: string
  durationMs: number
  stdoutPath?: string
  stderrPath?: string
  promptPath?: string
  lastMessagePath?: string
  stdoutPreview?: string
  stderrPreview?: string
  sessionHints?: string[]
}
```

The run snapshot should preserve this structure after sanitization. Paths are retained because ordinary local paths are useful for debugging. Secrets are redacted.

When Codex JSONL exposes session identifiers or log file hints in documented or stable-looking fields, store them as `sessionHints`. Do not scrape tokens, auth files, cookies, or unrelated local configuration.

## Artifact Storage

Artifacts are best-effort debug aids.

- If artifact directory creation fails, the node still attempts to run Codex and keeps sanitized previews in memory.
- If writing `prompt.txt` fails, continue execution and warn through structured logging.
- If `last-message.txt` cannot be read after a successful exit, fall back to a sanitized final stdout segment.
- If both final message and stdout fallback are empty, return an empty output and keep debug metadata.

Prompt artifacts are written only when `captureDebugArtifacts` is true. Even then, content must pass shared redaction before persistence.

## Security And Redaction

All persisted or displayed debug fields must use the existing shared redaction helpers where possible:

- argv and config override values
- prompt artifact content
- stdout and stderr previews
- visible error summaries
- `codexDebug` fields

Redaction must cover:

- token-like keys
- API keys
- Authorization and Bearer values
- cookies
- env secret assignments
- data-server tokens

Do not redact normal filesystem paths.

`configOverrides` are stored as key/value config, but debug output must show redacted values. Command execution uses argv arrays, not shell string concatenation.

## UI Design

The config panel follows existing Prompt node rhythm and current shadcn/Radix UI constraints. It uses existing components and no custom colors or inline styles.

Sections:

1. **输入映射**
   - Existing `VariableBindingEditor`

2. **项目**
   - Existing `ProjectSelect`
   - Same inherited project wording as Prompt node

3. **指令**
   - Existing `PromptEditor`

4. **执行配置**
   - Approval policy select
   - Sandbox select
   - Model input
   - Profile input
   - Timeout input
   - Search checkbox
   - Goals feature select with `默认` / `启用` / `禁用`; first version exposes only the known `goals` feature and never accepts free-text feature names
   - Skip git repo check checkbox
   - Strict config checkbox
   - Bypass approvals and sandbox checkbox
   - Bypass hook trust checkbox

5. **高级参数**
   - Additional writable directories list
   - Image paths list
   - Config overrides key/value list

6. **调试记录**
   - Capture debug artifacts checkbox

The panel should not include explanatory paragraphs about implementation internals.

## Validation

Save/edit validation:

- `prompt` is required.
- `timeoutMins`, when present, must be greater than 0.
- `approvalPolicy` and `sandbox` must be valid enum values.
- `features.goals` must be `default`, `enabled`, or `disabled`.
- `additionalWritableDirs` and `images` must not contain empty items.
- `configOverrides.key` must be non-empty.
- `configOverrides.key` values must be unique.
- `projectId`, when set, must refer to an existing configured project or repository.

Runtime validation:

- Codex CLI must be available.
- Effective workspace path must exist and be accessible.
- Additional writable directories and images must resolve to usable absolute paths.
- The process runner must be available in `runtimeDeps`.

Dangerous combinations:

- `bypassApprovalsAndSandbox` is allowed but default off.
- `sandbox: "danger-full-access"` is allowed but default off.
- The node should not block saving for these choices. The run record must show the effective flags.

## Error Handling

- Missing `codex`: fail with `未找到 Codex CLI`.
- Authentication failure: fail with sanitized Codex error summary.
- Non-interactive approval failure: fail and preserve sanitized stdout/stderr preview.
- Timeout: terminate the process and fail with `Codex 执行超时`.
- Workflow cancellation: terminate the process and return `cancelled`.
- Non-zero exit code: fail with stderr summary and keep debug metadata.
- Missing `last-message.txt` after success: fallback to stdout final segment.
- Artifact write failure: warn through structured logger and continue if possible.

## Logging

Structured logs may include:

- workflow id
- workflow run id
- node id
- node name
- project id
- cwd
- exit code
- signal
- duration
- CLI option keys
- artifact path presence

Logs must not include raw prompt text, raw stdout/stderr, token values, Authorization headers, cookies, or env secrets.

## Testing

Runtime and node tests:

- Schema defaults match unattended-friendly defaults.
- Default command includes `codex --ask-for-approval never exec`, `--sandbox workspace-write`, `--json`, `--skip-git-repo-check`, `--output-last-message`, and `--cd`.
- Default command includes `--enable goals`.
- Prompt goes through stdin and is absent from argv.
- `bypassApprovalsAndSandbox` emits the bypass flag and suppresses approval/sandbox flags.
- Model, profile, search, strict config, hook trust bypass, add-dir, image, and config overrides map correctly to argv.
- Successful run returns final reply text from `last-message.txt`.
- Missing final message falls back to stdout.
- Non-zero exit code fails and preserves sanitized debug metadata.
- Timeout and abort terminate the child process.
- Debug previews redact token, Authorization, Bearer, Cookie, and env secret values while preserving normal paths.

Renderer tests:

- Panel renders every exposed CLI option.
- Defaults are visible and match schema defaults.
- Project selector behaves like Prompt node project selection.
- Advanced lists can add, edit, and remove entries.
- Validation messages appear for empty prompt, invalid timeout, duplicate config override key, and empty list values.

Workflow regression tests:

- Downstream variable binding receives the Codex final reply text.
- Run history includes `outputs.codexDebug`.
- Existing Prompt, Script, HTTP Request, Switch, End, and Workflow Call nodes keep current behavior.

## Release Note

Implementation should update `RELEASE_NOTES_PENDING.md`:

```text
工作流新增 Codex 节点，可以在本机后台运行 Codex 提示词，并在运行历史中保留调试记录。
```
