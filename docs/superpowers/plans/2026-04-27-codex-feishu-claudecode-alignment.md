# Codex Feishu ClaudeCode Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Codex reach ClaudeCode-level Feishu interaction: live replies, tool progress, MCP/command/file permission cards, allow/deny callback, resume, and predictable failure handling.

**Architecture:** Keep ClaudeCode and Codex as separate adapters because their protocols are different. Both adapters must emit the same Synapse `AgentEvent` model, so Feishu stays shared and protocol-agnostic. Codex Feishu sessions must use `codex app-server --listen stdio://`; `codex exec --json` stays only as a noninteractive compatibility path.

**Tech Stack:** Electron main process, TypeScript, Vitest, Synapse `AgentRuntimeService`, Feishu connector services, Codex app-server JSON-RPC, ClaudeCode stream-json.

---

## Current Code And Demo Comparison

| Area | Synapse ClaudeCode | Synapse Codex Current | Demo Reference | Target |
|---|---|---|---|---|
| Live session entry | `desktop/electron/services/agent-runtime/adapters/claude-code.ts` starts `claude` with stream-json and `--permission-prompt-tool stdio` | `desktop/electron/services/agent-runtime/adapters/codex-exec.ts` can start `codex app-server --listen stdio://` when `backend: "app-server"` | `/Users/liyang/Documents/code/demo/cc-connect-main/agent/claudecode/session.go:54` and `/Users/liyang/Documents/code/demo/cc-connect-main/agent/codex/appserver_session.go:158` | Codex provider path always uses app-server for Feishu/live sessions |
| Permission request | Claude parses `control_request` and emits `permissionRequest` | Codex maps selected app-server server requests into `permissionRequest` | Claude: `session.go:453`; demo Codex app-server has no `RespondPermission` bridge at `appserver_session.go:482` | Codex covers all relevant app-server approval requests, not only the first MCP case |
| Permission response | Claude writes `control_response` | Codex writes JSON-RPC response with method-specific result shape | Claude: `session.go:600`; demo Codex exec no-op at `session.go:717` | Codex response mapping is typed, tested, and centralized |
| Feishu card | Shared `permissionRequest` dispatch sends card | Same shared path once Codex emits `permissionRequest` | Demo is Go-side connector, not Synapse Feishu | No Feishu special case for Codex |
| Tool progress | Claude maps `tool_use` to tool progress | Codex parser handles older snake_case items and some app-server events | Demo Codex handles app-server camelCase `commandExecution`, `mcpToolCall`, `dynamicToolCall`, `fileChange` at `appserver_session.go:739` | Codex parser supports app-server camelCase and legacy snake_case |
| Runtime wait loop | Shared live loop waits on `permissionRequest` | Same live loop | N/A | Keep common runtime behavior |
| Unsupported server request | N/A for Claude control protocol | Codex currently errors unsupported app-server server requests | Generated Codex protocol includes `item/tool/call`, `applyPatchApproval`, `execCommandApproval`, `account/chatgptAuthTokens/refresh` | Explicitly support or intentionally reject each known request with tests |

## App-Server Protocol Baseline

Use this command to refresh the local protocol view before implementation:

```bash
rm -rf /tmp/synapse-codex-app-server-ts
codex app-server generate-ts --out /tmp/synapse-codex-app-server-ts
rg -n "ServerRequest|DynamicToolCall|requestApproval|elicitation|requestUserInput" /tmp/synapse-codex-app-server-ts
```

Current generated `ServerRequest` includes:

```text
item/commandExecution/requestApproval
item/fileChange/requestApproval
item/tool/requestUserInput
mcpServer/elicitation/request
item/permissions/requestApproval
item/tool/call
account/chatgptAuthTokens/refresh
applyPatchApproval
execCommandApproval
```

## File Plan

| File | Action | Responsibility |
|---|---|---|
| `desktop/electron/services/agent-runtime/adapters/codex-app-server-protocol.ts` | Create | Codex app-server JSON-RPC types, method names, mode mapping, permission event mapping, response mapping, known unsupported responses |
| `desktop/electron/services/agent-runtime/adapters/codex-app-server-session.ts` | Create | Long-running Codex app-server session, initialize/thread/turn flow, pending RPC, server request dispatch |
| `desktop/electron/services/agent-runtime/adapters/codex-exec.ts` | Modify | Keep exec args, exec parser, public `CodexExecAdapter`; delegate app-server live session to the new session module |
| `desktop/electron/services/agent-runtime/types.ts` | Modify only if needed | Add a small host-tool executor interface only if `item/tool/call` is wired to a real executor |
| `desktop/electron/services/agent-runtime/index.ts` | Keep or lightly modify | Ensure Codex runtime view still sets `backend: "app-server"` for provider-backed live sessions |
| `desktop/electron/services/agent-runtime/__tests__/codex-app-server-protocol.test.ts` | Create | Pure protocol mapping tests |
| `desktop/electron/services/agent-runtime/__tests__/codex-exec.test.ts` | Modify | Keep exec parser coverage and move live-session tests to app-server-focused coverage |
| `desktop/electron/services/agent-runtime/__tests__/agent-runtime-service.test.ts` | Modify | Verify Codex permission requests pause runtime and resume after allow/deny, same as Claude |
| `desktop/electron/services/connectors/__tests__/feishu-reply-service.test.ts` | Modify if missing coverage | Verify Codex-origin permission event renders a Feishu permission card through the shared path |
| `desktop/electron/services/connectors/__tests__/feishu-connector-service.test.ts` | Modify if missing coverage | Verify Feishu card action calls `AgentRuntimeService.respondPermission` with request id and behavior |

## Non-Goals

- Do not merge ClaudeCode and Codex adapters.
- Do not make Feishu branch on adapter type.
- Do not revive `codex exec --json` as the Feishu interactive path.
- Do not add UI styling, new card design, or renderer changes.
- Do not add temporary method-name checks in Feishu services.

## Task 1: Lock The Desired Contract With Pure Protocol Tests

**Files:**
- Create: `desktop/electron/services/agent-runtime/__tests__/codex-app-server-protocol.test.ts`
- Create: `desktop/electron/services/agent-runtime/adapters/codex-app-server-protocol.ts`

- [ ] **Step 1: Add failing tests for app-server mode mapping**

Expected cases:

```ts
expect(codexAppServerModeSettings(undefined)).toEqual({
  approvalPolicy: "on-request",
  sandbox: "read-only",
})
expect(codexAppServerModeSettings("auto-edit")).toEqual({
  approvalPolicy: "never",
  sandbox: "workspace-write",
})
expect(codexAppServerModeSettings("yolo")).toEqual({
  approvalPolicy: "never",
  sandbox: "danger-full-access",
})
```

- [ ] **Step 2: Add failing tests for approval request to `permissionRequest` mapping**

Cover these methods:

```text
item/commandExecution/requestApproval -> Bash
execCommandApproval -> Bash
item/fileChange/requestApproval -> FileChange
applyPatchApproval -> FileChange
item/permissions/requestApproval -> Permissions
mcpServer/elicitation/request -> MCP Elicitation
item/tool/requestUserInput -> AskUserQuestion
```

Expected event shape:

```ts
expect(permissionEventForCodexServerRequest("req-1", {
  method: "item/commandExecution/requestApproval",
  params: { command: "pwd", cwd: "/repo" },
})).toEqual({
  type: "permissionRequest",
  requestId: "req-1",
  toolName: "Bash",
  toolInput: "pwd",
  toolInputRaw: { command: "pwd", cwd: "/repo" },
})
```

- [ ] **Step 3: Add failing tests for allow/deny response mapping**

Expected response examples:

```ts
expect(permissionResponseForCodexServerRequest(
  { method: "item/commandExecution/requestApproval", params: {} },
  { behavior: "allow" },
)).toEqual({ decision: "accept" })

expect(permissionResponseForCodexServerRequest(
  { method: "mcpServer/elicitation/request", params: {} },
  { behavior: "deny" },
)).toEqual({ action: "decline", content: null, _meta: null })
```

- [ ] **Step 4: Implement only pure helpers**

Implementation belongs in `codex-app-server-protocol.ts`. Keep it free of process state and Feishu imports.

- [ ] **Step 5: Verify**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/agent-runtime/__tests__/codex-app-server-protocol.test.ts
```

Expected: tests pass.

## Task 2: Extract Codex App-Server Live Session From `codex-exec.ts`

**Files:**
- Create: `desktop/electron/services/agent-runtime/adapters/codex-app-server-session.ts`
- Modify: `desktop/electron/services/agent-runtime/adapters/codex-exec.ts`
- Modify: `desktop/electron/services/agent-runtime/__tests__/codex-exec.test.ts`

- [ ] **Step 1: Move live-session-only code out of `codex-exec.ts`**

Move these responsibilities to `codex-app-server-session.ts`:

```text
CodexAppServerLiveSession
buildCodexAppServerArgs
JSON-RPC request/notify/write helpers
pending RPC map
pending server request map
app-server notification handling
```

Keep these in `codex-exec.ts`:

```text
CodexExecAdapter
buildCodexExecArgs
CodexJsonLineParser
parseCodexJsonLines
exec-session metadata helpers
```

- [ ] **Step 2: Preserve public exports**

`desktop/electron/services/agent-runtime/index.ts` already exports from `./adapters/codex-exec`. After the split, either re-export app-server helpers from `codex-exec.ts` or update `index.ts` explicitly. Avoid breaking these imports:

```ts
import { CodexExecAdapter, buildCodexExecArgs, CodexJsonLineParser } from "../agent-runtime"
```

- [ ] **Step 3: Make JSON-RPC framing explicit**

All app-server client requests and notifications should include `jsonrpc: "2.0"` unless Codex rejects it in a test:

```ts
await this.writeJsonLine({ jsonrpc: "2.0", id, method, params })
await this.writeJsonLine({ jsonrpc: "2.0", method, params })
```

Server responses should include the same field:

```ts
await this.writeJsonLine({ jsonrpc: "2.0", id: pending.id, result })
```

- [ ] **Step 4: Verify no behavior change**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/agent-runtime/__tests__/codex-exec.test.ts
pnpm desktop:typecheck
```

Expected: existing Codex tests and typecheck pass.

## Task 3: Align Codex Tool Progress With Demo App-Server Events

**Files:**
- Modify: `desktop/electron/services/agent-runtime/adapters/codex-exec.ts`
- Modify: `desktop/electron/services/agent-runtime/__tests__/codex-exec.test.ts`

- [ ] **Step 1: Add failing parser tests for camelCase app-server items**

Use the demo behavior from `/Users/liyang/Documents/code/demo/cc-connect-main/agent/codex/appserver_session.go:739`.

Test items:

```ts
{ type: "commandExecution", command: "pwd", status: "completed", aggregatedOutput: "/repo", exitCode: 0 }
{ type: "mcpToolCall", server: "synapse_database", tool: "list_tables", arguments: {}, status: "completed", result: { content: [] } }
{ type: "dynamicToolCall", namespace: "synapse", tool: "example", arguments: {}, status: "completed", contentItems: [{ type: "inputText", text: "ok" }], success: true }
{ type: "fileChange", changes: [], status: "completed" }
```

Expected Synapse events:

```text
commandExecution -> toolUse/toolResult Bash
mcpToolCall -> toolUse/toolResult MCP or concrete MCP tool name
dynamicToolCall -> toolUse/toolResult tool name
fileChange -> toolUse FileChange/Patch
```

- [ ] **Step 2: Keep snake_case parser compatibility**

Do not remove existing support for:

```text
command_execution
function_call
agent_message
```

Those are still used by `codex exec --json` style parsing.

- [ ] **Step 3: Implement a small item-type normalizer**

Keep the helper local to parser code:

```ts
function normalizeCodexItemType(value: unknown): string {
  switch (stringValue(value)) {
    case "commandExecution":
      return "command_execution"
    case "agentMessage":
      return "agent_message"
    case "mcpToolCall":
      return "mcp_tool_call"
    case "dynamicToolCall":
      return "dynamic_tool_call"
    case "fileChange":
      return "file_change"
    default:
      return stringValue(value) ?? ""
  }
}
```

- [ ] **Step 4: Verify**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/agent-runtime/__tests__/codex-exec.test.ts
```

Expected: parser emits the same user-visible progress classes as ClaudeCode does through Feishu.

## Task 4: Complete Codex Permission Bridge Coverage

**Files:**
- Modify: `desktop/electron/services/agent-runtime/adapters/codex-app-server-protocol.ts`
- Modify: `desktop/electron/services/agent-runtime/adapters/codex-app-server-session.ts`
- Modify: `desktop/electron/services/agent-runtime/__tests__/codex-app-server-protocol.test.ts`
- Modify: `desktop/electron/services/agent-runtime/__tests__/codex-exec.test.ts`

- [ ] **Step 1: Cover legacy and v2 approval method aliases**

Map both generations:

```text
execCommandApproval and item/commandExecution/requestApproval -> { decision: "accept" | "decline" }
applyPatchApproval and item/fileChange/requestApproval -> { decision: "accept" | "decline" }
```

- [ ] **Step 2: Cover `item/permissions/requestApproval`**

Allow response:

```ts
{
  permissions: grantedPermissionsFromRequest(params.permissions),
  scope: "turn",
}
```

Deny response:

```ts
new Error(decision.message ?? "Permission denied")
```

This mirrors the current app-server requirement and avoids inventing broader persistence.

- [ ] **Step 3: Cover `item/tool/requestUserInput`**

Response must preserve Codex's answer shape:

```ts
{
  answers: {
    [questionId]: { answers: ["selected label or typed answer"] },
  },
}
```

Do not overload allow/deny as a real answer. If Feishu cannot collect detailed answers yet, return empty answers on deny and keep the request visible as a permission card until a richer question card is implemented.

- [ ] **Step 4: Handle `account/chatgptAuthTokens/refresh` intentionally**

Synapse provider-backed Codex should not depend on ChatGPT token refresh. Add a deterministic JSON-RPC error:

```text
ChatGPT auth token refresh is not available in this Synapse provider session.
```

Test that it does not create a Feishu permission card.

- [ ] **Step 5: Verify runtime pause/resume**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/agent-runtime/__tests__/agent-runtime-service.test.ts
```

Expected: Codex permission requests pause the live turn and resume after `respondPermission`, same as ClaudeCode.

## Task 5: Decide And Implement `item/tool/call` Without Temporary Code

**Files:**
- Modify only if real executor is wired: `desktop/electron/services/agent-runtime/types.ts`
- Modify: `desktop/electron/services/agent-runtime/adapters/codex-app-server-session.ts`
- Modify: `desktop/electron/services/agent-runtime/__tests__/codex-exec.test.ts`

- [ ] **Step 1: Add a test for the no-executor path**

If Synapse has not registered host tools for Codex, `item/tool/call` must return a deterministic JSON-RPC error instead of hanging:

```text
Unsupported codex app-server request: item/tool/call
```

This is better than a dead fake executor.

- [ ] **Step 2: Add an executor interface only when a real caller exists**

If implementation needs real dynamic tools, add the smallest stable interface:

```ts
export interface AgentHostToolExecutor {
  call(input: {
    readonly projectId: string
    readonly workDir: string
    readonly threadId?: string
    readonly namespace?: string
    readonly tool: string
    readonly arguments: unknown
  }): Promise<{
    readonly contentItems: readonly { readonly type: "inputText"; readonly text: string }[]
    readonly success: boolean
  }>
}
```

Do not wire this to Feishu. `item/tool/call` is tool execution, not a user confirmation card.

- [ ] **Step 3: Only support registered tools**

If no registered executor exists for `namespace/tool`, return:

```ts
{
  contentItems: [{ type: "inputText", text: `Tool not available: ${name}` }],
  success: false,
}
```

This keeps Codex informed without pretending a tool ran.

- [ ] **Step 4: Verify**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/agent-runtime/__tests__/codex-exec.test.ts
```

Expected: no hanging pending request for `item/tool/call`.

## Task 6: Verify Feishu Is Adapter-Agnostic

**Files:**
- Modify: `desktop/electron/services/connectors/__tests__/feishu-reply-service.test.ts`
- Modify: `desktop/electron/services/connectors/__tests__/feishu-connector-service.test.ts`

- [ ] **Step 1: Add a Codex-origin permission card test**

Use a plain `AgentPermissionRequestEvent` with Codex-like tool input:

```ts
const event = {
  type: "permissionRequest",
  requestId: "codex-mcp-1",
  toolName: "MCP Elicitation",
  toolInput: "Authorize MCP",
  toolInputRaw: { serverName: "synapse-database" },
} as const
```

Expected: `FeishuReplyService.dispatchAgentEvent` calls `client.sendCard`.

- [ ] **Step 2: Add a card action callback test**

Expected:

```ts
await connectorService.handleCardAction(fakeAllowAction)
expect(agent.respondPermission).toHaveBeenCalledWith(expect.objectContaining({
  requestId: "codex-mcp-1",
  behavior: "allow",
}))
```

- [ ] **Step 3: Do not add Codex conditionals to Feishu services**

The only accepted flow is:

```text
Codex adapter -> AgentEvent.permissionRequest -> Feishu card -> AgentRuntimeService.respondPermission -> Codex live session
```

## Task 7: Remove Dead Or Ambiguous Codex Paths

**Files:**
- Modify: `desktop/electron/services/agent-runtime/adapters/codex-exec.ts`
- Modify: `desktop/electron/services/agent-runtime/index.ts`
- Modify: tests if assertions depend on old behavior

- [ ] **Step 1: Make Feishu/live mode impossible to accidentally route through exec**

`adapterFromRuntimeView` should continue to construct Codex with:

```ts
backend: "app-server"
```

Add or keep a test that fails if provider-backed Codex lacks `startSession`.

- [ ] **Step 2: Label exec path as compatibility-only in code comments**

One short comment is enough:

```ts
// Compatibility path for one-shot Codex JSONL runs. Feishu/live sessions use app-server.
```

Do not add large architectural comments.

- [ ] **Step 3: Delete unused app-server helpers from `codex-exec.ts` after extraction**

After Task 2, `codex-exec.ts` should not contain:

```text
PendingServerRequest
pendingServerRequests
serverRequestPermissionEvent
permissionResponse
codexAppServerModeSettings
```

Those belong in the app-server modules.

## Task 8: End-To-End Verification Matrix

**Files:**
- No source files unless tests expose a gap

- [ ] **Step 1: Unit tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  electron/services/agent-runtime/__tests__/codex-app-server-protocol.test.ts \
  electron/services/agent-runtime/__tests__/codex-exec.test.ts \
  electron/services/agent-runtime/__tests__/agent-runtime-service.test.ts \
  electron/services/connectors/__tests__/feishu-reply-service.test.ts \
  electron/services/connectors/__tests__/feishu-connector-service.test.ts
```

Expected: all selected tests pass.

- [ ] **Step 2: Full desktop validation**

Run:

```bash
pnpm desktop:typecheck
pnpm desktop:check:hard-constraints
pnpm desktop:test
git diff --check
```

Expected: all pass.

- [ ] **Step 3: Manual scenario list for the user**

Do not start a dev server unless explicitly requested. Provide these manual checks:

```text
1. Feishu asks Codex to call synapse_database.list_tables.
2. Synapse sends a Feishu confirmation card instead of returning user cancelled MCP tool call.
3. User clicks allow.
4. Codex continues and reports the table list.
5. Repeat with deny; Codex receives a denial and stops cleanly.
6. Ask Codex to create a file; command/file permission appears and round-trips.
```

## Definition Of Done

- Codex and ClaudeCode remain separate adapters.
- Feishu services remain shared and adapter-agnostic.
- Codex provider-backed live sessions always use app-server.
- Codex approval requests round-trip through Synapse permission state and Feishu cards.
- Codex app-server camelCase tool items render useful tool progress.
- Every known Codex app-server server request is either supported or intentionally rejected with a tested error.
- No dead fake executor, no temporary Feishu-side Codex special case, no broad rewrite.

## Self-Review

- Spec coverage: the plan covers app-server session, permission bridge, Feishu card loop, demo code comparison, tests, and cleanup.
- Placeholder scan: no task depends on undefined behavior; `item/tool/call` has an explicit no-executor policy and a real executor path only when needed.
- Type consistency: all new boundaries use existing `AgentEvent`, `AgentPermissionDecision`, and `AgentLiveSession` concepts.
