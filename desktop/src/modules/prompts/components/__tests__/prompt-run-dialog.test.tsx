/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import { PromptRunDialog } from "../prompt-run-dialog"
import type { SynapseContentMeta } from "@/types/content"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const runMock = vi.hoisted(() => vi.fn())
const appConfig = vi.hoisted(() => ({
  projects: [{ id: "project-1", name: "Project One", path: "/repo" }],
}))
const rendererLogger = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
}))

vi.mock("@/app-shell/config", () => ({
  useAppConfig: () => ({
    config: {
      global: {
        projects: appConfig.projects,
      },
    },
  }),
}))

vi.mock("@/modules/prompts/hooks/use-prompt-run", () => ({
  usePromptRun: () => ({
    run: runMock,
    isRunning: false,
  }),
}))

vi.mock("@/modules/content/components/content-item-icon", () => ({
  ContentItemIcon: () => <span data-testid="content-item-icon" />,
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => rendererLogger,
}))

let roots: Root[] = []

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots = []
  document.body.innerHTML = ""
  appConfig.projects = [{ id: "project-1", name: "Project One", path: "/repo" }]
  rendererLogger.error.mockReset()
  rendererLogger.info.mockReset()
  runMock.mockReset()
  vi.restoreAllMocks()
})

describe("PromptRunDialog", () => {
  it("passes the selected provider when sending and navigating", async () => {
    const listProviders = vi.fn().mockResolvedValue([
      {
        id: "provider-1",
        name: "Provider One",
        model: "claude-test",
        active: true,
        archived: false,
      },
    ])
    Object.defineProperty(window, "synapse", {
      configurable: true,
      value: {
        agent: {
          listProviders,
        },
      },
    })
    runMock.mockResolvedValue(true)
    const onOpenChange = vi.fn()

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <PromptRunDialog
          open={true}
          onOpenChange={onOpenChange}
          item={promptItem}
        />,
      )
    })

    await act(async () => {
      await Promise.resolve()
    })

    const sendAndNavigateButton = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("发送并跳转"))
    expect(sendAndNavigateButton).toBeDefined()

    await act(async () => {
      sendAndNavigateButton?.click()
    })

    expect(listProviders).toHaveBeenCalledTimes(1)
    expect(runMock).toHaveBeenCalledWith({
      item: promptItem,
      projectId: "project-1",
      agentType: "claude-code",
      providerId: "provider-1",
      navigate: true,
    })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("disables sending after the selected project disappears", async () => {
    const listProviders = vi.fn().mockResolvedValue([
      {
        id: "provider-1",
        name: "Provider One",
        model: "claude-test",
        active: true,
        archived: false,
      },
    ])
    Object.defineProperty(window, "synapse", {
      configurable: true,
      value: {
        agent: {
          listProviders,
        },
      },
    })

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <PromptRunDialog
          open={true}
          onOpenChange={vi.fn()}
          item={promptItem}
        />,
      )
    })
    await act(async () => {
      await Promise.resolve()
    })

    appConfig.projects = []
    await act(async () => {
      root.render(
        <PromptRunDialog
          open={true}
          onOpenChange={vi.fn()}
          item={promptItem}
        />,
      )
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("请先在设置中添加项目")
    const sendAndNavigateButton = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("发送并跳转"))
    expect(sendAndNavigateButton?.disabled).toBe(true)

    await act(async () => {
      sendAndNavigateButton?.click()
    })

    expect(runMock).not.toHaveBeenCalled()
  })

  it("logs provider load failures with sanitized renderer boundary context", async () => {
    const listProviders = vi.fn().mockRejectedValue(
      new Error("Authorization: Bearer sk-test failed while loading providers"),
    )
    Object.defineProperty(window, "synapse", {
      configurable: true,
      value: {
        agent: {
          listProviders,
        },
      },
    })

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <PromptRunDialog
          open={true}
          onOpenChange={vi.fn()}
          item={promptItem}
        />,
      )
    })

    await act(async () => {
      await Promise.resolve()
    })

    expect(rendererLogger.error).toHaveBeenCalledWith(
      "Prompt run: load providers failed.",
      {
        boundary: "renderer.prompt-run.load-providers",
        errorLength: 60,
        errorName: "Error",
        errorMessage: "Authorization=[redacted] [redacted] failed while loading providers",
      },
    )
    expect(JSON.stringify(rendererLogger.error.mock.calls)).not.toContain("sk-test")
    expect(JSON.stringify(rendererLogger.error.mock.calls)).not.toContain("Bearer")
  })

  it("shows a fixed provider load failure message without raw error text", async () => {
    const listProviders = vi.fn().mockRejectedValue(
      new Error("failed to read /Users/example/.synapse/providers.json token=sk-test"),
    )
    Object.defineProperty(window, "synapse", {
      configurable: true,
      value: {
        agent: {
          listProviders,
        },
      },
    })

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <PromptRunDialog
          open={true}
          onOpenChange={vi.fn()}
          item={promptItem}
        />,
      )
    })

    await act(async () => {
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("读取 Provider 失败")
    expect(document.body.textContent).not.toContain("/Users/example")
    expect(document.body.textContent).not.toContain("sk-test")
  })
})

const promptItem: SynapseContentMeta<"prompt"> = {
  attachmentCount: 0,
  category: "general",
  createdAt: "2026-05-13T00:00:00.000Z",
  createdBy: "user-1",
  createdByDisplayName: "User",
  deleted: false,
  description: "Prompt description",
  icon: "file",
  iconBg: "muted",
  id: "prompt-1",
  latestHistoryDirname: "20260513000000",
  modifiedAt: "2026-05-13T00:00:00.000Z",
  modifiedBy: "user-1",
  modifiedByDisplayName: "User",
  title: "Prompt One",
  type: "prompt",
}
