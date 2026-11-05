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
