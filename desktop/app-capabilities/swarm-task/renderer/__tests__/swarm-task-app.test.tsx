/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ReactNode } from "react"
import type { SwarmRun, SwarmTask, SwarmWorkerRun } from "../../shared/schema"

const swarmTaskFixtures = vi.hoisted(() => {
  const taskA: SwarmTask = {
    id: "task-1",
    schemaVersion: 1,
    name: "任务 A",
    currentConfig: {
      projectId: "project-1",
      workspacePath: "/repo",
      prompt: "Run.",
      presetId: "general",
      injectOptions: {
        workerIdentity: true,
        roundContext: true,
        runContext: true,
        outputProtocol: true,
        parallelContext: true,
        gitContext: false,
        customAppendix: "",
      },
      runMode: "batch",
      concurrency: 2,
      maxRounds: 2,
      output: { mode: "managed-directory", targetFilePolicy: "append-only" },
      summary: { enabled: true, injectRecent: false, recentLimit: 3 },
      handoff: { enabled: false },
      agent: {},
    },
    createdAt: "2026-07-07T00:00:00.000Z",
    updatedAt: "2026-07-07T00:00:00.000Z",
    lastRunId: "run-1",
    lastStatus: "running",
  }

  const taskB: SwarmTask = {
    id: "task-2",
    schemaVersion: 1,
    name: "任务 B",
    currentConfig: {
      projectId: "project-2",
      workspacePath: "/repo-b",
      prompt: "Run B.",
      presetId: "general",
      injectOptions: {
        workerIdentity: true,
        roundContext: true,
        runContext: true,
        outputProtocol: true,
        parallelContext: true,
        gitContext: false,
        customAppendix: "",
      },
      runMode: "batch",
      concurrency: 2,
      maxRounds: 2,
      output: { mode: "managed-directory", targetFilePolicy: "append-only" },
      summary: { enabled: true, injectRecent: false, recentLimit: 3 },
      handoff: { enabled: false },
      agent: {},
    },
    createdAt: "2026-07-07T00:00:00.000Z",
    updatedAt: "2026-07-07T00:00:00.000Z",
  }

  const run: SwarmRun = {
    id: "run-1",
    schemaVersion: 1,
    taskId: taskA.id,
    status: "running",
    configSnapshot: taskA.currentConfig,
    startedAt: "2026-07-07T00:10:00.000Z",
    totals: { started: 1, success: 0, failed: 0, cancelled: 0, timeout: 0 },
    stopRequested: false,
  }

  const runB: SwarmRun = {
    ...run,
    id: "run-2",
    taskId: taskB.id,
    status: "running",
    configSnapshot: taskB.currentConfig,
  }

  const drainingRun: SwarmRun = {
    ...run,
    status: "draining",
    stopRequested: true,
  }

  const worker: SwarmWorkerRun = {
    id: "worker-1",
    schemaVersion: 1,
    taskId: taskA.id,
    runId: "run-1",
    workerIndex: 1,
    roundIndex: 1,
    status: "running",
    conversationId: "conversation-1",
    sessionKey: "session-1",
    startedAt: "2026-07-07T00:11:00.000Z",
    lastPhase: "thinking",
    lastMessage: "处理中",
  }

  return { taskA, taskB, run, runB, drainingRun, worker }
})

const swarmTaskBridge = vi.hoisted(() => ({
  listTasks: vi.fn(async () => [swarmTaskFixtures.taskA, swarmTaskFixtures.taskB]),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  deleteTask: vi.fn(),
  startRun: vi.fn(async () => swarmTaskFixtures.run),
  stopRefill: vi.fn(async () => swarmTaskFixtures.run),
  cancelRun: vi.fn(async () => swarmTaskFixtures.run),
  listRuns: vi.fn(async () => [swarmTaskFixtures.run]),
  getRun: vi.fn(async () => swarmTaskFixtures.run),
  listWorkerRuns: vi.fn(async () => [swarmTaskFixtures.worker]),
}))

const agentBridge = vi.hoisted(() => ({
  openConversation: vi.fn(async () => ({ opened: true as const, conversationId: "conversation-1" })),
}))

const toast = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}))

vi.mock("@/lib/electron-bridge", () => ({
  requireBridgeDomain: (domain: string) => {
    if (domain === "swarmTask") return swarmTaskBridge
    if (domain === "agent") return agentBridge
    throw new Error(`Unexpected bridge domain: ${domain}`)
  },
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}))

vi.mock("@/modules/apps/components/system-app-window-shell", () => ({
  SystemAppWindowShell: ({
    tabs = [],
    value,
    onValueChange,
    actions,
    children,
  }: {
    tabs?: ReadonlyArray<{ id: string; label: string }>
    value?: string
    onValueChange?: (value: string) => void
    actions?: ReactNode
    children: ReactNode
  }) => (
    <div>
      <div>{actions}</div>
      <div>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={tab.id === value}
            onClick={() => onValueChange?.(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div>{children}</div>
    </div>
  ),
}))

vi.mock("sonner", () => ({ toast }))

import { SwarmTaskModule } from "../index"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
;(globalThis as typeof globalThis & { ResizeObserver: typeof ResizeObserver }).ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

let roots: Root[] = []

beforeEach(() => {
  swarmTaskBridge.listTasks.mockClear()
  swarmTaskBridge.listTasks.mockImplementation(async () => [swarmTaskFixtures.taskA, swarmTaskFixtures.taskB])
  swarmTaskBridge.startRun.mockClear()
  swarmTaskBridge.startRun.mockImplementation(async () => swarmTaskFixtures.run)
  swarmTaskBridge.createTask.mockClear()
  swarmTaskBridge.createTask.mockImplementation(async () => swarmTaskFixtures.taskA)
  swarmTaskBridge.listRuns.mockClear()
  swarmTaskBridge.listRuns.mockImplementation(async () => [swarmTaskFixtures.run])
  swarmTaskBridge.getRun.mockClear()
  swarmTaskBridge.getRun.mockImplementation(async () => swarmTaskFixtures.run)
  swarmTaskBridge.listWorkerRuns.mockClear()
  swarmTaskBridge.listWorkerRuns.mockImplementation(async () => [swarmTaskFixtures.worker])
  swarmTaskBridge.stopRefill.mockClear()
  swarmTaskBridge.stopRefill.mockImplementation(async () => swarmTaskFixtures.run)
  swarmTaskBridge.cancelRun.mockClear()
  swarmTaskBridge.cancelRun.mockImplementation(async () => swarmTaskFixtures.run)
  agentBridge.openConversation.mockClear()
  agentBridge.openConversation.mockImplementation(async () => ({ opened: true as const, conversationId: "conversation-1" }))
  toast.error.mockClear()
  toast.success.mockClear()
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

describe("SwarmTaskModule", () => {
  it("creates and selects a task from the empty state", async () => {
    swarmTaskBridge.listTasks.mockResolvedValueOnce([])
    swarmTaskBridge.createTask.mockResolvedValueOnce(swarmTaskFixtures.taskA)

    await renderModule()
    await clickButton("新建")

    expect(swarmTaskBridge.createTask).toHaveBeenCalledWith({
      name: "新建任务",
      config: {
        projectId: "project-id",
        workspacePath: "/path/to/workspace",
        prompt: "填写任务目标",
        presetId: "general",
        injectOptions: {
          workerIdentity: true,
          roundContext: true,
          runContext: true,
          outputProtocol: true,
          parallelContext: true,
          gitContext: false,
          customAppendix: "",
        },
        runMode: "batch",
        concurrency: 1,
        maxRounds: 1,
        output: { mode: "managed-directory", targetFilePolicy: "append-only" },
        summary: { enabled: true, injectRecent: false, recentLimit: 3 },
        handoff: { enabled: false },
        agent: {},
      },
    })
    expect(toast.success).toHaveBeenCalledWith("已创建")
    await waitForTextareaValue("Run.")
  })

  it("loads tasks and selects the first task", async () => {
    await renderModule()

    expect(swarmTaskBridge.listTasks).toHaveBeenCalled()
    expect(document.body.textContent).toContain("任务 A")
    expect(getTextarea()?.value).toBe("Run.")
    expect(document.body.textContent).toContain("运行中")
  })

  it("starts the selected task and opens worker conversations", async () => {
    await renderModule()

    await clickButton("运行")
    await clickButton("打开会话")

    expect(swarmTaskBridge.startRun).toHaveBeenCalledWith({ taskId: "task-1" })
    expect(agentBridge.openConversation).toHaveBeenCalledWith({
      projectId: "project-1",
      conversationId: "conversation-1",
      sessionKey: "session-1",
      platform: "swarm",
    })
  })

  it("shows errors when stop refill or cancel run fails", async () => {
    swarmTaskBridge.stopRefill.mockRejectedValueOnce(new Error("停止补位失败"))
    swarmTaskBridge.cancelRun.mockRejectedValueOnce(new Error("取消运行失败"))

    await renderModule()
    await clickTab("运行中")
    await waitForButton("停止补位")
    await waitForButton("取消运行")

    await clickButton("停止补位")
    await clickButton("取消运行")

    expect(swarmTaskBridge.stopRefill).toHaveBeenCalledWith("run-1")
    expect(swarmTaskBridge.cancelRun).toHaveBeenCalledWith("run-1")
    expect(toast.error).toHaveBeenCalledWith("停止补位失败")
    expect(toast.error).toHaveBeenCalledWith("取消运行失败")
  })

  it("can cancel a draining run", async () => {
    swarmTaskBridge.listRuns.mockImplementation(async () => [swarmTaskFixtures.drainingRun])
    swarmTaskBridge.getRun.mockImplementation(async () => swarmTaskFixtures.drainingRun)

    await renderModule()
    await clickTab("运行中")
    await waitForButton("取消运行")

    await clickButton("取消运行")

    expect(swarmTaskBridge.cancelRun).toHaveBeenCalledWith("run-1")
  })

  it("keeps the detail pane aligned with the filtered task selection", async () => {
    await renderModule()

    expect(getTextarea()?.value).toBe("Run.")

    await setSearchValue("任务 B")

    await waitForTextareaValue("Run B.")
    expect(document.body.textContent).toContain("任务 B")

    await clickButton("运行")

    expect(swarmTaskBridge.startRun).toHaveBeenCalledTimes(1)
    expect(swarmTaskBridge.startRun).toHaveBeenCalledWith({ taskId: "task-2" })
  })

  it("keeps search visible when the current query has no matches", async () => {
    await renderModule()

    await setSearchValue("missing")

    expect(getSearchInput()?.value).toBe("missing")
    expect(document.body.textContent).toContain("暂无匹配")
  })

  it("does not render stale workers while loading a newly selected task", async () => {
    let resolveTaskBRuns: ((runs: SwarmRun[]) => void) | null = null
    swarmTaskBridge.listRuns.mockImplementation(async ({ taskId }: { taskId: string }) => {
      if (taskId === "task-2") {
        return await new Promise<SwarmRun[]>((resolve) => {
          resolveTaskBRuns = resolve
        })
      }
      return [swarmTaskFixtures.run]
    })

    await renderModule()
    await clickTab("运行中")
    await waitForButton("打开会话")

    agentBridge.openConversation.mockClear()

    await clickTask("任务 B")
    await clickButton("打开会话")

    expect(agentBridge.openConversation).not.toHaveBeenCalled()

    await act(async () => {
      resolveTaskBRuns?.([])
      await Promise.resolve()
    })
  })

  it("does not render stale history when an older run request resolves late", async () => {
    let resolveTaskARuns: ((runs: SwarmRun[]) => void) | null = null
    let resolveTaskBRuns: ((runs: SwarmRun[]) => void) | null = null
    swarmTaskBridge.listRuns.mockImplementation(async ({ taskId }: { taskId: string }) => (
      await new Promise<SwarmRun[]>((resolve) => {
        if (taskId === "task-1") {
          resolveTaskARuns = resolve
          return
        }
        resolveTaskBRuns = resolve
      })
    ))

    await renderModule()
    await waitForTextareaValue("Run.")
    await clickTab("历史")
    await clickTask("任务 B")

    await act(async () => {
      resolveTaskARuns?.([swarmTaskFixtures.run])
      await Promise.resolve()
    })

    expect(document.body.textContent).not.toContain("running")

    await act(async () => {
      resolveTaskBRuns?.([])
      await Promise.resolve()
    })
  })

  it("keeps newer selected task run data when an older request resolves late", async () => {
    let resolveTaskARuns: ((runs: SwarmRun[]) => void) | null = null
    let resolveTaskBRuns: ((runs: SwarmRun[]) => void) | null = null
    swarmTaskBridge.listRuns.mockImplementation(async ({ taskId }: { taskId: string }) => (
      await new Promise<SwarmRun[]>((resolve) => {
        if (taskId === "task-1") {
          resolveTaskARuns = resolve
          return
        }
        resolveTaskBRuns = resolve
      })
    ))
    swarmTaskBridge.getRun.mockImplementation(async (runId: string) => (
      runId === "run-2" ? swarmTaskFixtures.runB : swarmTaskFixtures.run
    ))
    swarmTaskBridge.listWorkerRuns.mockImplementation(async (runId: string) => (
      runId === "run-2"
        ? [{ ...swarmTaskFixtures.worker, id: "worker-2", taskId: "task-2", runId: "run-2", lastMessage: "任务 B worker" }]
        : [swarmTaskFixtures.worker]
    ))

    await renderModule()
    await clickTab("运行中")
    await clickTask("任务 B")

    await act(async () => {
      resolveTaskBRuns?.([swarmTaskFixtures.runB])
      await Promise.resolve()
    })
    await waitForButton("打开会话")
    expect(document.body.textContent).toContain("任务 B worker")

    await act(async () => {
      resolveTaskARuns?.([swarmTaskFixtures.run])
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("任务 B worker")
    expect(document.body.textContent).toContain("任务 B")
  })

  it("shows an error when opening a worker conversation is not handled", async () => {
    agentBridge.openConversation.mockResolvedValueOnce({ opened: false, reason: "not-found" })

    await renderModule()
    await clickTab("运行中")
    await waitForButton("打开会话")

    await clickButton("打开会话")

    expect(toast.error).toHaveBeenCalledWith("会话不存在")
  })
})

async function renderModule(): Promise<void> {
  const root = createRoot(document.body.appendChild(document.createElement("div")))
  roots.push(root)
  await act(async () => {
    root.render(<SwarmTaskModule />)
    await Promise.resolve()
  })
}

async function clickButton(text: string, index = 0): Promise<void> {
  const buttons = Array.from(document.body.querySelectorAll("button"))
    .filter((button) => button.textContent?.trim() === text || button.getAttribute("aria-label") === text)
  await act(async () => {
    buttons[index]?.click()
    await Promise.resolve()
  })
}

function getTextarea(): HTMLTextAreaElement | null {
  return document.body.querySelector("textarea")
}

function getSearchInput(): HTMLInputElement | null {
  return document.body.querySelector('input[aria-label="搜索任务"]')
}

async function setSearchValue(value: string): Promise<void> {
  const input = getSearchInput()
  if (!(input instanceof HTMLInputElement)) {
    throw new Error("Search input not found")
  }

  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
    if (!setter) {
      throw new Error("Input value setter not found")
    }
    setter.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
    input.dispatchEvent(new Event("change", { bubbles: true }))
    await Promise.resolve()
  })
}

async function waitForTextareaValue(value: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (getTextarea()?.value === value) return
    await act(async () => {
      await Promise.resolve()
    })
  }
  throw new Error(`Textarea value not found: ${value}`)
}

async function clickTab(text: string): Promise<void> {
  const tab = Array.from(document.body.querySelectorAll("button"))
    .find((button) => button.getAttribute("role") === "tab" && button.textContent?.trim() === text)

  await act(async () => {
    tab?.click()
    await Promise.resolve()
  })
}

async function clickTask(text: string): Promise<void> {
  const taskButton = Array.from(document.body.querySelectorAll("button"))
    .find((button) => button.textContent?.includes(text))

  await act(async () => {
    taskButton?.click()
    await Promise.resolve()
  })
}

async function waitForButton(text: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const button = Array.from(document.body.querySelectorAll("button"))
      .find((item) => item.textContent?.trim() === text || item.getAttribute("aria-label") === text)
    if (button instanceof HTMLButtonElement) return
    await act(async () => {
      await Promise.resolve()
    })
  }
  throw new Error(`Button not found: ${text}`)
}
