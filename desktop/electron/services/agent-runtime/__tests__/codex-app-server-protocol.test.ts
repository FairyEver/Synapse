import { describe, expect, it } from "vitest"

import {
  codexAppServerModeSettings,
  permissionEventForCodexServerRequest,
  permissionResponseForCodexServerRequest,
} from "../adapters/codex-app-server-protocol"

describe("Codex app-server protocol helpers", () => {
  it("maps Synapse modes to Codex app-server approval and sandbox settings", () => {
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
  })

  it("maps approval and question server requests to permission events", () => {
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

    expect(permissionEventForCodexServerRequest("req-2", {
      method: "execCommandApproval",
      params: { command: "pnpm test", cwd: "/repo" },
    })).toEqual(expect.objectContaining({
      type: "permissionRequest",
      requestId: "req-2",
      toolName: "Bash",
      toolInput: "pnpm test",
    }))

    expect(permissionEventForCodexServerRequest("req-3", {
      method: "item/fileChange/requestApproval",
      params: { grantRoot: "/repo/src", reason: "Write file" },
    })).toEqual(expect.objectContaining({
      type: "permissionRequest",
      requestId: "req-3",
      toolName: "FileChange",
      toolInput: "/repo/src",
    }))

    expect(permissionEventForCodexServerRequest("req-4", {
      method: "applyPatchApproval",
      params: { reason: "Apply patch" },
    })).toEqual(expect.objectContaining({
      type: "permissionRequest",
      requestId: "req-4",
      toolName: "FileChange",
      toolInput: "Apply patch",
    }))

    expect(permissionEventForCodexServerRequest("req-5", {
      method: "item/permissions/requestApproval",
      params: { reason: "Need access", permissions: { fileSystem: { write: ["/repo"] } } },
    })).toEqual(expect.objectContaining({
      type: "permissionRequest",
      requestId: "req-5",
      toolName: "Permissions",
      toolInput: "Need access",
    }))

    expect(permissionEventForCodexServerRequest("req-6", {
      method: "mcpServer/elicitation/request",
      params: { serverName: "synapse-mcp", message: "Authorize MCP" },
    })).toEqual(expect.objectContaining({
      type: "permissionRequest",
      requestId: "req-6",
      toolName: "MCP Elicitation",
      toolInput: "Authorize MCP",
      toolInputRaw: { serverName: "synapse-mcp", message: "Authorize MCP" },
    }))

    expect(permissionEventForCodexServerRequest("req-7", {
      method: "item/tool/requestUserInput",
      params: {
        questions: [{
          id: "q1",
          question: "Pick one",
          options: [{ label: "A" }],
        }],
      },
    })).toEqual(expect.objectContaining({
      type: "permissionRequest",
      requestId: "req-7",
      toolName: "AskUserQuestion",
      questions: [{ question: "Pick one", options: [{ label: "A", description: undefined }] }],
    }))
  })

  it("does not create permission events for non-confirmation server requests", () => {
    expect(permissionEventForCodexServerRequest("req-1", {
      method: "account/chatgptAuthTokens/refresh",
      params: {},
    })).toBeNull()
    expect(permissionEventForCodexServerRequest("req-2", {
      method: "item/tool/call",
      params: { tool: "database_table_list" },
    })).toBeNull()
  })

  it("maps allow and deny decisions to method-specific responses", () => {
    expect(permissionResponseForCodexServerRequest(
      { method: "item/commandExecution/requestApproval", params: {} },
      { behavior: "allow" },
    )).toEqual({ decision: "accept" })
    expect(permissionResponseForCodexServerRequest(
      { method: "execCommandApproval", params: {} },
      { behavior: "deny" },
    )).toEqual({ decision: "decline" })
    expect(permissionResponseForCodexServerRequest(
      { method: "item/fileChange/requestApproval", params: {} },
      { behavior: "allow" },
    )).toEqual({ decision: "accept" })
    expect(permissionResponseForCodexServerRequest(
      { method: "applyPatchApproval", params: {} },
      { behavior: "deny" },
    )).toEqual({ decision: "decline" })
    expect(permissionResponseForCodexServerRequest(
      {
        method: "item/permissions/requestApproval",
        params: { permissions: { network: { outbound: ["api.example.test"] } } },
      },
      { behavior: "allow" },
    )).toEqual({
      permissions: { network: { outbound: ["api.example.test"] } },
      scope: "turn",
    })
    expect(permissionResponseForCodexServerRequest(
      { method: "mcpServer/elicitation/request", params: {} },
      { behavior: "deny" },
    )).toEqual({ action: "decline", content: null, _meta: null })
    expect(permissionResponseForCodexServerRequest(
      { method: "item/tool/requestUserInput", params: {} },
      { behavior: "allow", updatedInput: { answers: { q1: { answers: ["A"] } } } },
    )).toEqual({ answers: { q1: { answers: ["A"] } } })
  })

  it("returns deterministic errors for intentionally unsupported responses", () => {
    expect(permissionResponseForCodexServerRequest(
      { method: "item/permissions/requestApproval", params: {} },
      { behavior: "deny", message: "No" },
    )).toEqual(new Error("No"))

    expect(permissionResponseForCodexServerRequest(
      { method: "account/chatgptAuthTokens/refresh", params: {} },
      { behavior: "allow" },
    )).toEqual(new Error(
      "ChatGPT auth token refresh is not available in this Synapse provider session.",
    ))

    expect(permissionResponseForCodexServerRequest(
      { method: "item/tool/call", params: {} },
      { behavior: "allow" },
    )).toEqual(new Error("Unsupported codex app-server request: item/tool/call"))
  })
})
