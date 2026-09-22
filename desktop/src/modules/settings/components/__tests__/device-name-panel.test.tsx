/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DeviceNamePanel } from "../device-name-panel"

const mocks = vi.hoisted(() => ({ getDeviceSettings: vi.fn(), setDeviceName: vi.fn() }))
vi.mock("@/lib/electron-bridge", () => ({ getSynapseBridge: () => ({ live: mocks }) }))
vi.mock("@/app-shell/logging", () => ({ createRendererLogger: () => ({ info: vi.fn(), warn: vi.fn() }) }))
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: Root

beforeEach(() => {
  vi.resetAllMocks()
  mocks.getDeviceSettings.mockResolvedValue({ name: "liyang.local" })
  mocks.setDeviceName.mockImplementation(async ({ name }: { name: string }) => ({ name }))
  const container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); document.body.innerHTML = "" })

async function render() { await act(async () => { root.render(<DeviceNamePanel />) }) }
function input() { return document.querySelector("input")! }
async function change(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), value)
    input().dispatchEvent(new Event("input", { bubbles: true }))
  })
}
async function submit() {
  await act(async () => { document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })) })
}

describe("device name settings", () => {
  it("loads the current name, trims and saves an edited name", async () => {
    await render()
    expect(input().value).toBe("liyang.local")
    await change("  公司 Mac  ")
    await submit()
    expect(mocks.setDeviceName).toHaveBeenCalledWith({ name: "公司 Mac" })
    expect(input().value).toBe("公司 Mac")
    expect(document.querySelector("button")!.disabled).toBe(true)
  })

  it("rejects blank names without an IPC write", async () => {
    await render()
    await change("   ")
    await submit()
    expect(mocks.setDeviceName).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain("请输入设备名称")
  })

  it("keeps the draft after a failed save and allows retry", async () => {
    mocks.setDeviceName.mockRejectedValueOnce(new Error("disk full"))
    await render()
    await change("家里 Windows")
    await submit()
    expect(input().value).toBe("家里 Windows")
    expect(document.body.textContent).toContain("保存设备名称失败")
    await submit()
    expect(mocks.setDeviceName).toHaveBeenCalledTimes(2)
    expect(document.body.textContent).not.toContain("保存设备名称失败")
  })

  it("can retry an initial read failure", async () => {
    mocks.getDeviceSettings.mockRejectedValueOnce(new Error("unavailable"))
    await render()
    expect(input().disabled).toBe(true)
    expect(document.body.textContent).toContain("读取设备名称失败")
    await act(async () => { document.querySelector("button")!.click() })
    expect(input().value).toBe("liyang.local")
    expect(input().disabled).toBe(false)
  })
})
