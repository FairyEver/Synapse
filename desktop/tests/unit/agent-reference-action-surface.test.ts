import { readdirSync, readFileSync, statSync } from "node:fs"
import { describe, expect, it } from "vitest"

import {
  CAPABILITY_DOMAINS,
  buildAllMcpTools,
} from "../../synapse-capabilities/shared/registry"

const desktopRoot = new URL("../../", import.meta.url)
const operationIds = [
  "app.agent.reference.open_default",
  "app.agent.reference.show_in_folder",
] as const
const bridgeMethods = [
  "openReferenceDefault",
  "showReferenceInFolder",
] as const

describe("Agent reference action public surface", () => {
  it("keeps both actions confined to Agent Renderer IPC, preload, and bridge", () => {
    const agentIpc = readDesktopFile("electron/modules/agent/ipc-tools.ts")
    const preload = readDesktopFile("electron/preload.ts")
    const bridge = readDesktopFile("src/types/bridge.ts")

    for (const operationId of operationIds) {
      expect(agentIpc).toContain(`operationId: "${operationId}"`)
    }
    for (const method of bridgeMethods) {
      expect(agentIpc).toContain(`${method}: {`)
      expect(preload).toContain(`${method}: (args) => invoke(IPC_CHANNELS.agent.${method})(args)`)
      expect(bridge).toContain(`${method}: (args: AgentReferenceActionInput)`)
    }

    const genericOrPublicSources = [
      readDesktopTypeScriptTree("electron/modules/shell"),
      readDesktopTypeScriptTree("app-capabilities"),
      readDesktopTypeScriptTree("workflow-nodes"),
    ].join("\n")
    for (const operationId of operationIds) {
      expect(genericOrPublicSources).not.toContain(operationId)
    }
    for (const method of bridgeMethods) {
      expect(genericOrPublicSources).not.toContain(method)
    }

    const capabilityIds = CAPABILITY_DOMAINS
      .flatMap((domain) => domain.capabilities.map((capability) => capability.id))
    const mcpToolNames = buildAllMcpTools().map((tool) => tool.name)
    expect(capabilityIds).not.toEqual(expect.arrayContaining([...operationIds]))
    expect(mcpToolNames).not.toEqual(expect.arrayContaining([
      "app_agent_reference_open_default",
      "app_agent_reference_show_in_folder",
    ]))
  })
})

function readDesktopFile(path: string): string {
  return readFileSync(new URL(path, desktopRoot), "utf8")
}

function readDesktopTypeScriptTree(path: string): string {
  return readTypeScriptTree(new URL(`${path}/`, desktopRoot))
}

function readTypeScriptTree(root: URL): string {
  return readdirSync(root).flatMap((entry) => {
    const entryUrl = new URL(entry, root)
    if (statSync(entryUrl).isDirectory()) {
      if (entry === "__tests__") return []
      return [readTypeScriptTree(new URL(`${entry}/`, root))]
    }
    return /\.(?:ts|tsx)$/.test(entry) ? [readFileSync(entryUrl, "utf8")] : []
  }).join("\n")
}
