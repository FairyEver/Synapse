/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const jsonRepairBridge = vi.hoisted(() => ({
  text: {
    repair: vi.fn(async () => ({
      ok: true as const,
      result: { json: "{\"ok\":true}" },
    })),
  },
}))

const mocks = vi.hoisted(() => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

vi.mock("@/lib/electron-bridge", () => ({
  requireBridgeDomain: (domain: string) => {
    if (domain === "jsonRepair") return jsonRepairBridge
    throw new Error(`Unexpected bridge domain: ${domain}`)
  },
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => mocks.logger,
}))

vi.mock("@/modules/apps/components/system-app-window-shell", () => ({
  SystemAppWindowShell: ({ actions, children }: {
    actions?: ReactNode
    children: ReactNode
  }) => (
    <div>
      <div data-actions>{actions}</div>
      {children}
    </div>
  ),
}))

vi.mock("sonner", () => ({
  toast: mocks.toast,
}))

import { JsonRepairModule } from "../index"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []

beforeEach(() => {
  vi.clearAllMocks()
  jsonRepairBridge.text.repair.mockResolvedValue({
    ok: true,
    result: { json: "{\"ok\":true}" },
  })
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  })
})

afterEach(() => {
  for (const root of roots) act(() => root.unmount())
  roots = []
  document.body.innerHTML = ""
})

describe("JsonRepairModule", () => {
  it("keeps blank and oversized input disabled", async () => {
    renderModule()
    expect(actionButton("修复 JSON")?.disabled).toBe(true)

    await changeInput(" ")
    expect(actionButton("修复 JSON")?.disabled).toBe(true)

    await changeInput("你".repeat(43_691))
    expect(actionButton("修复 JSON")?.disabled).toBe(true)
    expect(jsonRepairBridge.text.repair).not.toHaveBeenCalled()
  })

  it("submits original text and shows only complete successful JSON text", async () => {
    renderModule()
    await changeInput("prefix {ok:true}")
    await clickButton("修复 JSON")

    expect(jsonRepairBridge.text.repair).toHaveBeenCalledWith({
      text: "prefix {ok:true}",
    })
    const output = document.querySelector<HTMLTextAreaElement>("#json-repair-output")
    expect(output?.readOnly).toBe(true)
    expect(output?.value).toBe("{\"ok\":true}")
    expect(actionButton("复制 JSON")).toBeTruthy()
  })

  it("clears stale results and errors whenever input changes", async () => {
    renderModule()
    await changeInput("{}")
    await clickButton("修复 JSON")
    expect(document.querySelector<HTMLTextAreaElement>("#json-repair-output")?.value).toBe("{\"ok\":true}")

    await changeInput("[]")
    expect(document.querySelector<HTMLTextAreaElement>("#json-repair-output")?.value).toBe("")
    expect(actionButton("复制 JSON")).toBeUndefined()

    jsonRepairBridge.text.repair.mockResolvedValueOnce({
      ok: false as const,
      error: {
        code: "NO_JSON_FOUND" as const,
        message: "未找到可修复的 JSON 数据。",
        retryable: false as const,
      },
    } as never)
    await clickButton("修复 JSON")
    expect(document.body.textContent).toContain("未找到可修复的 JSON 数据。")
    await changeInput("[1]")
    expect(document.body.textContent).not.toContain("未找到可修复的 JSON 数据。")
  })

  it("reports clipboard rejection without an unhandled promise or content log", async () => {
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(
      new Error("permission denied for private JSON"),
    )
    renderModule()
    await changeInput("{}")
    await clickButton("修复 JSON")
    await clickButton("复制 JSON")

    expect(mocks.toast.error).toHaveBeenCalledWith("复制失败")
    expect(mocks.toast.success).not.toHaveBeenCalledWith("已复制")
    expect(mocks.logger.error).toHaveBeenCalledWith("JSON repair copy failed.", {
      stage: "clipboard_write",
      reason: "write_failed",
    })
    expect(JSON.stringify(mocks.logger.error.mock.calls)).not.toContain("permission denied")
    expect(JSON.stringify(mocks.logger.error.mock.calls)).not.toContain("{\"ok\":true}")
  })
})

function renderModule(): void {
  const root = createRoot(document.body.appendChild(document.createElement("div")))
  roots.push(root)
  act(() => root.render(<JsonRepairModule />))
}

function actionButton(text: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
    .find((button) => button.textContent?.trim() === text)
}

async function clickButton(text: string): Promise<void> {
  await act(async () => {
    actionButton(text)?.click()
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function changeInput(value: string): Promise<void> {
  const input = document.querySelector<HTMLTextAreaElement>("#json-repair-input")
  if (!input) throw new Error("JSON Repair input not found.")
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
    await Promise.resolve()
  })
}
