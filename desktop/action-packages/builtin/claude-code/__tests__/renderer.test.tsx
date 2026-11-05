// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ClaudeCodeConfigForm } from "../config.renderer"
import { ClaudeCodeResultView } from "../result.renderer"

const open = vi.hoisted(() => vi.fn())
vi.mock("@/lib/open-terminal-session", () => ({ openTerminalSession: open }))
vi.mock("@/app-shell/logging", () => ({ createRendererLogger: () => ({ warn: vi.fn(), info: vi.fn(), debug: vi.fn() }) }))
let root: Root | undefined
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
afterEach(async () => { await act(async () => root?.unmount()); document.body.innerHTML = ""; vi.clearAllMocks() })

describe("Claude Code automation renderer", () => {
  it("omits repeated duration while keeping the terminal entry", () => {
    const html = renderToStaticMarkup(<ClaudeCodeResultView showDuration={false} result={{
      status: "success", summary: "提示词已提交", metrics: { durationMs: 1355 }, outputs: { projectId: "p1", sessionId: "s1" },
    }} />)
    expect(html).not.toContain("1355 ms")
    expect(html).toContain("提示词已提交")
    expect(html).toContain("打开终端")
  })

  it("leaves legacy tasks unchecked and lets the user enable and disable single-run mode", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    const change = vi.fn()
    const render = async (singleRun?: boolean) => {
      await act(async () => root!.render(<ClaudeCodeConfigForm value={{ projectId: "p1", prompt: "Review", singleRun }} onChange={change} />))
    }
    await render()
    const checkbox = container.querySelector<HTMLButtonElement>('[role="checkbox"]')!
    expect(checkbox).not.toBeNull()
    expect(container.querySelector(`label[for="${checkbox.id}"]`)?.textContent).toBe("完成后退出 Claude Code")
    expect(checkbox.getAttribute("aria-checked")).toBe("false")
    await act(async () => checkbox.click())
    expect(change).toHaveBeenLastCalledWith({ projectId: "p1", prompt: "Review", singleRun: true })
    await render(true)
    expect(checkbox.getAttribute("aria-checked")).toBe("true")
    await act(async () => checkbox.click())
    expect(change).toHaveBeenLastCalledWith({ projectId: "p1", prompt: "Review", singleRun: false })
  })
  it("configures the target project, prompt and single-run mode without provider overrides", () => {
    const html = renderToStaticMarkup(<ClaudeCodeConfigForm value={{ projectId: "", prompt: "Review" }} onChange={() => undefined} projects={[]}
      triggerVariables={[{ key: "trigger.payload.subject", label: "主题" }]} />)
    expect(html).toContain("项目")
    expect(html).toContain("提示词")
    expect(html).toContain("完成后退出 Claude Code")
    expect(html).not.toContain("供应商")
    expect(html).not.toContain("权限模式")
    expect(html).not.toContain("会话策略")
    expect(html).toContain("插入变量")
  })
  it("keeps navigation behind the open-terminal button", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => root!.render(<ClaudeCodeResultView result={{ status: "success", outputs: { projectId: "p1", sessionId: "s1" } }} />))
    expect(open).not.toHaveBeenCalled()
    const button = document.querySelector<HTMLButtonElement>("button")!
    expect(button.textContent).toContain("打开终端")
    await act(async () => button.click())
    expect(open).toHaveBeenCalledWith({ projectId: "p1", sessionId: "s1" })
  })
})
