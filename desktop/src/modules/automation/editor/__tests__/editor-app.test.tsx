// @vitest-environment jsdom

import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { AutomationEditorApp } from "../editor-app"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const createItem = vi.fn()
const updateItem = vi.fn()
const getItem = vi.fn()
const listItems = vi.fn()
const listProviders = vi.fn()

vi.mock("@/lib/electron-bridge", () => ({
  requireBridgeDomain: () => ({
    getItem,
    listItems,
    createItem,
    updateItem,
  }),
  requireSynapseBridge: () => ({
    agent: {
      listProviders,
    },
  }),
}))

vi.mock("@/app-shell/config", () => ({
  useAppConfig: () => ({
    config: {
      global: {
        projects: [
          {
            id: "project-1",
            name: "Synapse",
            path: "/Users/liyang/Documents/code/github/Synapse",
          },
        ],
      },
    },
  }),
}))

describe("AutomationEditorApp", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn()
    listItems.mockResolvedValue([])
    listProviders.mockResolvedValue([
      {
        id: "provider-1",
        name: "Provider One",
        active: true,
        model: "model-default",
        sonnetModel: "model-sonnet",
      },
    ])
  })

  afterEach(() => {
    document.body.innerHTML = ""
    vi.clearAllMocks()
    vi.restoreAllMocks()
    window.history.replaceState(null, "", "/")
  })

  it("shows trigger and executor lists in create mode", async () => {
    window.history.replaceState(null, "", "/?window=automation-editor&mode=create")
    const rootElement = document.createElement("div")
    document.body.appendChild(rootElement)
    const root = createRoot(rootElement)

    await act(async () => {
      root.render(<AutomationEditorApp />)
    })

    expect(document.body.textContent).toContain("当以下情况发生时")
    expect(document.body.textContent).toContain("Cron")
    expect(document.body.textContent).toContain("固定间隔")
    expect(document.body.textContent).toContain("就执行以下操作")
    expect(document.body.textContent).toContain("命令")
    expect(document.body.textContent).toContain("Agent")
  })

  it("does not show default config summaries before trigger and executor are selected", async () => {
    window.history.replaceState(null, "", "/?window=automation-editor&mode=create")
    const rootElement = document.createElement("div")
    document.body.appendChild(rootElement)
    const root = createRoot(rootElement)

    await act(async () => {
      root.render(<AutomationEditorApp />)
    })

    expect(document.body.textContent).toContain("Cron")
    expect(document.body.textContent).toContain("HTTP 请求")
    expect(document.body.textContent).not.toContain("Cron · 0 9 * * *")
    expect(document.body.textContent).not.toContain("命令 · 未设置")
    expect(document.body.textContent).not.toContain("GET · 未设置 URL")

    await act(async () => {
      findButtonContaining("Cron")?.click()
    })
    await act(async () => {
      findButtonContaining("HTTP 请求")?.click()
    })

    expect(document.querySelector('[data-layout="automation-editor-trigger-summary"]')?.textContent)
      .toContain("Cron · 0 9 * * *")
    expect(document.querySelector('[data-layout="automation-editor-executor-summary"]')?.textContent)
      .toContain("GET · 未设置 URL")
  })

  it("shows a generated automation name in create mode instead of an empty title input", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0)
    window.history.replaceState(null, "", "/?window=automation-editor&mode=create")
    const rootElement = document.createElement("div")
    document.body.appendChild(rootElement)
    const root = createRoot(rootElement)

    await act(async () => {
      root.render(<AutomationEditorApp />)
    })

    expect(document.body.textContent).toContain("自动化 #0000")
    expect(document.body.textContent).not.toContain("新建")
    expect(document.querySelector('input[aria-label="自动化标题"]')).toBeNull()
  })

  it("generates a different create-mode name when the first random suffix already exists", async () => {
    listItems.mockResolvedValue([{ name: "自动化 #0000" }])
    vi.spyOn(Math, "random")
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(1 / 36)
      .mockReturnValueOnce(1 / 36)
      .mockReturnValueOnce(1 / 36)
      .mockReturnValueOnce(1 / 36)
      .mockReturnValueOnce(1 / 36)
      .mockReturnValueOnce(1 / 36)
      .mockReturnValueOnce(1 / 36)
    window.history.replaceState(null, "", "/?window=automation-editor&mode=create")
    const rootElement = document.createElement("div")
    document.body.appendChild(rootElement)
    const root = createRoot(rootElement)

    await act(async () => {
      root.render(<AutomationEditorApp />)
    })

    expect(document.body.textContent).toContain("自动化 #1111")
    expect(document.body.textContent).not.toContain("自动化 #0000")
  })

  it("renames the automation from the compact title dialog", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0)
    window.history.replaceState(null, "", "/?window=automation-editor&mode=create")
    const rootElement = document.createElement("div")
    document.body.appendChild(rootElement)
    const root = createRoot(rootElement)

    await act(async () => {
      root.render(<AutomationEditorApp />)
    })
    await act(async () => {
      Array.from(document.querySelectorAll("button")).find((button) =>
        button.textContent?.includes("自动化 #0000"))?.click()
    })

    expect(document.body.textContent).toContain("重命名自动化")

    const nameInput = document.querySelector<HTMLInputElement>("#automation-editor-rename-name")
    expect(nameInput).not.toBeNull()
    expect(nameInput?.selectionStart).toBe(0)
    expect(nameInput?.selectionEnd).toBe("自动化 #0000".length)

    await act(async () => {
      if (!nameInput) return
      changeInput(nameInput, "每日总结")
    })
    await act(async () => {
      Array.from(document.querySelectorAll("button")).find((button) => button.textContent === "确认")?.click()
    })

    expect(document.body.textContent).toContain("每日总结")
    expect(document.body.textContent).not.toContain("自动化 #0000")
  })

  it("keeps rename confirmation disabled for blank names", async () => {
    window.history.replaceState(null, "", "/?window=automation-editor&mode=create")
    const rootElement = document.createElement("div")
    document.body.appendChild(rootElement)
    const root = createRoot(rootElement)

    await act(async () => {
      root.render(<AutomationEditorApp />)
    })
    await act(async () => {
      Array.from(document.querySelectorAll("button")).find((button) =>
        button.textContent?.includes("自动化 #"))?.click()
    })

    const nameInput = document.querySelector<HTMLInputElement>("#automation-editor-rename-name")
    await act(async () => {
      if (!nameInput) return
      changeInput(nameInput, "   ")
    })

    expect(Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent === "确认")?.disabled).toBe(true)
  })

  it("switches selected trigger back to list with reselect", async () => {
    window.history.replaceState(null, "", "/?window=automation-editor&mode=create")
    const rootElement = document.createElement("div")
    document.body.appendChild(rootElement)
    const root = createRoot(rootElement)

    await act(async () => {
      root.render(<AutomationEditorApp />)
    })
    await act(async () => {
      Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.includes("Cron"))?.click()
    })

    expect(document.body.textContent).toContain("Cron 表达式")

    await act(async () => {
      Array.from(document.querySelectorAll("button")).find((button) => button.textContent === "重新选择")?.click()
    })

    expect(document.body.textContent).toContain("固定间隔")
  })

  it("uses the compact two-column workspace layout", async () => {
    window.history.replaceState(null, "", "/?window=automation-editor&mode=create")
    const rootElement = document.createElement("div")
    document.body.appendChild(rootElement)
    const root = createRoot(rootElement)

    await act(async () => {
      root.render(<AutomationEditorApp />)
    })

    expect(document.querySelector('[data-layout="automation-editor-builder"]')?.className)
      .toContain("grid-cols-[400px_1px_minmax(0,1fr)]")
    expect(document.querySelector('[data-layout="automation-editor-builder"]')?.className)
      .toContain("min-h-full")
    expect(document.querySelector('[data-layout="automation-editor-builder"]')?.className)
      .not.toContain("py-5")
    expect(document.querySelector('[data-layout="automation-editor-divider"]')).not.toBeNull()
  })

  it("keeps automation choice rows auto-height with compact padding", async () => {
    window.history.replaceState(null, "", "/?window=automation-editor&mode=create")
    const rootElement = document.createElement("div")
    document.body.appendChild(rootElement)
    const root = createRoot(rootElement)

    await act(async () => {
      root.render(<AutomationEditorApp />)
    })

    const cronChoice = findButtonContaining("Cron")

    expect(cronChoice?.className).not.toMatch(/\bmin-h-/)
    expect(cronChoice?.className).toContain("py-2")
  })

  it("constrains long executor content inside the editor viewport", async () => {
    window.history.replaceState(null, "", "/?window=automation-editor&mode=create")
    const rootElement = document.createElement("div")
    document.body.appendChild(rootElement)
    const root = createRoot(rootElement)

    await act(async () => {
      root.render(<AutomationEditorApp />)
    })
    await act(async () => {
      findButtonContaining("Cron")?.click()
    })
    await act(async () => {
      findButtonContaining("命令")?.click()
    })

    const body = document.querySelector('[data-layout="automation-editor-body"]')
    const executorPanel = document.querySelector('[data-layout="automation-editor-executor-panel"]')
    const executorConfig = document.querySelector('[data-layout="automation-editor-executor-config"]')

    expect(body?.className).toContain("overflow-x-hidden")
    expect(executorPanel?.className).toContain("overflow-hidden")
    expect(executorConfig?.className).toContain("[&_[data-slot=field-content]]:min-w-0")
  })

  it("separates selected summaries from configuration panels", async () => {
    window.history.replaceState(null, "", "/?window=automation-editor&mode=create")
    const rootElement = document.createElement("div")
    document.body.appendChild(rootElement)
    const root = createRoot(rootElement)

    await act(async () => {
      root.render(<AutomationEditorApp />)
    })
    await act(async () => {
      findButtonContaining("Cron")?.click()
    })
    await act(async () => {
      findButtonContaining("命令")?.click()
    })

    const triggerSummary = document.querySelector('[data-layout="automation-editor-trigger-summary"]')
    const triggerConfig = document.querySelector('[data-layout="automation-editor-trigger-config"]')
    const executorSummary = document.querySelector('[data-layout="automation-editor-executor-summary"]')
    const executorConfig = document.querySelector('[data-layout="automation-editor-executor-config"]')

    expect(triggerSummary?.textContent).toContain("Cron")
    expect(triggerSummary?.textContent).not.toContain("Cron 表达式")
    expect(executorSummary?.textContent).toContain("命令")
    expect(executorSummary?.textContent).not.toContain("Shell")
    expect(document.body.textContent).not.toContain("触发器")
    expect(document.body.textContent).not.toContain("执行器")
    expect(Array.from(document.querySelectorAll('[data-slot="badge"]')).map((badge) => badge.textContent))
      .not.toContain("配置")
    expect(document.querySelector('[data-layout="automation-editor-trigger-config-separator"]')).toBeNull()
    expect(document.querySelector('[data-layout="automation-editor-executor-config-separator"]')).toBeNull()
    expect(triggerSummary?.compareDocumentPosition(triggerConfig as Node) ?? 0)
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(executorSummary?.compareDocumentPosition(executorConfig as Node) ?? 0)
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  it("shows a discard confirmation when closing with unsaved changes", async () => {
    const closeSpy = vi.spyOn(window, "close").mockImplementation(() => undefined)
    window.history.replaceState(null, "", "/?window=automation-editor&mode=create")
    const rootElement = document.createElement("div")
    document.body.appendChild(rootElement)
    const root = createRoot(rootElement)

    await act(async () => {
      root.render(<AutomationEditorApp />)
    })
    await act(async () => {
      Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.includes("Cron"))?.click()
    })
    await act(async () => {
      window.dispatchEvent(new Event("beforeunload", { cancelable: true }))
    })

    expect(document.body.textContent).toContain("未保存的更改")

    await act(async () => {
      Array.from(document.querySelectorAll("button")).find((button) => button.textContent === "放弃")?.click()
    })

    expect(closeSpy).toHaveBeenCalledTimes(1)
  })

  it("keeps partial Agent executor config while editing", async () => {
    window.history.replaceState(null, "", "/?window=automation-editor&mode=create")
    const rootElement = document.createElement("div")
    document.body.appendChild(rootElement)
    const root = createRoot(rootElement)

    await act(async () => {
      root.render(<AutomationEditorApp />)
    })
    await act(async () => {
      findButtonContaining("Cron")?.click()
    })
    await act(async () => {
      findButtonContaining("Agent")?.click()
    })

    const prompt = document.querySelector<HTMLTextAreaElement>("#task-action-agent-prompt")
    expect(prompt).not.toBeNull()

    await act(async () => {
      if (!prompt) return
      changeTextarea(prompt, "Reply exactly OK")
    })

    expect(document.querySelector<HTMLTextAreaElement>("#task-action-agent-prompt")?.value)
      .toBe("Reply exactly OK")
  })

  it("saves Agent executor config with project and provider model selection", async () => {
    createItem.mockResolvedValue({
      id: "automation:agent",
      schemaVersion: 1,
      name: "Agent automation",
      enabled: true,
      scope: { type: "project", projectId: "project-1" },
      trigger: { type: "builtin.cron", config: { expr: "0 9 * * *", activeDays: [0, 1, 2, 3, 4, 5, 6] } },
      executor: {
        type: "builtin.agent",
        config: {
          projectId: "project-1",
          agentType: "claude-code",
          providerId: "provider-1",
          modelTier: "sonnet",
          mode: "bypassPermissions",
          prompt: "Reply exactly OK",
          sessionPolicy: "fresh",
          timeoutMins: 60,
        },
      },
      policy: { missedRunPolicy: "skip", overlapPolicy: "skip" },
      createdAt: "2026-06-03T00:00:00.000Z",
      updatedAt: "2026-06-03T00:00:00.000Z",
      runCount: 0,
      configVersion: 0,
    })
    vi.spyOn(window, "close").mockImplementation(() => undefined)
    window.history.replaceState(null, "", "/?window=automation-editor&mode=create")
    const rootElement = document.createElement("div")
    document.body.appendChild(rootElement)
    const root = createRoot(rootElement)

    await act(async () => {
      root.render(<AutomationEditorApp />)
    })
    await act(async () => {
      findButtonContaining("Cron")?.click()
    })
    await act(async () => {
      findButtonContaining("Agent")?.click()
    })
    await act(async () => {
      document.querySelector<HTMLElement>("[data-testid='automation-agent-project-select']")?.click()
    })
    await act(async () => {
      Array.from(document.querySelectorAll<HTMLElement>("[role='option']"))
        .find((option) => option.textContent?.includes("Synapse"))?.click()
    })
    await act(async () => {
      document.querySelector<HTMLButtonElement>("#task-action-agent-provider")?.click()
      await Promise.resolve()
    })
    await act(async () => {
      Array.from(document.querySelectorAll("button")).find((button) => button.textContent === "确认")?.click()
    })
    const prompt = document.querySelector<HTMLTextAreaElement>("#task-action-agent-prompt")
    await act(async () => {
      if (!prompt) return
      changeTextarea(prompt, "Reply exactly OK")
    })
    const timeout = document.querySelector<HTMLInputElement>("#task-action-agent-timeout")
    await act(async () => {
      if (!timeout) return
      changeInput(timeout, "5")
    })
    await act(async () => {
      Array.from(document.querySelectorAll("button")).find((button) => button.textContent === "保存并启用")?.click()
    })

    expect(createItem).toHaveBeenCalledWith(expect.objectContaining({
      enabled: true,
      scope: { type: "project", projectId: "project-1" },
      executor: {
        type: "builtin.agent",
        config: expect.objectContaining({
          projectId: "project-1",
          providerId: "provider-1",
          modelTier: "sonnet",
          prompt: "Reply exactly OK",
          timeoutMins: 5,
        }),
      },
    }))
  })

  it("shows readable Agent validation errors instead of raw Zod JSON", async () => {
    window.history.replaceState(null, "", "/?window=automation-editor&mode=create")
    const rootElement = document.createElement("div")
    document.body.appendChild(rootElement)
    const root = createRoot(rootElement)

    await act(async () => {
      root.render(<AutomationEditorApp />)
    })
    await act(async () => {
      findButtonContaining("Cron")?.click()
    })
    await act(async () => {
      findButtonContaining("Agent")?.click()
    })
    await act(async () => {
      Array.from(document.querySelectorAll("button")).find((button) => button.textContent === "保存并启用")?.click()
    })

    expect(document.body.textContent).toContain("请选择项目")
    expect(document.body.textContent).toContain("请选择供应商 + 模型")
    expect(document.body.textContent).toContain("请填写提示词")
    expect(document.body.textContent).not.toContain("\"origin\"")
    expect(document.body.textContent).not.toContain("\"code\"")
  })
})

function changeInput(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
  if (!setter) throw new Error("Input value setter not found")
  setter.call(input, value)
  input.dispatchEvent(new Event("input", { bubbles: true }))
}

function changeTextarea(textarea: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set
  if (!setter) throw new Error("Textarea value setter not found")
  setter.call(textarea, value)
  textarea.dispatchEvent(new Event("input", { bubbles: true }))
}

function findButtonContaining(text: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll("button"))
    .find((button) => button.textContent?.includes(text))
}
