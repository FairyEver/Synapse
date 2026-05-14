/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

const { bridge, rendererLogger, track } = vi.hoisted(() => ({
  bridge: {
    agent: {
      listProviders: vi.fn(),
    },
  },
  rendererLogger: {
    warn: vi.fn(),
  },
  track: vi.fn(),
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => rendererLogger,
}))

vi.mock("@/lib/electron-bridge", () => ({
  requireSynapseBridge: () => bridge,
}))

vi.mock("@/lib/ui-tracking", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ui-tracking")>()
  return {
    ...actual,
    track,
  }
})

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
  it("tracks auto-created sessions with sanitized provider metadata", async () => {
    bridge.agent.listProviders.mockResolvedValue([
      provider({ id: "anthropic", name: "Claude Official", active: true }),
    ])
    const onCreate = vi.fn()
    const onOpenChange = vi.fn()
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
          onOpenChange={onOpenChange}
          onCreate={onCreate}
        />,
      )
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(onCreate).toHaveBeenCalledWith("project-1", "anthropic")
    expect(track).toHaveBeenCalledWith({
      component: "agent",
      name: "agent-provider-create",
      action: "submit",
      metadata: {
        boundary: "renderer.agent.provider-select",
        projectId: "project-1",
        providerId: "anthropic",
        providerCount: 1,
        source: "auto",
      },
    })
    expect(JSON.stringify(track.mock.calls)).not.toContain("Claude Official")
  })

  it("tracks manual provider session creation with sanitized provider metadata", async () => {
    bridge.agent.listProviders.mockResolvedValue([
      provider({ id: "anthropic", name: "Claude Official", active: true }),
      provider({ id: "bedrock", name: "Bedrock Claude" }),
    ])
    const onCreate = vi.fn()
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
          onCreate={onCreate}
        />,
      )
      await Promise.resolve()
    })

    const createButton = [...document.querySelectorAll("button")]
      .find((button) => button.textContent === "创建")
    expect(createButton).toBeTruthy()

    await act(async () => {
      createButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(onCreate).toHaveBeenCalledWith("project-1", "anthropic")
    expect(track).toHaveBeenCalledWith({
      component: "agent",
      name: "agent-provider-create",
      action: "submit",
      metadata: {
        boundary: "renderer.agent.provider-select",
        projectId: "project-1",
        providerId: "anthropic",
        providerCount: 2,
        source: "manual",
      },
    })
    expect(JSON.stringify(track.mock.calls)).not.toContain("Claude Official")
    expect(JSON.stringify(track.mock.calls)).not.toContain("Bedrock Claude")
  })

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

function provider(input: {
  readonly id: string
  readonly name: string
  readonly active?: boolean
}) {
  return {
    id: input.id,
    name: input.name,
    category: "anthropic" as const,
    apiKeyField: "ANTHROPIC_AUTH_TOKEN" as const,
    active: input.active,
    createdAt: "2026-05-15T00:00:00.000Z",
    updatedAt: "2026-05-15T00:00:00.000Z",
  }
}
