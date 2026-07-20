/**
 * @vitest-environment jsdom
 */
import { useState } from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { SynapseAgentProvider } from "@/types/bridge"
import type { ProviderModelSelection } from "@/types/provider-model"
import {
  pickInitialProviderModelSelection,
  ProviderModelPicker,
} from "../provider-model-picker"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []

afterEach(() => {
  for (const root of roots) {
    act(() => root.unmount())
  }
  roots = []
  document.body.innerHTML = ""
})

describe("ProviderModelPicker", () => {
  it("renders selectable provider tiers and updates the controlled value immediately", async () => {
    const onValueChange = vi.fn()
    await renderPicker({ onValueChange })

    expect(document.body.textContent).toContain("Claude Official")
    expect(document.body.textContent).toContain("Backup Provider")
    expect(document.querySelector("thead")).toBeNull()
    expect(document.querySelector("button[data-tier]")?.parentElement?.className).toContain("sm:grid-cols-2")

    const anthropicRow = findProviderRow("Claude Official")
    expect([...(anthropicRow?.querySelectorAll<HTMLButtonElement>("button[data-tier]") ?? [])]
      .map((button) => button.querySelector("span")?.textContent)).toEqual(["#1", "#2", "#3", "#4"])
    expect(document.body.textContent).not.toContain("Opus")
    expect(document.body.textContent).not.toContain("Sonnet")
    expect(document.body.textContent).not.toContain("Haiku")

    const opusButton = findTierButton("Claude Official", "opus")
    expect(opusButton?.getAttribute("aria-label"))
      .toBe("#2，原名称：Opus，模型：claude-opus")
    await act(async () => {
      opusButton?.focus()
      await Promise.resolve()
    })
    expect(document.querySelector('[data-slot="tooltip-content"]')).toBeNull()
    expect(opusButton?.getAttribute("data-slot")).not.toBe("tooltip-trigger")
    const opusModelName = opusButton?.querySelector<HTMLElement>("span:last-child")
    expect(opusModelName?.getAttribute("data-slot")).not.toBe("tooltip-trigger")
    const opusTierLabel = opusButton?.querySelector<HTMLElement>('[data-slot="tooltip-trigger"]')
    expect(opusTierLabel?.textContent).toBe("#2")
    expect(opusTierLabel?.getAttribute("aria-label")).toBe("#2，原名称：Opus")

    const haikuButton = findTierButton("Backup Provider", "haiku")
    await act(async () => haikuButton?.click())

    expect(onValueChange).toHaveBeenLastCalledWith({
      providerId: "backup",
      providerName: "Backup Provider",
      modelTier: "haiku",
      modelName: "backup-haiku",
    })
    expect(haikuButton?.getAttribute("aria-pressed")).toBe("true")
  })

  it("filters archived and explicitly excluded providers", async () => {
    await renderPicker({ excludeProviderIds: ["backup"] })

    expect(document.body.textContent).toContain("Claude Official")
    expect(document.body.textContent).not.toContain("Backup Provider")
    expect(document.body.textContent).not.toContain("Archived Provider")
  })

  it("renders loading skeletons, an empty state, and retryable errors", async () => {
    const onRetry = vi.fn()
    const loading = await renderPicker({ loading: true })
    expect(document.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(9)
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull()
    act(() => loading.root.unmount())
    roots = roots.filter((root) => root !== loading.root)
    document.body.innerHTML = ""

    const empty = await renderPicker({ providers: [] })
    expect(document.body.textContent).toContain("暂无 Provider")
    act(() => empty.root.unmount())
    roots = roots.filter((root) => root !== empty.root)
    document.body.innerHTML = ""

    await renderPicker({ error: "读取 Provider 失败", onRetry })
    expect(document.body.textContent).toContain("读取 Provider 失败")
    await act(async () => findButton("重试")?.click())
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it("blocks pointer and keyboard selection while disabled", async () => {
    const onValueChange = vi.fn()
    await renderPicker({ disabled: true, onValueChange })

    const tierButton = findTierButton("Backup Provider", "haiku")
    const radio = document.querySelector<HTMLElement>('[role="radio"][aria-label="Backup Provider"]')
    expect(tierButton?.disabled).toBe(true)
    expect(radio?.getAttribute("data-disabled")).not.toBeNull()

    await act(async () => {
      tierButton?.click()
      radio?.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }))
    })
    expect(onValueChange).not.toHaveBeenCalled()
  })

  it("keeps provider radios and tier buttons keyboard focusable", async () => {
    await renderPicker()

    const radio = document.querySelector<HTMLElement>('[role="radio"][aria-label="Claude Official"]')
    const tierButton = findTierButton("Backup Provider", "haiku")
    expect(radio).not.toBeNull()
    act(() => radio?.focus())
    expect(document.activeElement).toBe(radio)
    expect(tierButton?.tabIndex).toBeGreaterThanOrEqual(0)
  })

  it("uses a valid preferred model and falls back to the active provider Sonnet tier", () => {
    expect(pickInitialProviderModelSelection(PROVIDERS, {
      providerId: "backup",
      modelTier: "haiku",
    })).toMatchObject({ providerId: "backup", modelTier: "haiku" })

    expect(pickInitialProviderModelSelection(PROVIDERS, {
      providerId: "missing",
      modelTier: "opus",
    })).toMatchObject({ providerId: "anthropic", modelTier: "sonnet" })
  })
})

async function renderPicker(input: {
  readonly providers?: readonly SynapseAgentProvider[]
  readonly value?: ProviderModelSelection | null
  readonly loading?: boolean
  readonly error?: string | null
  readonly disabled?: boolean
  readonly excludeProviderIds?: readonly string[]
  readonly onRetry?: () => void
  readonly onValueChange?: (selection: ProviderModelSelection) => void
} = {}) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  function ControlledPicker() {
    const [value, setValue] = useState<ProviderModelSelection | null>(
      input.value ?? DEFAULT_SELECTION,
    )
    return (
      <ProviderModelPicker
        providers={input.providers ?? PROVIDERS}
        value={value}
        loading={input.loading}
        error={input.error}
        disabled={input.disabled}
        excludeProviderIds={input.excludeProviderIds}
        onRetry={input.onRetry}
        onValueChange={(selection) => {
          setValue(selection)
          input.onValueChange?.(selection)
        }}
      />
    )
  }

  await act(async () => root.render(<ControlledPicker />))
  return { root }
}

function findTierButton(providerName: string, tier: string): HTMLButtonElement | undefined {
  const row = findProviderRow(providerName)
  return row?.querySelector<HTMLButtonElement>(`button[data-tier="${tier}"]`) ?? undefined
}

function findProviderRow(providerName: string): HTMLTableRowElement | undefined {
  return [...document.querySelectorAll<HTMLTableRowElement>("tbody tr")]
    .find((item) => item.textContent?.includes(providerName))
}

function findButton(content: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent === content)
}

function provider(input: Partial<SynapseAgentProvider> & Pick<SynapseAgentProvider, "id" | "name">): SynapseAgentProvider {
  return {
    category: "official",
    apiKeyField: "ANTHROPIC_AUTH_TOKEN",
    createdAt: "2026-07-20T00:00:00.000Z",
    updatedAt: "2026-07-20T00:00:00.000Z",
    ...input,
  }
}

const PROVIDERS = [
  provider({
    id: "anthropic",
    name: "Claude Official",
    active: true,
    model: "claude-main",
    haikuModel: "claude-haiku",
    sonnetModel: "claude-sonnet",
    opusModel: "claude-opus",
  }),
  provider({
    id: "backup",
    name: "Backup Provider",
    model: "backup-main",
    haikuModel: "backup-haiku",
  }),
  provider({
    id: "archived",
    name: "Archived Provider",
    archived: true,
    model: "archived-main",
  }),
] satisfies readonly SynapseAgentProvider[]

const DEFAULT_SELECTION: ProviderModelSelection = {
  providerId: "anthropic",
  providerName: "Claude Official",
  modelTier: "sonnet",
  modelName: "claude-sonnet",
}
