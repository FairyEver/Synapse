import { describe, expect, it } from "vitest"

import {
  appendDiagnosticsCheck,
  buildDiagnosticsSummary,
  createRendererMainRoundtripCheck,
} from "@/lib/diagnostics-summary"
import type { SynapseDiagnosticsReport } from "@/types/diagnostics"

describe("diagnostics summary helpers", () => {
  it("builds markdown summary content", () => {
    const summary = buildDiagnosticsSummary(createReport())

    expect(summary).toContain("# Synapse Diagnostics Summary")
    expect(summary).toContain("版本：Synapse 0.2.49")
    expect(summary).toContain("## 异常项\n无")
  })

  it("includes Agent runtime log health in key checks", () => {
    const report = {
      ...createReport(),
      checks: [
        ...createReport().checks,
        {
          id: "logs.agent-runtime",
          group: "日志与配置",
          name: "Agent 日志",
          status: "ok",
          severity: "info",
          message: "未发现 Agent/SDK 风险日志",
        },
      ],
    } satisfies SynapseDiagnosticsReport

    const summary = buildDiagnosticsSummary(report)

    expect(summary).toContain("通过 日志与配置/Agent 日志：未发现 Agent/SDK 风险日志")
  })

  it("appends renderer-main roundtrip checks and refreshes report status", () => {
    const report = appendDiagnosticsCheck(
      createReport(),
      createRendererMainRoundtripCheck({
        durationMs: 1200,
        requestedAt: "2026-04-29T03:31:21.000Z",
        completedAt: "2026-04-29T03:31:22.200Z",
        mainReceivedAt: "2026-04-29T03:31:22.100Z",
      }),
    )

    expect(report.overallStatus).toBe("degraded")
    expect(report.summary).toMatchObject({ ok: 1, degraded: 1, failed: 0 })
    expect(report.checks.at(-1)).toMatchObject({
      id: "ipc.renderer-main.roundtrip",
      status: "degraded",
      message: "IPC 往返偏慢",
    })
  })
})

function createReport(): SynapseDiagnosticsReport {
  return {
    schemaVersion: 1,
    generatedAt: "2026-04-29T03:31:20.000Z",
    overallStatus: "ok",
    summary: { ok: 1, degraded: 0, failed: 0, skipped: 0 },
    system: {
      platform: "darwin",
    },
    app: {
      version: "0.2.49",
    },
    activeContext: {
      projectId: "project-1",
      projectName: "Project",
    },
    checks: [{
      id: "system.process",
      group: "系统",
      name: "进程",
      status: "ok",
      severity: "info",
      message: "通过",
    }],
  }
}
