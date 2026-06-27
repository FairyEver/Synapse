/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SOUND_NOTIFIER_PRESETS } from "../../shared/defaults"

const soundNotifierBridge = vi.hoisted(() => ({
  getSettings: vi.fn(async () => ({
    schemaVersion: 3,
  })),
  preview: vi.fn(async () => ({
    played: true,
    eventType: "message",
    presetId: "soft-chime",
    repeatCount: 1,
    intervalMs: 1000,
  })),
  onChanged: vi.fn(() => () => undefined),
}))

const toast = vi.hoisted(() => ({
  error: vi.fn(),
}))

vi.mock("@/lib/electron-bridge", () => ({
  requireBridgeDomain: (domain: string) => {
    if (domain === "soundNotifier") return soundNotifierBridge
    throw new Error(`Unexpected bridge domain: ${domain}`)
  },
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}))

vi.mock("sonner", () => ({ toast }))

import { SoundNotifierModule } from "../index"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
;(globalThis as typeof globalThis & { ResizeObserver: typeof ResizeObserver }).ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

let roots: Root[] = []

beforeEach(() => {
  soundNotifierBridge.getSettings.mockClear()
  soundNotifierBridge.preview.mockClear()
  soundNotifierBridge.onChanged.mockClear()
  toast.error.mockClear()
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

describe("SoundNotifierModule", () => {
  it("renders semantic reminder types without default sound controls", async () => {
    await renderModule()

    expect(document.body.textContent).toContain("提醒类型")
    expect(document.body.textContent).toContain("普通消息")
    expect(document.body.textContent).toContain("需要输入")
    expect(document.body.textContent).toContain("任务完成")
    expect(document.body.textContent).toContain("长任务完成")
    expect(document.body.textContent).toContain("错误提醒")
    expect(document.body.textContent).toContain("循环次数")
    expect(document.body.textContent).toContain("间隔")
    expect(document.body.textContent).not.toContain("音量")
    expect(document.body.textContent).not.toContain("%")
    expect(document.body.textContent).not.toContain("MCP 播放")
    expect(document.body.textContent).not.toContain("默认声音")
    expect(document.body.textContent).not.toContain("试听默认声音")
    expect(document.body.textContent).not.toContain("设为默认")
    expect(findButtons("试听")).toHaveLength(SOUND_NOTIFIER_PRESETS.length)
    expect(document.body.querySelectorAll("[role='radio']")).toHaveLength(0)
  })

  it("previews a reminder type by semantic event type", async () => {
    await renderModule()

    const spinButtons = Array.from(document.body.querySelectorAll("button[aria-label]"))
    await act(async () => {
      spinButtons.find((button) => button.getAttribute("aria-label") === "增加循环次数")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      )
      spinButtons.find((button) => button.getAttribute("aria-label") === "增加间隔")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      )
      await Promise.resolve()
    })

    await act(async () => {
      findButtons("试听")[1]?.click()
      await Promise.resolve()
    })

    expect(soundNotifierBridge.preview).toHaveBeenCalledWith({
      eventType: "input-required",
      repeatCount: 2,
      intervalMs: 1100,
    })
  })
})

async function renderModule(): Promise<void> {
  const root = createRoot(document.body.appendChild(document.createElement("div")))
  roots.push(root)

  await act(async () => {
    root.render(<SoundNotifierModule />)
    await Promise.resolve()
  })
}

function findButtons(text: string): HTMLButtonElement[] {
  return Array.from(document.body.querySelectorAll("button"))
    .filter((button) => button.textContent?.trim() === text)
}
