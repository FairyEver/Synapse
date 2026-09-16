import { describe, expect, it, vi } from "vitest"

import { createSynapseActionRouter } from "../../../../electron/capabilities/action-router"
import { MCP_TOOL_ACTIONS } from "../../../../synapse-capabilities/shared/registry"
import type { SynapseAccountState } from "../../../../src/types/account"
import { createAppCapabilityDispatcher } from "../../../dispatcher"
import { createAccountCapabilityDispatcher } from "../dispatcher"
import {
  ACCOUNT_LOGIN_START_MCP_TOOL_NAME,
  ACCOUNT_STATE_GET_MCP_TOOL_NAME,
} from "../../shared/capability"

/**
 * The path an MCP call actually takes: tool name to capability id to the App dispatcher to
 * the account handler. The catalog tests prove the tool is declared and the dispatcher
 * tests prove the handler works; this is the joint between them, which is the part that
 * would otherwise only be exercised by a running desktop application.
 */
function createMcpPath(state: SynapseAccountState) {
  const startLogin = vi.fn(async () => ({
    state: { status: "authenticating", loginUrl: "https://example.com/login" } as SynapseAccountState,
    loginUrl: "https://example.com/login",
    outcome: "opened" as const,
  }))
  const unused = { dispatch: vi.fn() }
  const appDispatcher = createAppCapabilityDispatcher({
    account: createAccountCapabilityDispatcher({
      service: { getState: () => state, startLogin },
    }),
    agentConversation: unused,
    textExtractor: unused,
    documentTemplate: unused,
    secrets: unused,
    soundNotifier: unused,
    systemNotifier: unused,
    fileOpener: unused,
    textFileWriter: unused,
    htmlGenerator: unused,
    problemFeedback: unused,
    jsonRepair: unused,
  })
  const router = createSynapseActionRouter({
    appDispatch: (action, params, context) => appDispatcher.dispatch(action, params, context),
    automationDispatch: unused.dispatch,
    contentDispatch: unused.dispatch,
    databaseDispatch: unused.dispatch,
    driveDispatch: unused.dispatch,
    modelPriceDispatch: unused.dispatch,
    repositoryDispatch: unused.dispatch,
    skillRepositoryDispatch: unused.dispatch,
    workflowDispatch: unused.dispatch,
  })
  return { router, startLogin }
}

/** What the MCP server does with a tool call, minus the transport. */
async function callTool(
  router: ReturnType<typeof createMcpPath>["router"],
  toolName: string,
  args: Record<string, unknown> = {},
) {
  const action = MCP_TOOL_ACTIONS[toolName]
  if (!action) throw new Error(`Unknown tool: ${toolName}`)
  return router.dispatch(action, args, { source: "mcp-http" })
}

describe("account MCP tools", () => {
  it("serves the account state through the tool an Agent is given", async () => {
    const state: SynapseAccountState = { status: "unauthenticated" }
    const { router } = createMcpPath(state)

    await expect(callTool(router, ACCOUNT_STATE_GET_MCP_TOOL_NAME)).resolves.toEqual({
      ok: true,
      data: state,
    })
  })

  it("starts a login through the tool an Agent is given", async () => {
    const { router, startLogin } = createMcpPath({ status: "unauthenticated" })

    const result = await callTool(router, ACCOUNT_LOGIN_START_MCP_TOOL_NAME)

    expect(result).toMatchObject({ ok: true, affected: 1 })
    expect(startLogin).toHaveBeenCalledTimes(1)
    expect(result.ok && (result.data as { loginUrl?: string }).loginUrl)
      .toBe("https://example.com/login")
  })

  it("rejects a tool name that is not registered", async () => {
    const { router } = createMcpPath({ status: "unauthenticated" })
    await expect(callTool(router, "app_account_login_cancel")).rejects.toThrow(
      "Unknown tool: app_account_login_cancel",
    )
  })
})
