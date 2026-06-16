# Workflow Claude Code Node Design

> Date: 2026-06-16
> Status: Design confirmed, waiting for user review

## Background

Synapse Workflow already has a Codex node that runs the user's local Codex CLI through `runtimeDeps.processRunner.run(...)`. That node is intentionally separate from `AgentRuntimeService`: it does not create Synapse Agent conversations, does not use the renderer Agent chat runtime, and stores its result as ordinary workflow node output plus sanitized debug history.

The requested Claude Code node should follow the same product and runtime pattern, but it must call the user's local Claude Code CLI. It must not use Synapse's bundled Claude Code runtime or the existing Claude SDK session path. If the user can run Claude Code from their terminal, Workflow can use it. If the user's terminal cannot run it, Workflow should fail with a clear message and should not offer a separate executable picker.

Claude Code documents `claude -p "query"` as the non-interactive query mode and supports print-mode flags such as `--output-format`, `--permission-mode`, `--model`, `--add-dir`, `--settings`, `--mcp-config`, and `--setting-sources`.

Reference: https://code.claude.com/docs/en/cli-reference

## Goals

- Add a first-class `claude_code` workflow node.
- Run the user's local `claude` CLI in print mode from Workflow.
- Resolve `claude` through the same merged PATH strategy a user's terminal environment would expose to Synapse process execution.
- Keep the node independent from `AgentRuntimeService`, Synapse Agent conversations, and Synapse's bundled Claude Code runtime.
- Preserve existing Workflow project resolution semantics.
- Return Claude Code's final reply text as the node `output`.
- Persist sanitized debug-grade workflow history with command metadata, stdout/stderr previews, artifact paths, and optional Claude Code session hints when available.
- Expose a small, useful subset of Claude Code CLI options instead of mirroring the entire CLI surface.

## Non-Goals

- Do not call Synapse's bundled Claude Code runtime.
- Do not use `desktop/electron/services/agent-runtime/claude-sdk-session.ts`.
- Do not create Synapse Agent conversations from this node.
- Do not add a custom Claude executable path setting.
- Do not auto-install, update, authenticate, or repair Claude Code for the user.
- Do not implement Claude Code daemon, background agent, remote control, web session, or SDK integration.
- Do not replace or alter the existing Prompt node.
- Do not add new dependencies.
- Do not store real tokens, Authorization headers, cookies, API keys, or env secrets in workflow history.

## Chosen Approach

Create an independent Workflow node under `desktop/workflow-nodes/claude-code/` with the same shape as the Codex node:

```text
desktop/workflow-nodes/claude-code/
  schema.ts
  manifest.ts
  command.ts
  artifacts.main.ts
  executor.main.ts
  panel.tsx
  card.tsx
  index.ts
```

The executor calls `runtimeDeps.processRunner.run(...)` with command `claude` and print-mode arguments. The request uses `pathStrategy: "merge"` so the executable is resolved from the process PATH environment rather than from Synapse's bundled runtime path. This keeps the node in the same operational class as Script and Codex nodes: it is a background workflow action with a workflow result, not an Agent chat session.

Register the node in the same locations as Codex:

- `desktop/workflow-nodes/register.main.ts`
- `desktop/workflow-nodes/register.renderer.ts`
- `desktop/workflow-nodes/panel-registry.ts`
- Workflow editor node wrapper map
- Workflow runner node wrapper map
- Workflow validator and snapshot sanitizer where node-type-specific handling is needed
- Workflow MCP/capability node type descriptions, because Workflow has corresponding MCP tools

## Alternatives Considered

### Extend Prompt Node

Adding a runner selector to Prompt would reuse some UI, but it would mix Agent conversation semantics with local CLI execution semantics. It would also make permissions, history, output parsing, and cancellation harder to reason about.

### Script Node Preset

A Script template could run `claude -p`, but users would have to manage flags, output extraction, timeouts, debug artifacts, and redaction themselves. It would not feel like a first-class workflow node.

### Reuse Synapse Agent Runtime

The existing Agent Runtime already knows how to talk to Claude Code through the SDK, but using it would violate the requested boundary. The new node must call the user's local terminal CLI, not Synapse's bundled runtime.

## Node Configuration

```ts
interface ClaudeCodeNodeConfig {
  variables: WorkflowVariableBinding[]
  prompt: string
  workingDirectory?: string
  projectId?: string
  timeoutMins?: number

  permissionMode: "default" | "acceptEdits" | "plan" | "auto" | "dontAsk" | "bypassPermissions"
  model?: string
  maxTurns?: number
  outputFormat: "text" | "json" | "stream-json"
  verbose: boolean
  safeMode: boolean
  bareMode: boolean
  noSessionPersistence: boolean
  settingSources: Array<"user" | "project" | "local">
  settingsPath?: string
  mcpConfigPath?: string
  strictMcpConfig: boolean
  additionalDirectories: string[]
  allowedTools: string[]
  disallowedTools: string[]

  captureDebugArtifacts: boolean
}
```

Default config:

```ts
{
  variables: [],
  prompt: "",
  permissionMode: "acceptEdits",
  outputFormat: "stream-json",
  verbose: true,
  safeMode: false,
  bareMode: false,
  noSessionPersistence: false,
  settingSources: ["user", "project", "local"],
  strictMcpConfig: false,
  additionalDirectories: [],
  allowedTools: [],
  disallowedTools: [],
  captureDebugArtifacts: true,
}
```

`acceptEdits` is the recommended unattended default: Claude Code can make file edits in the selected project without blocking on every edit prompt, while still avoiding `bypassPermissions` by default. `bypassPermissions` remains available because the CLI supports it, but the UI must not default to it.

## CLI Mapping

Base command:

```text
claude -p [flags] <prompt>
```

Default generated flags:

```text
-p
--output-format stream-json
--verbose
--permission-mode acceptEdits
--setting-sources user,project,local
```

Mapping:

- `permissionMode` -> `--permission-mode <value>`
- `model` -> `--model <value>`
- `maxTurns` -> `--max-turns <value>`
- `outputFormat` -> `--output-format <value>`
- `verbose` -> `--verbose`
- `safeMode` -> `--safe-mode`
- `bareMode` -> `--bare`
- `noSessionPersistence` -> `--no-session-persistence`
- `settingSources` -> `--setting-sources <comma-separated values>`
- `settingsPath` -> `--settings <absolute path>`
- `mcpConfigPath` -> `--mcp-config <absolute path>`
- `strictMcpConfig` -> `--strict-mcp-config`
- `additionalDirectories[]` -> repeated `--add-dir <absolute path>`
- `allowedTools[]` -> repeated `--allowedTools <rule>`
- `disallowedTools[]` -> repeated `--disallowedTools <rule>`

Prompt handling:

- The interpolated prompt should be passed to the CLI without persisting it in a command string.
- Use argv arrays only; do not construct shell strings.
- The prompt may be the final argv argument because `claude -p` accepts a query argument. Debug output must not include that raw prompt in the sanitized args.
- If implementation verifies that the installed CLI reliably accepts prompt text through stdin with `-p`, prefer stdin to keep argv cleaner. The behavior must be covered by tests before choosing stdin.

Output handling:

- Default to `--output-format stream-json --verbose` so the node can parse structured events and preserve useful debug previews.
- The primary node output is the final assistant result text.
- For `json`, parse known result fields and fall back to raw sanitized stdout.
- For `text`, use stdout as the final output after trimming.
- If structured output does not expose a final message, fall back to the final non-empty stdout segment.

## Project Resolution

The Claude Code node uses the same project mechanism as Prompt, Script, and Codex nodes:

```text
node projectId -> workflow defaultProjectId -> inherited run project context
```

At runtime the effective project id resolves to a workspace path through existing repository/project configuration.

If `workingDirectory` is empty, the executor uses the project workspace as the process `cwd`.

If `workingDirectory` is set, the executor interpolates it with node variables, resolves relative paths against the project workspace, verifies the directory exists, and uses that path as the process `cwd`.

The node does not pass a custom executable path. If `claude` cannot be resolved by the process runner with merged PATH, the node fails with `未找到 Claude Code CLI`.

`additionalDirectories`, `settingsPath`, and `mcpConfigPath` resolve relative paths against the effective working directory. Directories must exist as directories. Settings and MCP config paths must exist as files.

## Runtime Flow

1. Resolve node variables with the existing Workflow variable resolver.
2. Interpolate `config.prompt` with resolved variables.
3. Resolve the effective project and workspace path.
4. Resolve the effective working directory.
5. Resolve and validate advanced path inputs.
6. When `captureDebugArtifacts` is true, create a per-run artifact directory:

   ```text
   workflow-runs/<runId>/nodes/<nodeId>/claude-code/
   ```

7. Prepare debug artifact paths:
   - `prompt.txt`
   - `stdout.log` or `stdout.jsonl`
   - `stderr.log`
   - `last-message.txt`
8. Build the `claude -p` request with an argv array, `cwd`, timeout, abort signal, and stream line handlers.
9. Run through `runtimeDeps.processRunner.run(...)`.
10. Parse the final reply from stdout.
11. Write a sanitized persistent copy of the prompt, streams, and final reply when debug capture is enabled.
12. Return final reply text as node `output`.
13. Attach sanitized debug metadata to `outputs.claudeCodeDebug`.

Progress phases:

- `resolving_project`
- `resolving_variables`
- `preparing_claude_code`
- `running_claude_code`
- `processing_output`
- `saving_debug_artifacts`

## Node Output

The node's primary `output` is always Claude Code's final reply text.

Downstream nodes receive only that final reply when they bind to this Claude Code node's output. They do not receive stdout, stderr, argv, permission settings, or debug JSON by default.

Structured debug data is available in `outputs.claudeCodeDebug`.

## Debug History

```ts
interface ClaudeCodeNodeDebugOutput {
  command: "claude -p"
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

The run snapshot should preserve this structure after sanitization. Ordinary local paths are retained because they are useful for debugging. Secret-looking values are redacted.

Potential session hints may include stable-looking fields such as `session_id`, `sessionId`, or transcript/log path fields emitted in structured output. Do not read `~/.claude.json`, auth files, cookies, process tables, or other unrelated local configuration to discover extra metadata.

## Artifact Storage

Artifacts are best-effort debug aids.

- If artifact directory creation fails, the node still attempts to run Claude Code and keeps sanitized previews in memory.
- If writing `prompt.txt` fails, continue execution and warn through structured logging.
- If stdout or stderr artifacts exceed the existing size limit pattern used by Codex, truncate the artifact and append a truncation notice.
- If final output parsing fails after a successful exit, fall back to sanitized stdout.
- If both parsed final output and stdout fallback are empty, return an empty output and keep debug metadata.

Prompt, stdout, stderr, and last-message artifacts are written only when `captureDebugArtifacts` is true. Persistent artifact content must pass shared redaction before persistence.

## Security And Redaction

All persisted or displayed debug fields must use existing shared redaction helpers where possible:

- argv values
- prompt artifact content
- stdout and stderr previews
- visible error summaries
- `claudeCodeDebug` fields

Redaction must cover:

- token-like keys
- API keys
- Authorization and Bearer values
- cookies
- env secret assignments
- data-server tokens

Do not redact normal filesystem paths.

Special argv rule: the raw prompt must not appear in `claudeCodeDebug.args`, even if the process request passes it as the final CLI argument. Replace it with `[prompt]` or omit it from debug args.

## UI Design

The config panel follows existing Workflow node panels, the Codex node rhythm, and current shadcn/Radix UI constraints. Use existing components and Tailwind tokens only. Do not add custom colors, inline styles, card nesting, marketing copy, or explanatory paragraphs.

Sections:

1. **输入映射**
   - Existing `VariableBindingEditor`

2. **项目**
   - Existing `ProjectSelect`
   - Same inherited project behavior as Prompt, Script, and Codex nodes

3. **指令**
   - Existing `PromptEditor`

4. **执行配置**
   - Permission mode select
   - Model input
   - Timeout input
   - Max turns input
   - Output format select
   - Verbose checkbox
   - Safe mode checkbox
   - Bare mode checkbox
   - No session persistence checkbox

5. **Claude Code 配置**
   - Setting sources multi-select or checkbox group
   - Settings path input
   - MCP config path input
   - Strict MCP config checkbox

6. **权限规则**
   - Additional directories list
   - Allowed tools list
   - Disallowed tools list

7. **调试记录**
   - Capture debug artifacts checkbox

The panel should not say "此节点用于..." or include implementation explanations.

## Validation

Save/edit validation:

- `prompt` is required.
- `timeoutMins`, when present, must be greater than 0.
- `maxTurns`, when present, must be greater than 0.
- `permissionMode` must be one of the supported Claude Code permission modes.
- `outputFormat` must be `text`, `json`, or `stream-json`.
- `settingSources` must contain only `user`, `project`, or `local`; duplicates are removed or rejected consistently with local form patterns.
- `additionalDirectories`, `allowedTools`, and `disallowedTools` must not contain empty items.
- `settingsPath` and `mcpConfigPath`, when set, must not be empty after trimming.
- `projectId`, when set, must refer to an existing configured project or repository.

Runtime validation:

- Local `claude` CLI must be available from merged PATH.
- Effective workspace path must exist and be accessible.
- Effective working directory must exist and be a directory.
- `additionalDirectories` must resolve to existing directories.
- `settingsPath` and `mcpConfigPath` must resolve to existing files.
- The process runner must be available in `runtimeDeps`.

Dangerous combinations:

- `permissionMode: "bypassPermissions"` is allowed but default off.
- `--strict-mcp-config` with no `mcpConfigPath` is allowed because it can intentionally disable non-explicit MCP loading. The run record must show the effective flags.

## Error Handling

- Missing `claude`: fail with `未找到 Claude Code CLI`.
- Not authenticated: fail with sanitized Claude Code error summary.
- Permission prompt or non-interactive permission failure: fail and preserve sanitized stdout/stderr preview.
- Timeout: terminate the process and fail with `Claude Code 执行超时`.
- Workflow cancellation: terminate the process and return `cancelled`.
- Non-zero exit code: fail with sanitized stderr/stdout summary and keep debug metadata.
- Output parse failure after successful exit: fall back to stdout.
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

- Schema defaults match the design defaults.
- Default command includes `claude -p`, `--output-format stream-json`, `--verbose`, `--permission-mode acceptEdits`, and `--setting-sources user,project,local`.
- Command uses `pathStrategy: "merge"`.
- Command does not use Synapse bundled Claude runtime helpers.
- Prompt is absent or replaced from debug args.
- Model, max turns, safe mode, bare mode, no session persistence, settings path, MCP config path, strict MCP config, add-dir, allowed tools, and disallowed tools map correctly to argv.
- Successful `stream-json` run returns final assistant text.
- Successful `json` run returns final result text.
- Successful `text` run returns stdout text.
- Missing final message falls back to stdout.
- Non-zero exit fails and preserves sanitized debug metadata.
- Timeout and abort terminate the child process.
- Missing CLI errors normalize to `未找到 Claude Code CLI`.
- Debug previews redact token, Authorization, Bearer, Cookie, and env secret values while preserving normal paths.

Renderer tests:

- Panel renders every exposed option.
- Defaults are visible and match schema defaults.
- Project selector behaves like Prompt/Codex node project selection.
- Advanced lists can add, edit, and remove entries.
- Validation messages appear for empty prompt, invalid timeout, invalid max turns, and empty list values.
- UI uses existing components and avoids custom colors or inline style.

Workflow regression tests:

- Downstream variable binding receives the Claude Code final reply text.
- Run history includes `outputs.claudeCodeDebug`.
- Run report renders Claude Code debug fields without leaking secrets.
- Existing Prompt, Script, HTTP Request, Switch, End, Workflow Call, and Codex nodes keep current behavior.
- Workflow MCP node type list and describe include `claude_code`.

## Release Note

Implementation should update `RELEASE_NOTES_PENDING.md`:

```text
工作流新增 Claude Code 节点，可以调用用户本机终端里的 Claude Code CLI，并在运行历史中保留调试记录。
```
