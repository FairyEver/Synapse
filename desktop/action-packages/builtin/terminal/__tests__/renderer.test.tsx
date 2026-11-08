// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"
import { TerminalConfigForm } from "../config.renderer"
import { TerminalResultView } from "../result.renderer"
import { terminalActionManifest } from "../manifest"
import type { TerminalActionConfig } from "../schema"
import type { SynapseProjectConfig } from "../../../../src/types/config"

const open = vi.hoisted(() => vi.fn())
vi.mock("@/lib/open-terminal-session", () => ({ openTerminalSession: open }))
vi.mock("@/app-shell/logging", () => ({ createRendererLogger: () => ({ warn: vi.fn(), info: vi.fn(), debug: vi.fn() }) }))
let root: Root | undefined
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.innerHTML = ""; vi.resetAllMocks() })

function mount() {
  const container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  return container
}

function edit(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  Object.getOwnPropertyDescriptor(input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(input, value)
  input.dispatchEvent(new Event("input", { bubbles: true }))
}

describe("terminal automation renderer", () => {
  it("selects an existing project and can clear it back to the default behavior", async () => {
    Element.prototype.scrollIntoView = vi.fn()
    const container = mount()
    let value: TerminalActionConfig = { ...terminalActionManifest.defaultConfig }
    const projects = [{ id: "project-alpha", name: "Alpha" }, { id: "project-beta", name: "Beta" }] as SynapseProjectConfig[]
    const change = (next: TerminalActionConfig) => { value = next }
    const render = () => act(async () => root!.render(<TerminalConfigForm value={value} onChange={change} projects={projects} />))
    await render()
    const expand = async () => act(async () => container.querySelector('[role="combobox"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })))
    await expand()
    expect(document.querySelector('[role="listbox"]')).not.toBeNull()
    expect(document.querySelector('[role="listbox"]')?.textContent).toContain("不指定项目")
    const option = (name: string) => [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(element => element.textContent === name)!
    await act(async () => option("Alpha").click())
    expect(value.projectId).toBe("project-alpha")
    await render(); await expand()
    await act(async () => option("不指定项目").click())
    expect(value.projectId).toBeUndefined()
    expect(value.command).toBe("")
  })
  it("edits literal multiline commands and timeout without inserting trigger variables", async () => {
    const container = mount()
    let value: TerminalActionConfig = { ...terminalActionManifest.defaultConfig }
    const change = vi.fn((next: TerminalActionConfig) => { value = next })
    const render = () => act(async () => root!.render(<TerminalConfigForm value={value} onChange={change}
      triggerVariables={[{ key: "trigger.payload.command", label: "命令" }]} />))
    await render()
    expect(container.querySelector('[role="checkbox"]')?.getAttribute("aria-checked")).toBe("true")
    expect(container.textContent).not.toContain("插入变量")
    const command = "printf '%s' '{{trigger.payload.command}}'\npython3 script.py"
    await act(async () => edit(container.querySelector("textarea")!, command))
    expect(change).toHaveBeenLastCalledWith({ command, autoClose: true, timeoutMins: 30 })
    await render()
    const timeout = container.querySelector<HTMLInputElement>('input[type="number"]')!
    expect(timeout.min).toBe("1")
    expect(timeout.max).toBe("1440")
    await act(async () => edit(timeout, ""))
    expect(change).toHaveBeenLastCalledWith({ command, autoClose: true, timeoutMins: null })
    await render()
    await act(async () => edit(timeout, "1440"))
    expect(change).toHaveBeenLastCalledWith({ command, autoClose: true, timeoutMins: 1440 })
    await render()
    const checkbox = container.querySelector<HTMLButtonElement>('[role="checkbox"]')!
    expect(container.querySelector(`label[for="${checkbox.id}"]`)?.textContent).toBe("执行完成后自动关闭终端")
    await act(async () => checkbox.click())
    expect(change).toHaveBeenLastCalledWith({ command, autoClose: false, timeoutMins: 1440 })
    await render()
    await act(async () => checkbox.click())
    expect(change).toHaveBeenLastCalledWith({ command, autoClose: true, timeoutMins: 1440 })
  })

  it("associates validation errors with the command and timeout fields", () => {
    const html = renderToStaticMarkup(<TerminalConfigForm value={terminalActionManifest.defaultConfig} onChange={() => undefined}
      fieldErrors={{ command: "填写命令", timeoutMins: "超时需为 1–1440 分钟" }} />)
    expect(html).toContain('aria-describedby="task-action-terminal-command-error"')
    expect(html).toContain('id="task-action-terminal-command-error"')
    expect(html).toContain('aria-describedby="task-action-terminal-timeout-error"')
    expect(html).toContain("超时需为 1–1440 分钟")
  })

  it("shows persisted output and exit status with shared redaction and no duplicate duration", () => {
    const html = renderToStaticMarkup(<TerminalResultView showDuration={false} result={{
      status: "failed", summary: "命令退出", metrics: { exitCode: 7, durationMs: 1355 },
      logs: [{ label: "终端输出", value: "completed\npassword=private-password" }],
      outputs: { sessionId: "s1", terminalRetained: false },
    }} />)
    expect(html).toContain("终端输出")
    expect(html).toContain("completed")
    expect(html).toContain("退出码 7")
    expect(html).not.toContain("private-password")
    expect(html).not.toContain("1355 ms")
    expect(html).not.toContain("打开终端")
  })

  it.each([
    { sessionId: "s1", terminalRetained: false },
    { sessionId: "s1" },
    { sessionId: "", terminalRetained: true },
    { terminalRetained: true },
  ])("omits the terminal entry unless an existing session was retained: %j", outputs => {
    expect(renderToStaticMarkup(<TerminalResultView result={{ status: "success", outputs }} />)).not.toContain("打开终端")
  })

  it.each([undefined, "project-alpha"])("opens only the retained session on explicit request, with project %s", async projectId => {
    const container = mount()
    open.mockRejectedValueOnce(new Error("终端会话已不可用"))
    const project = projectId ? { projectId } : {}
    await act(async () => root!.render(<TerminalResultView result={{ status: "success", outputs: { ...project, sessionId: "s1", terminalRetained: true } }} />))
    expect(open).not.toHaveBeenCalled()
    const button = container.querySelector<HTMLButtonElement>("button")!
    await act(async () => button.click())
    expect(open).toHaveBeenCalledWith({ ...project, sessionId: "s1" })
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("终端会话已不可用")
    expect(button.disabled).toBe(false)
    open.mockResolvedValueOnce(undefined)
    await act(async () => button.click())
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })
})
