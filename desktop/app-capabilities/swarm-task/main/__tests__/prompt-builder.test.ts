import { describe, expect, it } from "vitest"
import {
  buildSwarmWorkerPrompt,
  extractSwarmStructuredOutput,
  fallbackSummary,
} from "../prompt-builder"
import type { SwarmTaskConfig, SwarmWorkerRun } from "../../shared/schema"

const config: SwarmTaskConfig = {
  projectId: "project-1",
  workspacePath: "/repo",
  prompt: "检查当前模块并处理一个真实问题。",
  presetId: "general",
  injectOptions: {
    workerIdentity: true,
    roundContext: true,
    runContext: true,
    outputProtocol: true,
    parallelContext: true,
    gitContext: true,
    customAppendix: "额外规则：保持改动很小。",
  },
  runMode: "continuous",
  concurrency: 4,
  maxRounds: 8,
  output: {
    mode: "both",
    managedDirectory: "/repo/swarm-runs/run-1",
    targetFile: "/repo/report.md",
    targetFilePolicy: "append-only",
  },
  summary: {
    enabled: true,
    injectRecent: true,
    recentLimit: 2,
  },
  handoff: {
    enabled: true,
  },
  agent: {},
}

const recentSummaries: SwarmWorkerRun[] = [
  {
    id: "worker-1",
    schemaVersion: 1,
    taskId: "task-1",
    runId: "run-1",
    workerIndex: 1,
    roundIndex: 1,
    status: "success",
    sessionKey: "swarm:task-1:run-1",
    summary: "第一轮确认入口文件。",
  },
  {
    id: "worker-2",
    schemaVersion: 1,
    taskId: "task-1",
    runId: "run-1",
    workerIndex: 2,
    roundIndex: 2,
    status: "success",
    sessionKey: "swarm:task-1:run-1",
    summary: "第二轮补了测试。",
  },
]

describe("buildSwarmWorkerPrompt", () => {
  it("builds prompt sections in a stable order", () => {
    const prompt = buildSwarmWorkerPrompt({
      taskId: "task-1",
      runId: "run-1",
      workerIndex: 3,
      roundIndex: 3,
      config,
      recentSummaries,
      previousHandoff: "下一轮继续看 service.ts。",
    })

    expect(prompt.indexOf("## Swarm Runtime Context")).toBeLessThan(prompt.indexOf("## Recent Summaries"))
    expect(prompt.indexOf("## Recent Summaries")).toBeLessThan(prompt.indexOf("## Previous Handoff"))
    expect(prompt.indexOf("## Previous Handoff")).toBeLessThan(prompt.indexOf("## Output Protocol"))
    expect(prompt.indexOf("## User Prompt")).toBeLessThan(prompt.indexOf("## Structured Ending Protocol"))
    expect(prompt).toContain("Worker: 3/4")
    expect(prompt).toContain("Round: 3")
    expect(prompt).toContain("Run mode: continuous")
    expect(prompt).toContain("/repo/swarm-runs/run-1")
    expect(prompt).toContain("/repo/report.md")
    expect(prompt).toContain("Write policy: append-only")
    expect(prompt).toContain("第一轮确认入口文件。")
    expect(prompt).toContain("第二轮补了测试。")
    expect(prompt).toContain("下一轮继续看 service.ts。")
    expect(prompt).toContain("检查当前模块并处理一个真实问题。")
    expect(prompt).toContain("<SYNAPSE_SWARM_SUMMARY>")
    expect(prompt).toContain("<SYNAPSE_SWARM_HANDOFF>")
  })

  it("omits disabled summary and handoff sections", () => {
    const prompt = buildSwarmWorkerPrompt({
      taskId: "task-1",
      runId: "run-1",
      workerIndex: 1,
      roundIndex: 1,
      config: {
        ...config,
        summary: { enabled: false, injectRecent: false, recentLimit: 3 },
        handoff: { enabled: false },
      },
      recentSummaries,
      previousHandoff: "ignored",
    })

    expect(prompt).not.toContain("## Recent Summaries")
    expect(prompt).not.toContain("## Previous Handoff")
    expect(prompt).not.toContain("<SYNAPSE_SWARM_SUMMARY>")
    expect(prompt).not.toContain("<SYNAPSE_SWARM_HANDOFF>")
  })
})

describe("extractSwarmStructuredOutput", () => {
  it("extracts summary and handoff blocks", () => {
    const result = extractSwarmStructuredOutput([
      "normal output",
      "<SYNAPSE_SWARM_SUMMARY>",
      "本轮完成测试。",
      "</SYNAPSE_SWARM_SUMMARY>",
      "<SYNAPSE_SWARM_HANDOFF>",
      "下一轮看 UI。",
      "</SYNAPSE_SWARM_HANDOFF>",
    ].join("\n"))

    expect(result.summary).toBe("本轮完成测试。")
    expect(result.handoff).toBe("下一轮看 UI。")
  })

  it("returns undefined values when blocks are missing", () => {
    expect(extractSwarmStructuredOutput("plain result")).toEqual({})
  })
})

describe("fallbackSummary", () => {
  it("trims long final output", () => {
    expect(fallbackSummary("a".repeat(20), 8)).toBe("aaaaaaaa")
  })
})
