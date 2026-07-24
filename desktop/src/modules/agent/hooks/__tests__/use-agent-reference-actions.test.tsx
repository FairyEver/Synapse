/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  type AgentReferenceActions,
  useAgentReferenceActions,
} from "../use-agent-reference-actions"

const { agentBridge } = vi.hoisted(() => ({
  agentBridge: {
    openReferenceDefault: vi.fn(async () => ({ ok: true as const })),
    showReferenceInFolder: vi.fn(async () => ({ ok: true as const })),
  },
}))

vi.mock("@/lib/electron-bridge", () => ({
  getSynapseBridge: () => ({ agent: agentBridge }),
}))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined
let actions: AgentReferenceActions | undefined

afterEach(() => {
  if (root) {
    act(() => root?.unmount())
  }
  root = undefined
  actions = undefined
  document.body.innerHTML = ""
  vi.clearAllMocks()
})

describe("useAgentReferenceActions", () => {
  it("binds both narrow bridge actions to the current project", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(<Driver projectId="project-1" />)
    })

    await actions?.openDefault("/tmp/report.txt")
    await actions?.showInFolder("./src/app.ts:12")

    expect(agentBridge.openReferenceDefault).toHaveBeenCalledWith({
      projectId: "project-1",
      reference: "/tmp/report.txt",
    })
    expect(agentBridge.showReferenceInFolder).toHaveBeenCalledWith({
      projectId: "project-1",
      reference: "./src/app.ts:12",
    })
  })
})

function Driver({ projectId }: { readonly projectId: string }) {
  actions = useAgentReferenceActions(projectId)
  return null
}
