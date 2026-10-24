/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { AgentMcpSettingsPanel } from "../agent-mcp-settings-panel"
import { useAgentMcpSettings } from "../../hooks/use-agent-mcp-settings"

const mocks = vi.hoisted(() => ({ list: vi.fn(), setEnabled: vi.fn(), error: vi.fn() }))
vi.mock("@/lib/electron-bridge", () => ({ requireSynapseBridge: () => ({ mcp: { agent: mocks } }) }))
vi.mock("@/app-shell/logging", () => ({ createRendererLogger: () => ({ error: mocks.error }) }))
vi.mock("@/lib/ui-tracking", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/ui-tracking")>(), track: vi.fn() }))
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: Root | undefined, host: HTMLDivElement
afterEach(async () => { await act(async () => root?.unmount()); host?.remove(); vi.resetAllMocks() })
const inventory = (enabled = true) => ({ items: [{ name: "rea", source: "user", enabled, configurable: true }], projects: [], warnings: [], disabledServerNames: enabled ? [] : ["rea"] })
async function render() {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host)
  await act(async () => root!.render(<AgentMcpSettingsPanel />))
}
describe("Agent MCP settings panel", () => {
  it("switches project scope and ignores a late response from the previous scope", async () => {
    let finishFirst: ((value: ReturnType<typeof inventory>) => void) | undefined
    mocks.list.mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve }))
      .mockResolvedValue({ ...inventory(), items: [{ name: "project-mcp", source: "project", enabled: true, configurable: true }] })
    function ScopeProbe() {
      const state = useAgentMcpSettings()
      return <><button onClick={() => state.setProjectId("project")}>选择项目</button><div>{state.data?.items.map(item => item.name).join(",")}</div></>
    }
    host = document.createElement("div"); document.body.append(host); root = createRoot(host)
    await act(async () => root!.render(<ScopeProbe />))
    await act(async () => (host.querySelector("button") as HTMLButtonElement).click())
    expect(mocks.list).toHaveBeenLastCalledWith({ projectId: "project" })
    await act(async () => finishFirst?.(inventory()))
    expect(host.textContent).toContain("project-mcp")
    expect(host.textContent).not.toContain("rea")
  })
  it("loads on entry, refreshes and saves a SY-only toggle", async () => {
    mocks.list.mockResolvedValue(inventory()); mocks.setEnabled.mockResolvedValue(undefined)
    await render()
    expect(host.textContent).toContain("Agent 使用的 MCP")
    expect(mocks.list).toHaveBeenCalledWith({})
    mocks.list.mockResolvedValue(inventory(false))
    await act(async () => (host.querySelector('[role="switch"]') as HTMLButtonElement).click())
    expect(mocks.setEnabled).toHaveBeenCalledWith({ name: "rea", enabled: false })
    expect(host.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("false")
    const count = mocks.list.mock.calls.length
    await act(async () => (host.querySelector('button[aria-label="刷新 Agent MCP"]') as HTMLButtonElement).click())
    expect(mocks.list.mock.calls.length).toBe(count + 1)
  })
  it("reports refresh failures without showing stale controls and supports retry", async () => {
    mocks.list.mockRejectedValueOnce(new Error("raw-token"))
    await render()
    expect(host.textContent).toContain("无法读取 MCP 配置")
    expect(host.textContent).not.toContain("raw-token")
    mocks.list.mockResolvedValue(inventory())
    await act(async () => (host.querySelector('button[aria-label="刷新 Agent MCP"]') as HTMLButtonElement).click())
    expect(host.textContent).toContain("rea")
  })
  it("does not falsely flip a switch when saving fails", async () => {
    mocks.list.mockResolvedValue(inventory()); mocks.setEnabled.mockRejectedValue(new Error("secret"))
    await render()
    await act(async () => (host.querySelector('[role="switch"]') as HTMLButtonElement).click())
    expect(host.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("true")
    expect(host.textContent).toContain("保存失败")
    expect(host.textContent).not.toContain("secret")
  })
})
