/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createDefaultConfig } from "@/lib/config"
import { SettingItemRow } from "@/modules/settings/components/setting-item-row"
import type { SettingItem, SettingsContext } from "@/modules/settings/types"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type SettingItemRowOnSave = Parameters<typeof SettingItemRow>[0]["onSave"]

let roots: Root[] = []

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots = []
  document.body.innerHTML = ""
  vi.useRealTimers()
})

describe("SettingItemRow", () => {
  it("aligns toggle controls to the right edge of the control column", () => {
    const item = createToggleSettingItem()
    const context = createSettingsContext()

    renderSettingItemRow({
      item,
      context,
      onSave: vi.fn(async () => true),
      value: false,
    })

    const toggle = document.body.querySelector("[role='switch']")
    const control = toggle?.parentElement

    expect(control?.classList.contains("justify-end")).toBe(true)
    expect(control?.classList.contains("md:w-[200px]")).toBe(false)
  })

  it("rolls draft input back to the current value when save fails", async () => {
    const item = createTextSettingItem()
    const context = createSettingsContext()
    const onSave = vi.fn(async () => false)

    renderSettingItemRow({ item, context, onSave, value: "saved" })

    const input = getInput()
    await act(async () => {
      setInputValue(input, "unsaved")
      input.dispatchEvent(new Event("input", { bubbles: true }))
      await Promise.resolve()
    })

    expect(input.value).toBe("unsaved")

    await act(async () => {
      vi.advanceTimersByTime(300)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(onSave).toHaveBeenCalledWith(item, "unsaved")
    expect(input.value).toBe("saved")
  })
})

function renderSettingItemRow(props: {
  item: SettingItem
  value: unknown
  context: SettingsContext
  onSave: SettingItemRowOnSave
}): void {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  act(() => {
    root.render(<SettingItemRow {...props} />)
  })
}

function createToggleSettingItem(): SettingItem {
  return {
    key: "agent.experimentalSynapseToolRouterEnabled",
    label: "Synapse MCP 工具按需加载",
    description: "只在需要时加载 Synapse MCP 工具。",
    category: "experimental",
    type: "toggle",
    defaultValue: false,
    scope: "global",
  }
}

function createTextSettingItem(): SettingItem {
  return {
    key: "global.testValue",
    label: "测试设置",
    category: "general",
    type: "text",
    defaultValue: "",
    scope: "global",
  }
}

function createSettingsContext(): SettingsContext {
  return {
    config: createDefaultConfig(),
    activeRepository: null,
  }
}

function getInput(): HTMLInputElement {
  const input = document.body.querySelector("input")
  if (!(input instanceof HTMLInputElement)) {
    throw new Error("Input not found")
  }
  return input
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
  if (!setter) throw new Error("Input value setter not found")
  setter.call(input, value)
}
