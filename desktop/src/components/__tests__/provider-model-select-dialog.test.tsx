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
    info: vi.fn(),
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

import { ProviderModelSelectDialog } from "../provider-model-select-dialog"

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

function provider(input: {
  readonly id: string
  readonly name: string
  readonly source?: "local" | "user"
  readonly active?: boolean
  readonly model?: string
  readonly haikuModel?: string
  readonly sonnetModel?: string
  readonly opusModel?: string
  readonly archived?: boolean
}) {
  return {
    id: input.id,
    name: input.name,
    category: "anthropic" as const,
    source: input.source,
    apiKeyField: "ANTHROPIC_AUTH_TOKEN" as const,
    active: input.active,
    model: input.model,
    haikuModel: input.haikuModel,
    sonnetModel: input.sonnetModel,
    opusModel: input.opusModel,
    archived: input.archived,
    createdAt: "2026-05-15T00:00:00.000Z",
    updatedAt: "2026-05-15T00:00:00.000Z",
  }
}

function renderDialog(props: Partial<React.ComponentProps<typeof ProviderModelSelectDialog>> = {}) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    onSelect: vi.fn(),
    ...props,
  }
  return { root, ...defaultProps }
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
  if (!setter) throw new Error("Input value setter not found")
  setter.call(input, value)
}

describe("ProviderModelSelectDialog", () => {
  it("renders provider rows with tier model names", async () => {
    bridge.agent.listProviders.mockResolvedValue([
      provider({
        id: "anthropic",
        name: "Claude Official",
        active: true,
        model: "claude-sonnet-4-20250514",
        haikuModel: "claude-haiku-3-5",
        sonnetModel: "claude-sonnet-4-20250514",
        opusModel: "claude-opus-4",
      }),
    ])
    const { root, ...props } = renderDialog()

    await act(async () => {
      root.render(<ProviderModelSelectDialog {...props} />)
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("Claude Official")
    expect(document.body.textContent).toContain("claude-sonnet-4-20250514")
    expect(document.body.textContent).toContain("claude-haiku-3-5")
    expect(document.body.textContent).toContain("claude-opus-4")
    expect(document.querySelector('[data-slot="dialog-content"]')?.className)
      .toContain("sm:max-w-xl")
    expect([...document.querySelectorAll("[data-tier]")]
      .map((el) => el.getAttribute("data-tier"))).toEqual(["default", "opus", "sonnet", "haiku"])
  })

  it("does not render empty tiers", async () => {
    bridge.agent.listProviders.mockResolvedValue([
      provider({
        id: "anthropic",
        name: "Claude Official",
        active: true,
        model: "claude-sonnet-4-20250514",
        sonnetModel: "claude-sonnet-4-20250514",
      }),
    ])
    const { root, ...props } = renderDialog()

    await act(async () => {
      root.render(<ProviderModelSelectDialog {...props} />)
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("#3")
    expect(document.body.textContent).not.toContain("#2")
    expect(document.body.textContent).not.toContain("#4")
    expect(document.body.textContent).not.toContain("Sonnet")
  })

  it("allows local Claude Code default tier without explicit models", async () => {
    bridge.agent.listProviders.mockResolvedValue([
      provider({
        id: "local-claude-code",
        name: "ClaudeCode/Synapse",
        source: "local",
        active: true,
      }),
    ])
    const { root, ...props } = renderDialog()

    await act(async () => {
      root.render(<ProviderModelSelectDialog {...props} />)
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("ClaudeCode/Synapse")
    expect(document.body.textContent).toContain("Claude Code 默认")
    expect([...document.querySelectorAll("[data-tier]")]
      .map((el) => el.getAttribute("data-tier"))).toEqual(["default"])

    const confirmButton = [...document.querySelectorAll("button")]
      .find((button) => button.textContent === "确认")
    expect(confirmButton?.disabled).toBe(false)

    await act(async () => {
      confirmButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(props.onSelect).toHaveBeenCalledWith({
      providerId: "local-claude-code",
      modelTier: "default",
      providerName: "ClaudeCode/Synapse",
      modelName: undefined,
    })
  })

  it("does not allow non-local providers without model fields", async () => {
    bridge.agent.listProviders.mockResolvedValue([
      provider({
        id: "empty-provider",
        name: "Empty Provider",
        source: "user",
        active: true,
      }),
    ])
    const { root, ...props } = renderDialog()

    await act(async () => {
      root.render(<ProviderModelSelectDialog {...props} />)
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("Empty Provider")
    expect(document.querySelectorAll("[data-tier]")).toHaveLength(0)

    const confirmButton = [...document.querySelectorAll("button")]
      .find((button) => button.textContent === "确认")
    expect(confirmButton?.disabled).toBe(true)
  })

  it("preselects active provider and sonnet tier", async () => {
    bridge.agent.listProviders.mockResolvedValue([
      provider({ id: "bedrock", name: "Bedrock", sonnetModel: "bedrock-sonnet" }),
      provider({
        id: "anthropic",
        name: "Claude Official",
        active: true,
        model: "claude-main",
        sonnetModel: "claude-sonnet-4-20250514",
      }),
    ])
    const { root, ...props } = renderDialog()

    await act(async () => {
      root.render(<ProviderModelSelectDialog {...props} />)
      await Promise.resolve()
    })

    const confirmButton = [...document.querySelectorAll("button")]
      .find((button) => button.textContent === "确认")
    expect(confirmButton).toBeTruthy()
    expect(confirmButton?.disabled).toBe(false)

    await act(async () => {
      confirmButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(props.onSelect).toHaveBeenCalledWith({
      providerId: "anthropic",
      modelTier: "sonnet",
      providerName: "Claude Official",
      modelName: "claude-sonnet-4-20250514",
    })
  })

  it("keeps the selection empty when fallback preselection is disabled", async () => {
    bridge.agent.listProviders.mockResolvedValue([
      provider({
        id: "anthropic",
        name: "Claude Official",
        active: true,
        model: "claude-main",
        sonnetModel: "claude-sonnet-4-20250514",
      }),
    ])
    const { root, ...props } = renderDialog({ autoSelectFallback: false })

    await act(async () => {
      root.render(<ProviderModelSelectDialog {...props} />)
      await Promise.resolve()
    })

    expect(document.querySelector('[role="radio"][data-state="checked"]')).toBeNull()
    const confirmButton = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "确认")
    expect(confirmButton?.disabled).toBe(true)
    expect(props.onSelect).not.toHaveBeenCalled()
  })

  it("does not replace an unavailable persisted tier when fallback preselection is disabled", async () => {
    bridge.agent.listProviders.mockResolvedValue([
      provider({
        id: "anthropic",
        name: "Claude Official",
        active: true,
        model: "claude-main",
        sonnetModel: "claude-sonnet",
      }),
    ])
    const { root, ...props } = renderDialog({
      autoSelectFallback: false,
      defaultSelection: { providerId: "anthropic", modelTier: "opus" },
    })

    await act(async () => {
      root.render(<ProviderModelSelectDialog {...props} />)
      await Promise.resolve()
    })

    expect(document.querySelector('[role="radio"][data-state="checked"]')).not.toBeNull()
    const confirmButton = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "确认")
    expect(confirmButton?.disabled).toBe(true)
    expect(props.onSelect).not.toHaveBeenCalled()
  })

  it("returns selected providerId and modelTier on confirm", async () => {
    bridge.agent.listProviders.mockResolvedValue([
      provider({
        id: "anthropic",
        name: "Claude Official",
        active: true,
        model: "claude-main",
        haikuModel: "claude-haiku",
        sonnetModel: "claude-sonnet",
      }),
    ])
    const { root, ...props } = renderDialog()

    await act(async () => {
      root.render(<ProviderModelSelectDialog {...props} />)
      await Promise.resolve()
    })

    // Click the Haiku tier item
    const haikuElement = [...document.querySelectorAll("[data-tier]")]
      .find((el) => el.getAttribute("data-tier") === "haiku")
    expect(haikuElement).toBeTruthy()

    await act(async () => {
      haikuElement?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    const confirmButton = [...document.querySelectorAll("button")]
      .find((button) => button.textContent === "确认")
    await act(async () => {
      confirmButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(props.onSelect).toHaveBeenCalledWith({
      providerId: "anthropic",
      modelTier: "haiku",
      providerName: "Claude Official",
      modelName: "claude-haiku",
    })
  })

  it("filters archived providers", async () => {
    bridge.agent.listProviders.mockResolvedValue([
      provider({ id: "active-one", name: "Active Provider", active: true, model: "model-a" }),
      provider({ id: "archived-one", name: "Archived Provider", archived: true, model: "model-b" }),
    ])
    const { root, ...props } = renderDialog()

    await act(async () => {
      root.render(<ProviderModelSelectDialog {...props} />)
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("Active Provider")
    expect(document.body.textContent).not.toContain("Archived Provider")
  })

  it("shows error state with retry", async () => {
    bridge.agent.listProviders.mockRejectedValue(new Error("network error"))
    const { root, ...props } = renderDialog()

    await act(async () => {
      root.render(<ProviderModelSelectDialog {...props} />)
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("读取 Provider 失败")
    expect(document.body.textContent).not.toContain("network error")

    // Retry
    bridge.agent.listProviders.mockResolvedValue([
      provider({ id: "anthropic", name: "Claude", active: true, model: "m" }),
    ])
    const retryButton = [...document.querySelectorAll("button")]
      .find((button) => button.textContent === "重试")
    expect(retryButton).toBeTruthy()

    await act(async () => {
      retryButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("Claude")
  })

  it("shows empty list state", async () => {
    bridge.agent.listProviders.mockResolvedValue([])
    const { root, ...props } = renderDialog()

    await act(async () => {
      root.render(<ProviderModelSelectDialog {...props} />)
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("暂无 Provider")
  })

  it("echoes defaultSelection", async () => {
    bridge.agent.listProviders.mockResolvedValue([
      provider({
        id: "anthropic",
        name: "Claude Official",
        active: true,
        model: "claude-main",
        haikuModel: "claude-haiku",
        sonnetModel: "claude-sonnet",
        opusModel: "claude-opus",
      }),
    ])
    const { root, ...props } = renderDialog({
      defaultSelection: { providerId: "anthropic", modelTier: "opus" },
    })

    await act(async () => {
      root.render(<ProviderModelSelectDialog {...props} />)
      await Promise.resolve()
    })

    const confirmButton = [...document.querySelectorAll("button")]
      .find((button) => button.textContent === "确认")
    await act(async () => {
      confirmButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(props.onSelect).toHaveBeenCalledWith({
      providerId: "anthropic",
      modelTier: "opus",
      providerName: "Claude Official",
      modelName: "claude-opus",
    })
  })

  it("keeps the default footer without confirm input", async () => {
    bridge.agent.listProviders.mockResolvedValue([
      provider({ id: "anthropic", name: "Claude Official", active: true, model: "claude-main", sonnetModel: "claude-sonnet" }),
    ])
    const { root, ...props } = renderDialog()

    await act(async () => {
      root.render(<ProviderModelSelectDialog {...props} />)
      await Promise.resolve()
    })

    expect(document.querySelector("input[aria-label='会话名称']")).toBeNull()

    const confirmButton = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "确认")
    await act(async () => {
      confirmButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(props.onSelect).toHaveBeenCalledWith({
      providerId: "anthropic",
      modelTier: "sonnet",
      providerName: "Claude Official",
      modelName: "claude-sonnet",
    })
  })

  it("returns trimmed confirm input metadata when configured", async () => {
    bridge.agent.listProviders.mockResolvedValue([
      provider({ id: "anthropic", name: "Claude Official", active: true, model: "claude-main", sonnetModel: "claude-sonnet" }),
    ])
    const { root, ...props } = renderDialog({
      confirmInput: {
        initialValue: "24日下午1:30",
        ariaLabel: "会话名称",
      },
    })

    await act(async () => {
      root.render(<ProviderModelSelectDialog {...props} />)
      await Promise.resolve()
    })

    const input = document.querySelector<HTMLInputElement>("input[aria-label='会话名称']")
    expect(input?.value).toBe("24日下午1:30")

    await act(async () => {
      if (!input) return
      setInputValue(input, "  需求复盘  ")
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })

    const confirmButton = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "确认")
    await act(async () => {
      confirmButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(props.onSelect).toHaveBeenCalledWith({
      providerId: "anthropic",
      modelTier: "sonnet",
      providerName: "Claude Official",
      modelName: "claude-sonnet",
    }, {
      confirmInputValue: "需求复盘",
    })
  })

  it("disables confirm when configured confirm input is blank", async () => {
    bridge.agent.listProviders.mockResolvedValue([
      provider({ id: "anthropic", name: "Claude Official", active: true, model: "claude-main", sonnetModel: "claude-sonnet" }),
    ])
    const { root, ...props } = renderDialog({
      confirmInput: {
        initialValue: "24日下午1:30",
        ariaLabel: "会话名称",
      },
    })

    await act(async () => {
      root.render(<ProviderModelSelectDialog {...props} />)
      await Promise.resolve()
    })

    const input = document.querySelector<HTMLInputElement>("input[aria-label='会话名称']")
    await act(async () => {
      if (!input) return
      setInputValue(input, "   ")
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })

    const confirmButton = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "确认")
    expect(confirmButton?.disabled).toBe(true)
  })

  it("focuses the confirm input and submits it with Enter", async () => {
    bridge.agent.listProviders.mockResolvedValue([
      provider({ id: "anthropic", name: "Claude Official", active: true, model: "claude-main", sonnetModel: "claude-sonnet" }),
    ])
    const { root, ...props } = renderDialog({
      confirmInput: {
        initialValue: "24日下午1:30",
        ariaLabel: "会话名称",
      },
    })

    await act(async () => {
      root.render(<ProviderModelSelectDialog {...props} />)
      await Promise.resolve()
    })

    const input = document.querySelector<HTMLInputElement>("input[aria-label='会话名称']")
    expect(document.activeElement).toBe(input)

    await act(async () => {
      document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
    })

    expect(props.onSelect).toHaveBeenCalledWith(expect.objectContaining({
      providerId: "anthropic",
      modelTier: "sonnet",
    }), {
      confirmInputValue: "24日下午1:30",
    })
  })
})
