/** Real CLI evaluation transport. Only a loopback test fixture and game capabilities are reachable. */
import { createInterface } from "node:readline"
import { createSynapseToolRouterSurface } from "../../electron/services/agent-runtime/synapse-tool-router"
import { MCP_TOOL_ACTIONS } from "../../synapse-capabilities/shared/registry"
import { GameHallService } from "../../app-capabilities/game-hall/main/service"
import { createGameDispatcher } from "../../app-capabilities/game-hall/main/dispatcher"
import {
  createPermissionGuard,
  InMemoryAuditSink,
} from "../../electron/runtime/security/permission-guard"
import type { AccountService } from "../../electron/services/account-service"
const [base, userId] = process.argv.slice(2)
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(base ?? "") || !userId)
  throw new Error("Only a loopback game evaluation fixture is allowed")
const account = {
  getState: () => ({
    status: "authenticated",
    connectivity: "online",
    profile: { user: { id: userId } },
  }),
  onBeforeIdentityChange: () => () => {},
  fetchAuthenticated: (path: string, init: RequestInit) =>
    fetch(base + "/api" + path, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${process.env.GAME_EVAL_ACCESS_TOKEN || userId}` },
    }),
} as unknown as AccountService
const service = new GameHallService(account),
  dispatcher = createGameDispatcher({
    service,
    permissionGuard: createPermissionGuard(),
    auditSink: new InMemoryAuditSink(),
  })
const surface = createSynapseToolRouterSurface(async (name, args) => {
  const operation = MCP_TOOL_ACTIONS[name]
  if (!operation?.startsWith("app.game."))
    return {
      ok: false,
      code: "EVAL_GAME_ONLY",
      error: "This fixture only exposes the game under test",
    }
  return dispatcher.dispatch(operation, args, {
    source: "mcp-stdio",
    actor: { kind: "user", id: "game-evaluation" },
  })
})
const lines = createInterface({ input: process.stdin })
lines.on("line", (line) => {
  void (async () => {
    let request: { id?: string | number; method: string; params?: Record<string, any> }
    try {
      request = JSON.parse(line)
    } catch {
      return
    }
    if (request.id === undefined) return
    try {
      let result: unknown
      switch (request.method) {
        case "initialize":
          result = {
            protocolVersion: request.params?.protocolVersion ?? "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "game-hall-evaluation", version: "1.0.0" },
            instructions: surface.instructions,
          }
          break
        case "ping":
          result = {}
          break
        case "tools/list":
          result = { tools: surface.listTools() }
          break
        case "tools/call":
          result = await surface.callTool(
            String(request.params?.name),
            request.params?.arguments ?? {},
          )
          break
        default:
          throw new Error("Unsupported evaluation method")
      }
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) + "\n")
    } catch (error) {
      process.stdout.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: request.id,
          error: {
            code: -32603,
            message: error instanceof Error ? error.message : "Evaluation failed",
          },
        }) + "\n",
      )
    }
  })()
})
lines.on("close", () => service.dispose())
