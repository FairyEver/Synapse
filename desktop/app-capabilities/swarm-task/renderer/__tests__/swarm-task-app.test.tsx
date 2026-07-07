/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { SwarmRun, SwarmTask, SwarmWorkerRun } from "../../shared/schema"

const swarmTaskFixtures = vi.hoisted(() => {
  const task: SwarmTask = {
    id: "task-1",
    schemaVersion: 1,
    name: "巡检",
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

  const run: SwarmRun = {
    id: "run-1",
    schemaVersion: 1,
    taskId: "task-1",
    status: "running",
    configSnapshot: task.currentConfig,
    startedAt: "2026-07-07T00:10:00.000Z",
    totals: { started: 1, success: 0, failed: 0, cancelled: 0, timeout: 0 },
    stopRequested: false,
  }

  const worker: SwarmWorkerRun = {
    id: "worker-1",
    schemaVersion: 1,
    taskId: "task-1",
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

  return { task, run, worker }
})

const swarmTaskBridge = vi.hoisted(() => ({
  listTasks: vi.fn(async () => [swarmTaskFixtures.task]),
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
  swarmTaskBridge.startRun.mockClear()
  swarmTaskBridge.listRuns.mockClear()
  swarmTaskBridge.listWorkerRuns.mockClear()
  swarmTaskBridge.stopRefill.mockClear()
  swarmTaskBridge.cancelRun.mockClear()
  agentBridge.openConversation.mockClear()
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
  it("loads tasks and selects the first task", async () => {
    await renderModule()

    expect(swarmTaskBridge.listTasks).toHaveBeenCalled()
    expect(document.body.textContent).toContain("巡检")
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
      platform: "automation",
    })
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
