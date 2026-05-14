/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

const { bridge, rendererLogger } = vi.hoisted(() => ({
  bridge: {
    agent: {
      listProviders: vi.fn(),
    },
  },
  rendererLogger: {
    warn: vi.fn(),
  },
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => rendererLogger,
}))

vi.mock("@/lib/electron-bridge", () => ({
  requireSynapseBridge: () => bridge,
}))

import { ProviderSelectDialog } from "../provider-select-dialog"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots = []
  document.body.innerHTML = ""
  vi.clearAllMocks()
})

describe("ProviderSelectDialog", () => {
  it("shows sanitized provider list failure copy while logging diagnostic context", async () => {
    const rawError = "secret provider backend failed for prompt content"
    bridge.agent.listProviders.mockRejectedValue(new Error(rawError))
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <ProviderSelectDialog
          open={true}
          projectId="project-1"
          projectName="Project One"
          onOpenChange={vi.fn()}
          onCreate={vi.fn()}
        />,
      )
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("读取 Provider 失败")
    expect(document.body.textContent).not.toContain(rawError)
    expect(rendererLogger.warn).toHaveBeenCalledWith("Agent provider list failed.", {
      boundary: "renderer.provider-select",
      projectId: "project-1",
      hasProjectName: true,
      errorName: "Error",
      errorLength: rawError.length,
    })
    expect(JSON.stringify(rendererLogger.warn.mock.calls)).not.toContain(rawError)
  })
})
