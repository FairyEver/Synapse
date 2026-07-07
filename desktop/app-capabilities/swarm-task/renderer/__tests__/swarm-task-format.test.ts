import { describe, expect, it } from "vitest"
import type { SwarmRun } from "../../shared/schema"
import {
  formatOutputMode,
  formatRunMode,
  formatRunStatus,
  formatRunTotals,
  formatTimestamp,
  formatWorkerPhase,
  formatWorkerStatus,
} from "../swarm-task-format"

describe("swarm task format helpers", () => {
  it("formats run and worker states for the renderer", () => {
    expect(formatRunStatus("running")).toBe("运行中")
    expect(formatRunStatus("draining")).toBe("收尾中")
    expect(formatRunStatus("failed")).toBe("失败")
    expect(formatRunStatus(undefined)).toBe("-")
    expect(formatWorkerStatus("queued")).toBe("排队中")
    expect(formatWorkerStatus("timeout")).toBe("超时")
    expect(formatWorkerPhase("permission")).toBe("权限")
    expect(formatWorkerPhase(undefined)).toBe("-")
  })

  it("formats task config labels and timestamps", () => {
    expect(formatRunMode("batch")).toBe("批量")
    expect(formatRunMode("continuous")).toBe("持续")
    expect(formatOutputMode("managed-directory")).toBe("目录")
    expect(formatOutputMode("target-file")).toBe("文件")
    expect(formatOutputMode("both")).toBe("目录 + 文件")
    expect(formatTimestamp("2026-07-07T00:10:00.000Z")).toBe("2026-07-07 00:10")
    expect(formatTimestamp(undefined)).toBe("-")
  })

  it("formats run totals in one compact line", () => {
    const run: SwarmRun = {
      id: "run-1",
      schemaVersion: 1,
      taskId: "task-1",
      status: "partial",
      startedAt: "2026-07-07T00:10:00.000Z",
      stopRequested: false,
      configSnapshot: {
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
      totals: { started: 4, success: 3, failed: 1, cancelled: 0, timeout: 0 },
    }

    expect(formatRunTotals(run)).toBe("已启动 4 · 成功 3 · 失败 1 · 取消 0 · 超时 0")
    expect(formatRunTotals(null)).toBe("已启动 0 · 成功 0 · 失败 0 · 取消 0 · 超时 0")
  })
})
