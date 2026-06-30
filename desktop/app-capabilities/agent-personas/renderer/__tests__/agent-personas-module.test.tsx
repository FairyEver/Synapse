/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const fixtures = vi.hoisted(() => ({
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
    {
      id: "persona-1",
      schemaVersion: 1,
      name: "产品顾问",
      description: "整理产品判断。",
      systemPrompt: "你是产品顾问。",
      providerModel: null,
      source: "user",
      readonly: false,
      createdAt: "2026-06-30T00:00:00.000Z",
      updatedAt: "2026-06-30T00:00:00.000Z",
    },
  ],
}))

const bridge = vi.hoisted(() => ({
  list: vi.fn(async () => fixtures.items),
  create: vi.fn(async (input: { name: string; description: string; systemPrompt: string }) => ({
    id: "persona-2",
    schemaVersion: 1,
    ...input,
    providerModel: null,
    source: "user",
    readonly: false,
    createdAt: "2026-06-30T00:00:00.000Z",
    updatedAt: "2026-06-30T00:00:00.000Z",
  })),
  update: vi.fn(async (input: { id: string; name: string; description: string; systemPrompt: string }) => ({
    schemaVersion: 1,
    ...input,
    providerModel: null,
    source: "user",
    readonly: false,
    createdAt: "2026-06-30T00:00:00.000Z",
    updatedAt: "2026-06-30T00:00:00.000Z",
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
  bridge.list.mockClear()
  bridge.create.mockClear()
  bridge.update.mockClear()
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
  it("loads built-in and user personas", async () => {
    await renderModule()

    expect(bridge.list).toHaveBeenCalled()
    expect(document.body.textContent).toContain("系统内置")
    expect(document.body.textContent).toContain("中英翻译")
    expect(document.body.textContent).toContain("我创建的")
    expect(document.body.textContent).toContain("产品顾问")
  })

  it("does not show edit or delete actions for built-in personas", async () => {
    await renderModule()

    expect(buttonByLabel("查看智能体：中英翻译")).toBeTruthy()
    expect(buttonByLabel("编辑智能体：中英翻译")).toBeFalsy()
    expect(buttonByLabel("删除智能体：中英翻译")).toBeFalsy()
  })

  it("validates required fields before creating a user persona", async () => {
    await renderModule()

    await clickButton("新增")
    await clickButton("保存智能体")

    expect(document.body.textContent).toContain("名称不能为空")
    expect(bridge.create).not.toHaveBeenCalled()
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
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }))
  })
}

function buttonByLabel(label: string): HTMLButtonElement | null {
  return Array.from(document.body.querySelectorAll("button"))
    .find((button) => button.getAttribute("aria-label") === label) ?? null
}
