/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { PriceRulesView } from "../components/price-rules-view"
import type { ModelPricePresetSummary, ModelPriceRule } from "../types"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const notifications = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
}))

const modelPriceBridge = vi.hoisted(() => ({
  saveRules: vi.fn(),
  clearRules: vi.fn(),
  listPresets: vi.fn(),
  importPreset: vi.fn(),
  importPresets: vi.fn(),
}))

vi.mock("@/app-shell/notifications", () => ({
  useAppNotifications: () => notifications,
}))

vi.mock("@/lib/electron-bridge", () => ({
  requireSynapseBridge: () => ({
    modelPrice: {
      preset: {
        list: modelPriceBridge.listPresets,
        import: (presetIds: unknown) => Array.isArray(presetIds)
          ? modelPriceBridge.importPresets(presetIds)
          : modelPriceBridge.importPreset(presetIds),
      },
      rule: {
        save: modelPriceBridge.saveRules,
        clear: modelPriceBridge.clearRules,
      },
    },
  }),
}))

vi.mock("@/lib/ui-tracking", () => ({
  track: vi.fn(),
  extractLabel: () => "button",
  mergeRefs: (...refs: unknown[]) => (value: unknown) => {
    for (const ref of refs) {
      if (typeof ref === "function") ref(value)
      if (typeof ref === "object" && ref !== null && "current" in ref) {
        ;(ref as { current: unknown }).current = value
      }
    }
  },
}))

let roots: Root[] = []

beforeEach(() => {
  notifications.error.mockClear()
  notifications.success.mockClear()
  notifications.warning.mockClear()
  modelPriceBridge.saveRules.mockReset()
  modelPriceBridge.clearRules.mockReset()
  modelPriceBridge.listPresets.mockReset()
  modelPriceBridge.importPreset.mockReset()
  modelPriceBridge.importPresets.mockReset()
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

describe("PriceRulesView", () => {
  it("adds a new rule at the top of the table", async () => {
    const host = document.createElement("div")
    document.body.appendChild(host)
    const root = createRoot(host)
    roots.push(root)

    await act(async () => {
      root.render(
        <PriceRulesView
          state={{
            data: [
              priceRule({ id: "first", modelPattern: "first-model", sortIndex: 0 }),
              priceRule({ id: "second", modelPattern: "second-model", sortIndex: 1 }),
            ],
            loading: false,
            error: null,
            reload: vi.fn(),
          }}
          presetState={presetState([])}
          onSaved={vi.fn()}
        />,
      )
      await flushPromises()
    })

    await act(async () => {
      clickButton("添加")
      await flushPromises()
    })

    expect(modelPatternValues()).toEqual(["", "first-model", "second-model"])
  })

  it("confirms and clears rules", async () => {
    modelPriceBridge.clearRules.mockResolvedValueOnce([])
    const onSaved = vi.fn()
    const host = document.createElement("div")
    document.body.appendChild(host)
    const root = createRoot(host)
    roots.push(root)

    await act(async () => {
      root.render(
        <PriceRulesView
          state={{
            data: [priceRule({ id: "local", modelPattern: "local-model", inputPer1M: 99 })],
            loading: false,
            error: null,
            reload: vi.fn(),
          }}
          presetState={presetState([])}
          onSaved={onSaved}
        />,
      )
      await flushPromises()
    })

    expect(inputValues()).toContain("local-model")

    await act(async () => {
      clickButton("清空")
      await flushPromises()
    })
    expect(document.body.textContent).toContain("清空价格规则")
    expect(document.body.textContent).not.toContain("恢复内置默认价格")

    await act(async () => {
      clickButton("确认清空")
      await flushPromises()
    })

    expect(modelPriceBridge.clearRules).toHaveBeenCalledTimes(1)
    expect(inputValues()).not.toContain("local-model")
    expect(onSaved).toHaveBeenCalledTimes(1)
    expect(notifications.success).toHaveBeenCalledWith("已清空")
  })

  it("imports selected presets and updates rows", async () => {
    modelPriceBridge.importPresets.mockResolvedValueOnce([
      priceRule({ id: "mpr_123456789abc", modelPattern: "deepseek-v4-pro", inputPer1M: 3 }),
    ])
    const onSaved = vi.fn()
    const host = document.createElement("div")
    document.body.appendChild(host)
    const root = createRoot(host)
    roots.push(root)

    await act(async () => {
      root.render(
        <PriceRulesView
          state={{
            data: [priceRule({ id: "local", modelPattern: "local-model", inputPer1M: 99 })],
            loading: false,
            error: null,
            reload: vi.fn(),
          }}
          presetState={presetState([
            { id: "openai", label: "OpenAI", ruleCount: 4 },
            { id: "deepseek-official", label: "DeepSeek 官方", ruleCount: 2 },
          ])}
          onSaved={onSaved}
        />,
      )
      await flushPromises()
    })

    await act(async () => {
      clickButton("导入预设")
      await flushPromises()
    })
    expect(document.body.textContent).toContain("导入预设")
    expect(document.body.textContent).toContain("DeepSeek 官方")

    await act(async () => {
      clickCheckbox("DeepSeek 官方")
      await flushPromises()
    })

    await act(async () => {
      clickButton("导入")
      await flushPromises()
    })

    expect(modelPriceBridge.importPresets).toHaveBeenCalledWith(["openai", "deepseek-official"])
    expect(inputValues()).toContain("deepseek-v4-pro")
    expect(inputValues()).not.toContain("local-model")
    expect(document.body.textContent).not.toContain("mpr_123456789abc")
    expect(onSaved).toHaveBeenCalledTimes(1)
    expect(notifications.success).toHaveBeenCalledWith("已导入 2 个预设")
  })

  it("surfaces save validation errors without zeroing invalid prices", async () => {
    modelPriceBridge.saveRules.mockRejectedValueOnce(new Error("第 1 行：inputPer1M 必须是大于等于 0 的数字。"))
    const onSaved = vi.fn()
    const host = document.createElement("div")
    document.body.appendChild(host)
    const root = createRoot(host)
    roots.push(root)

    await act(async () => {
      root.render(
        <PriceRulesView
          state={{
            data: [priceRule({ id: "local", modelPattern: "local-model", inputPer1M: 99 })],
            loading: false,
            error: null,
            reload: vi.fn(),
          }}
          presetState={presetState([])}
          onSaved={onSaved}
        />,
      )
      await flushPromises()
    })

    await act(async () => {
      changeInput("输入", "-1")
      clickButton("保存")
      await flushPromises()
    })

    expect(modelPriceBridge.saveRules).toHaveBeenCalledWith([
      expect.objectContaining({
        modelPattern: "local-model",
        inputPer1M: -1,
      }),
    ])
    expect(onSaved).not.toHaveBeenCalled()
    expect(notifications.success).not.toHaveBeenCalledWith("已保存")
    expect(notifications.error).toHaveBeenCalledWith("第 1 行：inputPer1M 必须是大于等于 0 的数字。")
  })

  it("disables table controls while importing", async () => {
    let resolveImport: (rules: ModelPriceRule[]) => void = () => undefined
    modelPriceBridge.importPresets.mockReturnValueOnce(new Promise<ModelPriceRule[]>((resolve) => {
      resolveImport = resolve
    }))
    const host = document.createElement("div")
    document.body.appendChild(host)
    const root = createRoot(host)
    roots.push(root)

    await act(async () => {
      root.render(
        <PriceRulesView
          state={{
            data: [priceRule({ id: "hidden-rule-id", modelPattern: "local-model", inputPer1M: 99 })],
            loading: false,
            error: null,
            reload: vi.fn(),
          }}
          presetState={presetState([
            { id: "deepseek-official", label: "DeepSeek 官方", ruleCount: 2 },
          ])}
          onSaved={vi.fn()}
        />,
      )
      await flushPromises()
    })

    expect(document.body.textContent).not.toContain("hidden-rule-id")

    await act(async () => {
      clickButton("导入预设")
      await flushPromises()
    })
    await act(async () => {
      clickButton("导入")
      await flushPromises()
    })

    expect([...document.querySelectorAll("input")].every((input) => input.disabled)).toBe(true)
    expect((document.querySelector('[aria-label="启用"]') as HTMLButtonElement | null)?.disabled).toBe(true)
    expect((document.querySelector('[aria-label="删除"]') as HTMLButtonElement | null)?.disabled).toBe(true)

    await act(async () => {
      resolveImport([priceRule({ id: "mpr_123456789abc", modelPattern: "deepseek-v4-pro", inputPer1M: 3 })])
      await flushPromises()
    })
  })

  it("keeps narrow-window overflow inside toolbar wrapping and table scrolling bounds", async () => {
    const host = document.createElement("div")
    document.body.appendChild(host)
    const root = createRoot(host)
    roots.push(root)

    await act(async () => {
      root.render(
        <PriceRulesView
          state={{
            data: [priceRule({ id: "local", modelPattern: "local-model", inputPer1M: 99 })],
            loading: false,
            error: null,
            reload: vi.fn(),
          }}
          presetState={presetState([])}
          onSaved={vi.fn()}
        />,
      )
      await flushPromises()
    })

    expect(document.querySelector("[data-price-rules-root]")?.className).toContain("min-w-0")
    expect(document.querySelector("[data-price-rules-toolbar]")?.className).toContain("grid-cols-1")
    expect(document.querySelector("[data-price-rules-toolbar]")?.className).toContain("sm:grid-cols-[auto_minmax(0,1fr)]")
    expect(document.querySelector("[data-price-rules-actions]")?.className).toContain("flex-wrap")
    expect(document.querySelector("[data-price-rules-actions]")?.className).toContain("max-w-full")
    expect(document.querySelector("[data-price-rules-table-panel]")?.className).toContain("overflow-hidden")
    expect(document.querySelector("[data-slot='table-container']")?.className).toContain("overflow-x-auto")
  })
})

function clickButton(label: string): void {
  const button = [...document.querySelectorAll("button")]
    .find((candidate) => candidate.textContent?.trim() === label)
    ?? [...document.querySelectorAll("button")]
      .find((candidate) => candidate.textContent?.includes(label))
  if (!button) throw new Error(`Button not found: ${label}`)
  button.dispatchEvent(new MouseEvent("click", { bubbles: true }))
}

function clickCheckbox(label: string): void {
  const checkbox = document.querySelector<HTMLElement>(`[aria-label="${label}"]`)
  if (!checkbox) throw new Error(`Checkbox not found: ${label}`)
  checkbox.dispatchEvent(new MouseEvent("click", { bubbles: true }))
}

function changeInput(label: string, value: string): void {
  const input = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)
  if (!input) throw new Error(`Input not found: ${label}`)
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
  valueSetter?.call(input, value)
  input.dispatchEvent(new Event("input", { bubbles: true }))
}

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function inputValues(): string[] {
  return [...document.querySelectorAll("input")].map((input) => input.value)
}

function modelPatternValues(): string[] {
  return [...document.querySelectorAll<HTMLInputElement>('input[aria-label="模型匹配"]')]
    .map((input) => input.value)
}

function presetState(data: ModelPricePresetSummary[]) {
  return {
    data,
    loading: false,
    error: null,
    reload: vi.fn(),
  }
}

function priceRule(input: Partial<ModelPriceRule>): ModelPriceRule {
  return {
    id: input.id ?? "rule",
    modelPattern: input.modelPattern ?? "model",
    inputPer1M: input.inputPer1M ?? 1,
    outputPer1M: input.outputPer1M ?? 2,
    cacheReadPer1M: input.cacheReadPer1M ?? 0,
    cacheWritePer1M: input.cacheWritePer1M ?? 0,
    reasoningPer1M: input.reasoningPer1M ?? 2,
    currency: "CNY",
    enabled: input.enabled ?? true,
    source: input.source ?? "user",
    sortIndex: input.sortIndex ?? 0,
    updatedAt: input.updatedAt ?? "2026-06-03T00:00:00.000Z",
  }
}
