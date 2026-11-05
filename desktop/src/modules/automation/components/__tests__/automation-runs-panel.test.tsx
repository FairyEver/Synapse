// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { AutomationChangedEvent, AutomationItem, AutomationRun } from "@/types/automation"
import { AutomationRunsPanel } from "../automation-runs-dialog"

const api = vi.hoisted(() => ({ list: vi.fn(), listener: undefined as undefined | ((event: AutomationChangedEvent) => void) }))
vi.mock("../../hooks/use-automation", () => ({
  listAutomationRuns: api.list,
  subscribeAutomationChanges: (listener: (event: AutomationChangedEvent) => void) => { api.listener = listener; return () => { api.listener = undefined } },
}))
vi.mock("@/action-runtime/action-result-view", () => ({ ActionResultView: () => <p>完整执行结果</p> }))
vi.mock("@/action-runtime/builtin-actions", () => ({ rendererActionRegistry: { get: () => ({}) } }))
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as typeof ResizeObserver
let root: Root
const item = { id: "a1", executor: { type: "builtin.agent" } } as AutomationItem
const run = (status: AutomationRun["status"] = "success"): AutomationRun => ({ id: "r1", automationId: "a1", schemaVersion: 1, status, triggeredBy: "manual", triggerType: "builtin.cron", executorType: "builtin.agent", startedAt: "2026-11-05T12:00:00Z", result: { status: "success", outputs: {} } })
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find(element => element.textContent?.includes(text))!
beforeEach(() => { api.list.mockReset(); const container = document.createElement("div"); document.body.append(container); root = createRoot(container) })
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; vi.restoreAllMocks() })

describe("automation run history", () => {
  it.each([[60_000, "1m"], [119_499, "1m59s"], [119_999, "2m"], [179_999, "3m"]])("carries rounded duration %sms into the next minute", async (durationMs, label) => {
    api.list.mockResolvedValue([{ ...run(), result: { status: "success", metrics: { durationMs } } }])
    await act(async () => root.render(<AutomationRunsPanel item={item} busy={false} onStopRun={vi.fn()} />))
    expect(document.body.textContent).toContain(label)
    expect(document.body.textContent).not.toContain("m60s")
  })

  it.each([
    ["automation is already running", "自动化正在运行中"],
    ["automation is disabled", "自动化已停用"],
    ["legacy automation cannot run", "旧版自动化不可运行"],
    ["run conditions not met", "不满足运行条件"],
    ["trigger runtime guard skipped run", "当前触发条件未满足"],
    ["automation is already running (deliveryId: test-delivery)", "自动化正在运行中\n投递 ID：test-delivery"],
    ["历史自定义跳过原因", "历史自定义跳过原因"],
  ])("presents the skipped reason %s without calling it an error", async (error, label) => {
    api.list.mockResolvedValue([{ ...run("skipped"), result: undefined, error }])
    await act(async () => root.render(<AutomationRunsPanel item={item} busy={false} onStopRun={vi.fn()} />))
    await act(async () => button("查看结果").click())
    expect(document.body.textContent).toContain("跳过原因")
    expect(document.body.textContent).toContain(label)
    expect(document.body.textContent).not.toContain("错误")
  })

  it("reveals failure output when an existing running record finishes", async () => {
    api.list.mockResolvedValueOnce([run("running")]).mockResolvedValueOnce([run("failed")])
    await act(async () => root.render(<AutomationRunsPanel item={item} busy={false} onStopRun={vi.fn()} />))
    await act(async () => api.listener?.({ automationId: "a1", reason: "run-finished" }))
    expect(document.body.textContent).toContain("完整执行结果")
  })
  it("keeps a requested stop pending until a terminal run state arrives", async () => {
    api.list.mockResolvedValue([run("running")])
    await act(async () => root.render(<AutomationRunsPanel item={item} busy={false} onStopRun={vi.fn().mockResolvedValue(undefined)} />))
    await act(async () => button("停止").click())
    expect(button("停止").disabled).toBe(true)
    api.list.mockResolvedValueOnce([run("cancelled")])
    await act(async () => api.listener?.({ automationId: "a1", reason: "run-stopped" }))
    expect(document.body.textContent).not.toContain("正在停止")
  })
  it("clears a failed stop once the run finishes independently", async () => {
    api.list.mockResolvedValueOnce([run("running")]).mockResolvedValueOnce([run("success")])
    await act(async () => root.render(<AutomationRunsPanel item={item} busy={false} onStopRun={vi.fn().mockRejectedValue(new Error("offline"))} />))
    await act(async () => button("停止").click())
    expect(document.body.textContent).toContain("停止失败")
    await act(async () => api.listener?.({ automationId: "a1", reason: "run-finished" }))
    expect(document.body.textContent).not.toContain("停止失败")
  })
  it("refreshes the current task on run events and keeps prior results while refreshing or failing", async () => {
    api.list.mockResolvedValueOnce([run()])
    await act(async () => root.render(<AutomationRunsPanel item={item} busy={false} onStopRun={vi.fn()} />))
    expect(document.querySelectorAll("ol > li")).toHaveLength(1)
    let reject!: (error: Error) => void
    api.list.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail }))
    await act(async () => api.listener?.({ automationId: "other", reason: "run-finished" }))
    expect(api.list).toHaveBeenCalledTimes(1)
    await act(async () => api.listener?.({ automationId: "a1", reason: "run-finished" }))
    expect(api.list).toHaveBeenCalledTimes(2)
    expect(document.querySelectorAll("ol > li")).toHaveLength(1)
    await act(async () => reject(new Error("offline")))
    expect(document.querySelectorAll("ol > li")).toHaveLength(1)
    expect(document.body.textContent).toContain("读取历史失败")
  })
  it("collapses successful output until requested and labels the history range", async () => {
    api.list.mockResolvedValue([run()])
    await act(async () => root.render(<AutomationRunsPanel item={item} busy={false} onStopRun={vi.fn()} />))
    expect(document.body.textContent).toContain("最近 100 条")
    expect(document.body.textContent).not.toContain("完整执行结果")
    await act(async () => button("查看结果").click())
    expect(document.body.textContent).toContain("完整执行结果")
  })
  it("prevents repeated stop requests and retries the failed stop rather than loading history", async () => {
    api.list.mockResolvedValue([run("running")])
    let reject!: (error: Error) => void
    const stop = vi.fn().mockImplementationOnce(() => new Promise((_, fail) => { reject = fail })).mockResolvedValue(undefined)
    await act(async () => root.render(<AutomationRunsPanel item={item} busy={false} onStopRun={stop} />))
    await act(async () => button("停止").click())
    expect(button("停止").disabled).toBe(true)
    await act(async () => reject(new Error("offline")))
    await act(async () => button("重试停止").click())
    expect(stop).toHaveBeenCalledTimes(2)
    expect(api.list).toHaveBeenCalledTimes(2)
  })
})
