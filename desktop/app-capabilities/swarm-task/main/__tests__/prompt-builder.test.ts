import { describe, expect, it } from "vitest"
import {
  buildSwarmWorkerPrompt,
  extractSwarmStructuredOutput,
  SWARM_PREVIOUS_HANDOFF_MAX_BYTES,
  SWARM_PREVIOUS_HANDOFF_MAX_ITEMS,
} from "../prompt-builder"
import type { SwarmTaskConfig, SwarmWorkerRun } from "../../shared/schema"

const config: SwarmTaskConfig = {
  projectId: "project-1",
  prompt: "检查当前模块并处理一个真实问题。",
  presetId: "general",
  promptInjection: {
    sequenceBatch: { enabled: true },
    previousHandoff: { enabled: true },
    summary: { enabled: true, injectRecent: true, recentLimit: 2 },
    fileWrite: {
      enabled: true,
      path: "reports/swarm.md",
      mode: "append-only",
      lock: { enabled: true },
    },
    customAppendix: "额外规则：保持改动很小。",
  },
  runMode: "continuous",
  concurrency: 4,
  maxRounds: 8,
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
    sequenceIndex: 1,
    slotIndex: 1,
    batchIndex: 1,
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
    sequenceIndex: 2,
    slotIndex: 2,
    batchIndex: 1,
    status: "success",
    sessionKey: "swarm:task-1:run-1",
    summary: "第二轮补了测试。",
  },
]

describe("buildSwarmWorkerPrompt", () => {
  it("builds enabled prompt injection sections in a stable order", () => {
    const prompt = buildSwarmWorkerPrompt({
      taskId: "task-1",
      runId: "run-1",
      workerIndex: 3,
      roundIndex: 3,
      sequenceIndex: 3,
      slotIndex: 3,
      batchIndex: 1,
      config,
      recentSummaries,
      previousHandoffs: [
        { workerIndex: 1, sequenceIndex: 1, slotIndex: 1, batchIndex: 1, handoff: "下一轮继续看 service.ts。" },
      ],
    })

    expect(prompt.indexOf("## Swarm Sequence")).toBeLessThan(prompt.indexOf("## Recent Summaries"))
    expect(prompt.indexOf("## Recent Summaries")).toBeLessThan(prompt.indexOf("## Previous Handoff"))
    expect(prompt.indexOf("## Previous Handoff")).toBeLessThan(prompt.indexOf("## File Write Rules"))
    expect(prompt.indexOf("## File Write Rules")).toBeLessThan(prompt.indexOf("## Prompt Appendix"))
    expect(prompt.indexOf("## Prompt Appendix")).toBeLessThan(prompt.indexOf("## User Prompt"))
    expect(prompt.indexOf("## User Prompt")).toBeLessThan(prompt.indexOf("## Structured Ending Protocol"))
    expect(prompt).toContain("sequenceIndex: 3")
    expect(prompt).toContain("slotIndex: 3")
    expect(prompt).toContain("batchIndex: 1")
    expect(prompt).toContain("concurrency: 4")
    expect(prompt).toContain("reports/swarm.md")
    expect(prompt).toContain("Mode: append-only")
    expect(prompt).toContain("Only append new content to the end of the file.")
    expect(prompt).toContain("reports/swarm.md.lock")
    expect(prompt).toContain("第一轮确认入口文件。")
    expect(prompt).toContain("第二轮补了测试。")
    expect(prompt).toContain("下一轮继续看 service.ts。")
    expect(prompt).toContain("检查当前模块并处理一个真实问题。")
    expect(prompt).toContain("<SYNAPSE_SWARM_SUMMARY>")
    expect(prompt).toContain("<SYNAPSE_SWARM_HANDOFF>")
  })

  it("omits all optional injection sections by default", () => {
    const prompt = buildSwarmWorkerPrompt({
      taskId: "task-1",
      runId: "run-1",
      workerIndex: 1,
      roundIndex: 1,
      sequenceIndex: 1,
      slotIndex: 1,
      batchIndex: 1,
      config: {
        ...config,
        promptInjection: {
          sequenceBatch: { enabled: false },
          previousHandoff: { enabled: false },
          summary: { enabled: false, injectRecent: false, recentLimit: 3 },
          fileWrite: {
            enabled: false,
            path: "",
            mode: "append-only",
            lock: { enabled: true },
          },
          customAppendix: "",
        },
      },
      recentSummaries,
      previousHandoffs: [
        { workerIndex: 1, sequenceIndex: 1, slotIndex: 1, batchIndex: 1, handoff: "ignored" },
      ],
    })

    expect(prompt).not.toContain("## Swarm Sequence")
    expect(prompt).not.toContain("## Recent Summaries")
    expect(prompt).not.toContain("## Previous Handoff")
    expect(prompt).not.toContain("## File Write Rules")
    expect(prompt).not.toContain("## Prompt Appendix")
    expect(prompt).not.toContain("<SYNAPSE_SWARM_SUMMARY>")
    expect(prompt).not.toContain("<SYNAPSE_SWARM_HANDOFF>")
    expect(prompt).toContain("## User Prompt")
  })

  it("bounds aggregate previous handoff context and marks truncation", () => {
    const previousHandoffs = Array.from({ length: SWARM_PREVIOUS_HANDOFF_MAX_ITEMS + 5 }, (_, index) => ({
      workerIndex: index + 1,
      sequenceIndex: index + 1,
      slotIndex: index + 1,
      batchIndex: 1,
      handoff: `handoff-${index + 1}-${"密".repeat(64 * 1024)}-tail-${index + 1}`,
    }))
    const prompt = buildSwarmWorkerPrompt({
      taskId: "task-1",
      runId: "run-1",
      workerIndex: 1,
      roundIndex: 2,
      sequenceIndex: 26,
      slotIndex: 1,
      batchIndex: 2,
      config: {
        ...config,
        promptInjection: {
          sequenceBatch: { enabled: false },
          previousHandoff: { enabled: true },
          summary: { enabled: false, injectRecent: false, recentLimit: 3 },
          fileWrite: { enabled: false, path: "", mode: "append-only", lock: { enabled: true } },
          customAppendix: "",
        },
      },
      recentSummaries: [],
      previousHandoffs,
    })

    expect(prompt).toContain("[5 earlier handoffs omitted]")
    expect(prompt).toContain("[handoff truncated to fit the context budget]")
    expect(prompt).not.toContain("### sequence 5,")
    expect(prompt).toContain("### sequence 6,")
    expect(prompt).not.toContain("-tail-25")
    expect(new TextEncoder().encode(prompt).byteLength)
      .toBeLessThanOrEqual(SWARM_PREVIOUS_HANDOFF_MAX_BYTES + 8 * 1024)
  })

  it("injects update-mode file write rules without lock when lock is disabled", () => {
    const prompt = buildSwarmWorkerPrompt({
      taskId: "task-1",
      runId: "run-1",
      workerIndex: 1,
      roundIndex: 1,
      sequenceIndex: 1,
      slotIndex: 1,
      batchIndex: 1,
      config: {
        ...config,
        promptInjection: {
          ...config.promptInjection,
          sequenceBatch: { enabled: false },
          previousHandoff: { enabled: false },
          summary: { enabled: false, injectRecent: false, recentLimit: 3 },
          fileWrite: {
            enabled: true,
            path: "reports/swarm.md",
            mode: "update",
            lock: { enabled: false },
          },
          customAppendix: "",
        },
      },
      recentSummaries: [],
      previousHandoffs: [],
    })

    expect(prompt).toContain("Mode: update")
    expect(prompt).toContain("You may insert, modify, reorganize, or delete existing content")
    expect(prompt).not.toContain(".lock")
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
