/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

type ModelInput = {
  readonly providerId: string
  readonly modelTier: "default" | "haiku" | "sonnet" | "opus"
}

type PersonaInput = {
  readonly name: string
  readonly description: string
  readonly systemPrompt: string
  readonly providerModel?: ModelInput | null
  readonly toolPolicy?: {
    readonly mode: "all" | "allowlist" | "disabled"
    readonly allowedTools?: readonly string[]
  }
}

const fixtures = vi.hoisted(() => ({
  items: [
    {
      id: "builtin-zh-en-translator",
      schemaVersion: 1,
      name: "中英翻译",
      description: "在中文和英文之间互译，保留原意、语气和格式。",
      systemPrompt: "你是中英翻译智能体。",
      providerModel: null,
      toolPolicy: { mode: "disabled" },
      source: "builtin",
      readonly: true,
    },
    {
      id: "persona-1",
      schemaVersion: 1,
      name: "产品顾问",
      description: "整理产品判断。",
      systemPrompt: "你是产品顾问。",
      providerModel: null,
      toolPolicy: { mode: "all" },
      source: "user",
      readonly: false,
      createdAt: "2026-06-30T00:00:00.000Z",
      updatedAt: "2026-06-30T00:00:00.000Z",
    },
  ],
}))

const bridge = vi.hoisted(() => ({
  list: vi.fn(async () => ({ status: "online" as const, items: fixtures.items })),
  create: vi.fn(async (input: PersonaInput) => ({
    id: "persona-2",
    schemaVersion: 1,
    ...input,
    providerModel: input.providerModel ?? null,
    toolPolicy: input.toolPolicy ?? { mode: "all" },
    source: "user",
    readonly: false,
    createdAt: "2026-06-30T00:00:00.000Z",
    updatedAt: "2026-06-30T00:00:00.000Z",
  })),
  update: vi.fn(async (input: PersonaInput & { id: string }) => ({
    schemaVersion: 1,
    ...input,
    providerModel: input.providerModel ?? null,
    toolPolicy: input.toolPolicy ?? { mode: "all" },
    source: "user",
    readonly: false,
    createdAt: "2026-06-30T00:00:00.000Z",
    updatedAt: "2026-06-30T00:00:00.000Z",
  })),
  updateBuiltinModel: vi.fn(async (input: { readonly id: string; readonly providerModel: ModelInput | null }) => ({
    ...fixtures.items[0],
    providerModel: input.providerModel,
  })),
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
  ProviderModelSelectDialog: ({
    onOpenChange,
    onSelect,
    open,
  }: {
    readonly open: boolean
    readonly onOpenChange: (open: boolean) => void
    readonly onSelect: (selection: {
      readonly providerId: string
      readonly modelTier: "sonnet"
      readonly providerName: string
      readonly modelName: string
    }) => void
  }) => open ? (
    <button
      type="button"
      onClick={() => {
        onSelect({
          providerId: "claude",
          modelTier: "sonnet",
          providerName: "Claude",
          modelName: "Claude Sonnet",
        })
        onOpenChange(false)
      }}
    >
      选择 Sonnet 模型
    </button>
  ) : null,
}))

vi.mock("sonner", () => ({ toast }))

import { AgentPersonasModule } from "../index"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
;(globalThis as typeof globalThis & { ResizeObserver: typeof ResizeObserver }).ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
HTMLElement.prototype.scrollIntoView = vi.fn()

let roots: Root[] = []

beforeEach(() => {
  bridge.list.mockReset()
  bridge.list.mockResolvedValue({ status: "online", items: fixtures.items })
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

describe("AgentPersonasModule", () => {
  it("shows built-in and user personas in top tabs", async () => {
    await renderModule()

    expect(bridge.list).toHaveBeenCalled()
    expect(document.querySelector("[data-system-app-window-tabs]")?.textContent).toContain("系统内置")
    expect(document.querySelector("[data-system-app-window-tabs]")?.textContent).toContain("我的")
    expect(document.body.textContent).toContain("中英翻译")
    expect(document.body.textContent).not.toContain("产品顾问")
    expect(buttonWithText("新增")).toBeNull()

    await clickButton("我的")

    expect(document.body.textContent).toContain("产品顾问")
    expect(document.body.textContent).not.toContain("中英翻译")
    expect(buttonWithText("新增")).toBeTruthy()
  })

  it("shows login action when personas require authentication", async () => {
    bridge.list.mockResolvedValueOnce({ status: "unauthenticated", items: [] })

    await renderModule()

    expect(document.body.textContent).toContain("登录后使用智能体")
    expect(buttonWithText("登录")).toBeTruthy()
    expect(buttonWithText("新增")).toBeNull()
  })

  it("disables writes when rendering offline cache", async () => {
    bridge.list.mockResolvedValueOnce({
      status: "offline-cache",
      syncedAt: "2026-07-01T00:00:00.000Z",
      items: fixtures.items,
    })

    await renderModule()

    expect(document.body.textContent).toContain("离线")
    await clickButton("我的")
    expect(buttonWithText("新增")?.hasAttribute("disabled")).toBe(true)
    expect(buttonByLabel("编辑智能体：产品顾问")?.hasAttribute("disabled")).toBe(true)
    expect(buttonByLabel("删除智能体：产品顾问")?.hasAttribute("disabled")).toBe(true)
  })

  it("shows reconnect state when offline cache is empty", async () => {
    bridge.list.mockResolvedValueOnce({ status: "offline-empty", items: [] })

    await renderModule()

    expect(document.body.textContent).toContain("重新连接后加载")
    expect(buttonWithText("新增")).toBeNull()
  })

  it("shows only model configuration for built-in personas", async () => {
    await renderModule()

    expect(buttonByLabel("查看智能体：中英翻译")).toBeFalsy()
    expect(buttonByLabel("配置模型：中英翻译")).toBeTruthy()
    expect(buttonByLabel("编辑智能体：中英翻译")).toBeFalsy()
    expect(buttonByLabel("删除智能体：中英翻译")).toBeFalsy()
  })

  it("keeps persona table columns and action controls aligned", async () => {
    await renderModule()

    const table = document.body.querySelector("table")
    expect(table).toBeTruthy()
    expect(Array.from(table?.querySelectorAll("col") ?? []).map((col) => col.getAttribute("data-column"))).toEqual([
      "name",
      "description",
      "model",
      "tools",
      "actions",
    ])
    expect(cellWithText("操作")?.className).toContain("text-center")
    expect(buttonByLabel("配置模型：中英翻译")?.closest("td")?.className).toContain("text-center")
    expect(buttonByLabel("配置模型：中英翻译")?.parentElement?.className).toContain("justify-center")
  })

  it("validates required fields before creating a user persona", async () => {
    await renderModule()

    await clickButton("我的")
    await clickButton("新增")
    await clickButton("保存智能体")

    expect(document.body.textContent).toContain("名称不能为空")
    expect(bridge.create).not.toHaveBeenCalled()
  })

  it("keeps short persona fields in responsive two-column groups", async () => {
    await renderModule()

    await clickButton("我的")
    await clickButton("新增")

    const basicGrid = document.body.querySelector<HTMLElement>("[data-agent-persona-basic-grid]")
    const optionsGrid = document.body.querySelector<HTMLElement>("[data-agent-persona-options-grid]")

    expect(basicGrid?.className).toContain("md:grid-cols-2")
    expect(optionsGrid?.className).toContain("md:grid-cols-2")
    expect(basicGrid?.querySelector("#agent-persona-name")).toBeTruthy()
    expect(basicGrid?.querySelector("#agent-persona-description")).toBeTruthy()
    expect(optionsGrid?.querySelector("#agent-persona-tool-policy-mode")).toBeTruthy()

    await setSelectValue("#agent-persona-tool-policy-mode", "allowlist")

    const allowlistField = document.body.querySelector<HTMLElement>("[data-agent-persona-tool-allowlist-field]")

    expect(allowlistField?.className).toContain("md:col-span-2")
    expect(allowlistField?.querySelector("#agent-persona-tool-allowlist")).toBeTruthy()
  })

  it("creates a user persona with a selected model", async () => {
    await renderModule()

    await clickButton("我的")
    await clickButton("新增")
    await setFieldValue("#agent-persona-name", "翻译助手")
    await setFieldValue("#agent-persona-description", "处理中英文本。")
    await setFieldValue("#agent-persona-system-prompt", "你是翻译助手。")
    await clickButton("未指定")
    await clickButton("选择 Sonnet 模型")
    await setSelectValue("#agent-persona-tool-policy-mode", "allowlist")
    await clickButton("选择工具")
    await clickToolOption("Read")
    await clickToolOption("Bash")
    await clickButton("保存智能体")

    expect(bridge.create).toHaveBeenCalledWith({
      name: "翻译助手",
      description: "处理中英文本。",
      systemPrompt: "你是翻译助手。",
      providerModel: { providerId: "claude", modelTier: "sonnet" },
      toolPolicy: {
        mode: "allowlist",
        allowedTools: ["Read", "Bash"],
      },
    })
    expect(toast.success).toHaveBeenCalledWith("已保存")
  })

  it("edits selected and legacy custom allowlist tools without text entry", async () => {
    const original = fixtures.items[1]
    fixtures.items[1] = {
      ...original,
      toolPolicy: { mode: "allowlist", allowedTools: ["Read", "mcp__synapse-mcp__database_query"] },
    }

    try {
      await renderModule()

      await clickButton("我的")
      await clickButtonByLabel("编辑智能体：产品顾问")

      expect(document.body.textContent).toContain("Read")
      expect(document.body.textContent).toContain("mcp__synapse-mcp__database_query")

      await clickButton("2 个工具")
      await clickToolOption("Bash")
      await clickRemoveSelectedTool("mcp__synapse-mcp__database_query")
      await clickButton("保存智能体")

      expect(bridge.update).toHaveBeenCalledWith(expect.objectContaining({
        id: "persona-1",
        toolPolicy: { mode: "allowlist", allowedTools: ["Read", "Bash"] },
      }))
    } finally {
      fixtures.items[1] = original
    }
  })

  it("updates a user persona", async () => {
    await renderModule()

    await clickButton("我的")
    await clickButtonByLabel("编辑智能体：产品顾问")
    await setFieldValue("#agent-persona-name", "产品教练")
    await setFieldValue("#agent-persona-description", "整理产品策略。")
    await setFieldValue("#agent-persona-system-prompt", "你是产品教练。")
    await clickButton("保存智能体")

    expect(bridge.update).toHaveBeenCalledWith({
      id: "persona-1",
      name: "产品教练",
      description: "整理产品策略。",
      systemPrompt: "你是产品教练。",
      providerModel: null,
      toolPolicy: { mode: "all" },
    })
  })

  it("deletes a user persona after confirmation", async () => {
    await renderModule()

    await clickButton("我的")
    await clickButtonByLabel("删除智能体：产品顾问")
    expect(document.body.textContent).toContain("删除“产品顾问”后不可恢复。")
    await clickButton("删除")

    expect(bridge.delete).toHaveBeenCalledWith({ id: "persona-1" })
  })

  it("updates the model for a built-in persona without unlocking its text fields", async () => {
    await renderModule()

    await clickButtonByLabel("配置模型：中英翻译")

    expect(document.body.textContent).toContain("配置模型")
    expect(document.body.querySelector<HTMLInputElement>("#agent-persona-name")?.readOnly).toBe(true)
    expect(document.body.querySelector<HTMLInputElement>("#agent-persona-description")?.readOnly).toBe(true)
    expect(document.body.querySelector<HTMLTextAreaElement>("#agent-persona-system-prompt")?.readOnly).toBe(true)
    expect(document.body.querySelector<HTMLInputElement>("#agent-persona-tool-policy-readonly")?.value).toBe("禁用全部工具")

    await clickButton("未指定")
    await clickButton("选择 Sonnet 模型")
    await clickButton("保存模型")

    expect(bridge.updateBuiltinModel).toHaveBeenCalledWith({
      id: "builtin-zh-en-translator",
      providerModel: { providerId: "claude", modelTier: "sonnet" },
      toolPolicy: { mode: "disabled" },
    })
    expect(bridge.update).not.toHaveBeenCalled()
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
  const button = Array.from(document.body.querySelectorAll("button"))
    .find((item) => item.textContent === text)
  if (!button) throw new Error(`Button not found: ${text}`)
  await act(async () => {
    button.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }))
    button.click()
    await Promise.resolve()
  })
}

async function clickButtonByLabel(label: string) {
  const button = buttonByLabel(label)
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

async function setSelectValue(selector: string, value: string) {
  const field = document.body.querySelector<HTMLSelectElement>(selector)
  if (!field) throw new Error(`Select not found: ${selector}`)
  await act(async () => {
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set
    if (valueSetter) {
      valueSetter.call(field, value)
    } else {
      field.value = value
    }
    field.dispatchEvent(new Event("change", { bubbles: true }))
  })
}

function buttonByLabel(label: string): HTMLButtonElement | null {
  return Array.from(document.body.querySelectorAll("button"))
    .find((button) => button.getAttribute("aria-label") === label) ?? null
}

function buttonWithText(text: string): HTMLButtonElement | null {
  return Array.from(document.body.querySelectorAll("button"))
    .find((item) => item.textContent === text) ?? null
}

async function clickToolOption(text: string) {
  const option = Array.from(document.body.querySelectorAll<HTMLElement>("[cmdk-item], [role='option']"))
    .find((item) => item.textContent?.includes(text))
  if (!option) throw new Error(`Tool option not found: ${text}`)
  await act(async () => {
    option.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }))
    option.click()
    await Promise.resolve()
  })
}

async function clickRemoveSelectedTool(tool: string) {
  await clickButtonByLabel(`移除工具：${tool}`)
}

function cellWithText(text: string): HTMLTableCellElement | null {
  return Array.from(document.body.querySelectorAll<HTMLTableCellElement>("th,td"))
    .find((item) => item.textContent === text) ?? null
}
