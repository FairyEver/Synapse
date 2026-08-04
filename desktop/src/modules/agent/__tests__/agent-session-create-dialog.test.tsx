/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { SynapseAgentPersona } from "@/types/agent-persona"
import type { ProviderModelSelection } from "@/types/provider-model"
import { AgentSessionCreateDialog } from "../components/agent-session-create-dialog"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

;(globalThis as typeof globalThis & { ResizeObserver: typeof ResizeObserver }).ResizeObserver = class ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
} as typeof ResizeObserver

const DEFAULT_SELECTION: ProviderModelSelection = {
  providerId: "manual",
  providerName: "手动供应商",
  modelTier: "sonnet",
  modelName: "manual-sonnet",
}

const UNBOUND_PERSONA: SynapseAgentPersona = {
  id: "builtin-unbound",
  schemaVersion: 1,
  name: "未绑定智能体",
  description: "使用对话选择的模型。",
  systemPrompt: "使用对话模型。",
  providerModel: null,
  toolPolicy: { mode: "all" },
  source: "builtin",
  readonly: true,
}

const BOUND_PERSONA: SynapseAgentPersona = {
  ...UNBOUND_PERSONA,
  id: "user-bound",
  name: "绑定智能体",
  description: "固定使用绑定模型。",
  providerModel: { providerId: "bound", modelTier: "opus" },
  source: "user",
  readonly: false,
}

let roots: Root[] = []

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", {
    configurable: true,
    value: () => false,
  })
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  })
  Object.defineProperty(window, "synapse", {
    configurable: true,
    value: {
      agent: {
        listAllProviders: vi.fn(async () => providerCatalog()),
      },
    },
  })
})

afterEach(() => {
  for (const root of roots) {
    act(() => root.unmount())
  }
  roots = []
  document.body.innerHTML = ""
  delete (window as unknown as { synapse?: unknown }).synapse
  vi.clearAllMocks()
})

describe("AgentSessionCreateDialog", () => {
  it("focuses and selects the generated name when opened", async () => {
    await renderDialog({ onCreate: vi.fn(async () => true) })

    const input = document.querySelector<HTMLInputElement>('input[aria-label="会话名称"]')
    expect(document.activeElement).toBe(input)
    expect(input?.selectionStart).toBe(0)
    expect(input?.selectionEnd).toBe("新对话 09:00".length)
  })

  it("creates the conversation when Enter is pressed in the name input", async () => {
    const onCreate = vi.fn(async () => true)
    await renderDialog({ onCreate })
    const input = document.querySelector<HTMLInputElement>('input[aria-label="会话名称"]')

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
      setter?.call(input, "需求复盘")
      input?.dispatchEvent(new Event("input", { bubbles: true }))
      input?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }))
      await Promise.resolve()
    })

    expect(onCreate).toHaveBeenCalledWith({
      name: "需求复盘",
      personaId: null,
      selection: DEFAULT_SELECTION,
    })
  })

  it("uses a compact two-column layout for the name and persona fields", async () => {
    await renderDialog({ onCreate: vi.fn(async () => true) })

    const content = document.querySelector<HTMLElement>('[data-slot="dialog-content"]')
    const details = document.querySelector<HTMLElement>('[data-slot="field-group"] > .grid')
    expect(content?.className).toContain("sm:max-w-xl")
    expect(content?.className).toContain("max-h-[calc(100vh-3rem)]")
    expect(details?.className).toContain("sm:grid-cols-2")
  })

  it("uses ordinary mode by default and creates an unbound cached persona with the manual model", async () => {
    const onCreate = vi.fn(async () => true)
    await renderDialog({ onCreate })

    expect(document.body.textContent).toContain("普通")
    expect(document.body.textContent).toContain("手动供应商")
    expect(document.body.textContent).not.toContain("选择供应商 + 模型")

    await selectPersona("未绑定智能体")
    await clickCreate()

    expect(onCreate).toHaveBeenCalledWith({
      name: "新对话 09:00",
      personaId: "builtin-unbound",
      selection: DEFAULT_SELECTION,
    })
  })

  it("locks a bound persona model and restores the prior manual model after switching back", async () => {
    const onCreate = vi.fn(async () => true)
    await renderDialog({ onCreate })

    await selectModelTier("备用供应商", "haiku")
    expect(findTierButton("备用供应商", "haiku")?.getAttribute("aria-pressed")).toBe("true")

    await selectPersona("绑定智能体")
    expect(document.body.textContent).toContain("智能体绑定")
    expect(document.body.textContent).toContain("bound-opus")

    await selectPersona("普通")
    expect(findTierButton("备用供应商", "haiku")?.getAttribute("aria-pressed")).toBe("true")
    expect(window.synapse?.agent.listAllProviders).toHaveBeenCalledTimes(1)
  })

  it("marks an unavailable bound persona as disabled", async () => {
    Object.defineProperty(window, "synapse", {
      configurable: true,
      value: {
        agent: {
          listAllProviders: vi.fn(async () => providerCatalog().filter((provider) => provider.id !== "bound")),
        },
      },
    })
    await renderDialog({ onCreate: vi.fn(async () => true), personas: [BOUND_PERSONA] })

    await openPersonaSelect()
    const option = [...document.querySelectorAll<HTMLElement>("[role='option']")]
      .find((item) => item.textContent?.includes("绑定智能体"))

    expect(option?.textContent).toContain("不可用")
    expect(option?.getAttribute("aria-disabled")).toBe("true")
  })

  it("keeps long persona text inside the select option", async () => {
    await renderDialog({
      onCreate: vi.fn(async () => true),
      personas: [{
        ...UNBOUND_PERSONA,
        description: "在中文和英文之间互译，保留原意、语气和格式。",
      }],
    })

    await openPersonaSelect()
    const option = [...document.querySelectorAll<HTMLElement>("[role='option']")]
      .find((item) => item.textContent?.includes("未绑定智能体"))
    const text = option?.querySelector<HTMLElement>(".overflow-hidden")

    expect(option?.className).toContain("[&>span:last-child]:min-w-0")
    expect(text?.className).toContain("w-full")
    expect([...text?.children ?? []].every((item) => item.className.includes("w-full"))).toBe(true)
    expect([...text?.children ?? []].every((item) => item.className.includes("truncate"))).toBe(true)
  })

  it("keeps the dialog name and selection when creation fails", async () => {
    const onCreate = vi.fn(async () => false)
    await renderDialog({ onCreate })
    const input = document.querySelector<HTMLInputElement>('input[aria-label="会话名称"]')

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
      setter?.call(input, "保留的名称")
      input?.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await clickCreate()

    expect(document.body.textContent).toContain("新建对话")
    expect(input?.value).toBe("保留的名称")
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
      name: "保留的名称",
      personaId: null,
    }))
  })
})

async function renderDialog(input: {
  readonly onCreate: (value: {
    readonly name: string
    readonly personaId: string | null
    readonly selection: ProviderModelSelection
  }) => Promise<boolean>
  readonly personas?: readonly SynapseAgentPersona[]
}): Promise<void> {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => {
    root.render(
      <AgentSessionCreateDialog
        open
        initialName="新对话 09:00"
        personas={input.personas ?? [UNBOUND_PERSONA, BOUND_PERSONA]}
        defaultSelection={DEFAULT_SELECTION}
        onOpenChange={vi.fn()}
        onCreate={input.onCreate}
      />,
    )
    await Promise.resolve()
  })
}

async function selectPersona(label: string): Promise<void> {
  await openPersonaSelect()
  await act(async () => {
    const option = [...document.querySelectorAll<HTMLElement>("[role='option']")]
      .find((item) => item.textContent?.startsWith(label))
    expect(option).toBeDefined()
    option?.click()
    await Promise.resolve()
  })
}

async function openPersonaSelect(): Promise<void> {
  await act(async () => {
    const trigger = document.querySelector<HTMLButtonElement>("#agent-session-persona")
    expect(trigger).toBeDefined()
    trigger?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }))
    trigger?.click()
    trigger?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }))
    await Promise.resolve()
  })
}

async function clickCreate(): Promise<void> {
  await act(async () => {
    findButton("创建对话")?.click()
    await Promise.resolve()
  })
}

function findButton(content: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.includes(content))
}

async function selectModelTier(providerName: string, tier: string): Promise<void> {
  await act(async () => {
    const button = findTierButton(providerName, tier)
    expect(button).toBeDefined()
    button?.click()
    await Promise.resolve()
  })
}

function findTierButton(providerName: string, tier: string): HTMLButtonElement | undefined {
  const row = [...document.querySelectorAll<HTMLTableRowElement>("tbody tr")]
    .find((item) => item.textContent?.includes(providerName))
  return row?.querySelector<HTMLButtonElement>(`button[data-tier="${tier}"]`) ?? undefined
}

function providerCatalog() {
  return [
    {
      id: "manual",
      name: "手动供应商",
      category: "official",
      active: true,
      archived: false,
      model: "manual-default",
      sonnetModel: "manual-sonnet",
    },
    {
      id: "alternate",
      name: "备用供应商",
      category: "official",
      active: false,
      archived: false,
      model: "alternate-default",
      haikuModel: "alternate-haiku",
    },
    {
      id: "bound",
      name: "绑定供应商",
      category: "official",
      active: false,
      archived: false,
      model: "bound-default",
      opusModel: "bound-opus",
    },
  ]
}
