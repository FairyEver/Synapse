/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const bridge = vi.hoisted(() => ({
  list: vi.fn(async () => ({ status: "online" as const, items: [] as unknown[] })),
  create: vi.fn(async (input: {
    readonly name: string
    readonly description: string
    readonly systemPrompt: string
    readonly providerModel?: unknown
  }) => ({
    id: "persona-1",
    schemaVersion: 1,
    ...input,
    providerModel: input.providerModel ?? null,
    source: "user",
    readonly: false,
    createdAt: "2026-06-30T00:00:00.000Z",
    updatedAt: "2026-06-30T00:00:00.000Z",
  })),
  update: vi.fn(async () => undefined),
  updateBuiltinModel: vi.fn(async () => undefined),
  delete: vi.fn(async () => undefined),
  onChanged: vi.fn(() => vi.fn()),
}))

const toast = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}))

vi.mock("@/lib/electron-bridge", () => ({
  requireBridgeDomain: (domain: string) => {
    if (domain === "agentPersonas") return bridge
    throw new Error(`Unexpected bridge domain: ${domain}`)
  },
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}))

vi.mock("@/lib/provider-model", () => ({
  useProviderModelLabel: () => "",
}))

vi.mock("../../../../src/components/provider-model-select-dialog", () => ({
  ProviderModelSelectDialog: () => null,
}))

vi.mock("sonner", () => ({ toast }))

import { AgentPersonasModule } from "../index"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
;(globalThis as typeof globalThis & { ResizeObserver: typeof ResizeObserver }).ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

let roots: Root[] = []

beforeEach(() => {
  bridge.list.mockReset()
  bridge.list.mockResolvedValue({ status: "online", items: [] })
  bridge.create.mockClear()
  bridge.update.mockClear()
  bridge.updateBuiltinModel.mockClear()
  bridge.delete.mockClear()
  bridge.onChanged.mockClear()
  toast.error.mockClear()
  toast.success.mockClear()
})

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots = []
  document.body.innerHTML = ""
})

describe("AgentPersonasModule black-box behavior", () => {
  it("shows a recoverable load error and retries from the visible action", async () => {
    bridge.list
      .mockRejectedValueOnce(new Error("读取失败"))
      .mockResolvedValueOnce({
        status: "online",
        items: [
          {
            id: "builtin-zh-en-translator",
            schemaVersion: 1,
            name: "中英翻译",
            description: "在中文和英文之间互译，保留原意、语气和格式。",
            systemPrompt: "你是中英翻译智能体。",
            providerModel: null,
            source: "builtin",
            readonly: true,
          },
        ],
      })

    await renderModule()

    expect(document.body.textContent).toContain("加载失败")
    expect(document.body.textContent).toContain("读取失败")

    await clickButton("重试")

    expect(bridge.list).toHaveBeenCalledTimes(2)
    expect(document.body.textContent).toContain("中英翻译")
  })

  it("creates a persona from the empty state form", async () => {
    await renderModule()

    await clickButton("我的")
    expect(document.body.textContent).toContain("暂无智能体")

    await clickButton("新增")
    await setFieldValue("#agent-persona-name", "翻译助手")
    await setFieldValue("#agent-persona-description", "处理中英文本。")
    await setFieldValue("#agent-persona-system-prompt", "你是翻译助手。")
    await clickButton("保存智能体")

    expect(bridge.create).toHaveBeenCalledWith({
      name: "翻译助手",
      description: "处理中英文本。",
      systemPrompt: "你是翻译助手。",
      providerModel: null,
    })
    expect(toast.success).toHaveBeenCalledWith("已保存")
  })

  it("opens a built-in persona in model configuration mode", async () => {
    bridge.list.mockResolvedValue({
      status: "online",
      items: [
        {
          id: "builtin-zh-en-translator",
          schemaVersion: 1,
          name: "中英翻译",
          description: "在中文和英文之间互译，保留原意、语气和格式。",
          systemPrompt: "你是中英翻译智能体。",
          providerModel: null,
          source: "builtin",
          readonly: true,
        },
      ],
    })

    await renderModule()
    await clickButtonByLabel("配置模型：中英翻译")

    expect(document.body.textContent).toContain("配置模型")
    expect(document.body.textContent).toContain("中英翻译")
    expect(buttonWithText("保存模型")).toBeTruthy()
    expect(document.body.textContent).toContain("取消")

    const nameInput = document.body.querySelector<HTMLInputElement>("#agent-persona-name")
    const descriptionInput = document.body.querySelector<HTMLInputElement>("#agent-persona-description")
    const promptTextarea = document.body.querySelector<HTMLTextAreaElement>("#agent-persona-system-prompt")

    expect(nameInput?.readOnly).toBe(true)
    expect(nameInput?.disabled).toBe(false)
    expect(descriptionInput?.readOnly).toBe(true)
    expect(descriptionInput?.disabled).toBe(false)
    expect(promptTextarea?.readOnly).toBe(true)
    expect(promptTextarea?.disabled).toBe(false)
    expect(buttonWithText("未指定")).toBeTruthy()
  })
})

async function renderModule() {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => {
    root.render(<AgentPersonasModule />)
  })
  await act(async () => {
    await Promise.resolve()
  })
}

async function clickButton(text: string) {
  const button = buttonWithText(text)
  if (!button) throw new Error(`Button not found: ${text}`)
  await act(async () => {
    button.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }))
    button.click()
    await Promise.resolve()
  })
}

async function clickButtonByLabel(label: string) {
  const button = Array.from(document.body.querySelectorAll("button"))
    .find((item) => item.getAttribute("aria-label") === label)
  if (!button) throw new Error(`Button not found: ${label}`)
  await act(async () => {
    button.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }))
    button.click()
    await Promise.resolve()
  })
}

async function setFieldValue(selector: string, value: string) {
  const field = document.body.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)
  if (!field) throw new Error(`Field not found: ${selector}`)
  await act(async () => {
    const prototype = field instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype
    const valueSetter = Object.getOwnPropertyDescriptor(prototype, "value")?.set
    if (valueSetter) {
      valueSetter.call(field, value)
    } else {
      field.value = value
    }
    field.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

function buttonWithText(text: string): HTMLButtonElement | null {
  return Array.from(document.body.querySelectorAll("button"))
    .find((item) => item.textContent === text) ?? null
}
