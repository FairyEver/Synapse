import { describe, expect, it } from "vitest"

import {
  SWARM_MCP_WORKER_RUN_PAGE_SIZE,
  SWARM_TASK_DEFAULT_CONCURRENCY,
  SWARM_TASK_DEFAULT_MAX_ROUNDS,
  SWARM_WORKER_RUN_PAGE_SIZE,
  swarmRunGetInputSchema,
  swarmTaskConfigSchema,
  swarmWorkerRunListInputSchema,
} from "../schema"

const baseConfig = {
  projectId: "project-1",
  prompt: "Run.",
  presetId: "general",
  promptInjection: {
    sequenceBatch: { enabled: false },
    previousHandoff: { enabled: false },
    summary: { enabled: false, injectRecent: false, recentLimit: 3 },
    fileWrite: {
      enabled: true,
      path: "reports/swarm.md",
      mode: "append-only",
      lock: { enabled: true },
    },
    customAppendix: "",
  },
  runMode: "batch",
  concurrency: 2,
  maxRounds: 2,
  agent: {},
}

describe("swarmTaskConfigSchema", () => {
  it("defaults current configs to one planned worker", () => {
    const parsed = swarmTaskConfigSchema.parse({
      projectId: "project-1",
      prompt: "Run.",
    })

    expect(parsed.concurrency).toBe(SWARM_TASK_DEFAULT_CONCURRENCY)
    expect(parsed.maxRounds).toBe(SWARM_TASK_DEFAULT_MAX_ROUNDS)
  })

  it("preserves legacy worker-count defaults during normalization", () => {
    const parsed = swarmTaskConfigSchema.parse({
      projectId: "project-1",
      prompt: "Run.",
      injectOptions: { workerIdentity: true },
    })

    expect(parsed.concurrency).toBe(3)
    expect(parsed.maxRounds).toBe(3)
  })

  it("accepts project-relative file write paths", () => {
    expect(swarmTaskConfigSchema.parse(baseConfig).promptInjection.fileWrite.path)
      .toBe("reports/swarm.md")
  })

  it.each([
    "/Users/liyang/Downloads/demo.md",
    "C:\\Users\\liyang\\Downloads\\demo.md",
    "C:Downloads\\demo.md",
    "\\\\server\\share\\demo.md",
  ])("rejects non-project-relative file write path %s", (fileWritePath) => {
    expect(() => swarmTaskConfigSchema.parse({
      ...baseConfig,
      promptInjection: {
        ...baseConfig.promptInjection,
        fileWrite: {
          ...baseConfig.promptInjection.fileWrite,
          path: fileWritePath,
        },
      },
    })).toThrow()
  })

  it("rejects parent traversal in file write paths", () => {
    expect(() => swarmTaskConfigSchema.parse({
      ...baseConfig,
      promptInjection: {
        ...baseConfig.promptInjection,
        fileWrite: {
          ...baseConfig.promptInjection.fileWrite,
          path: "../demo.md",
        },
      },
    })).toThrow()
  })

  it("bounds worker run page requests", () => {
    expect(swarmWorkerRunListInputSchema.parse({ runId: "run-1" })).toEqual({
      runId: "run-1",
      offset: 0,
      limit: SWARM_WORKER_RUN_PAGE_SIZE,
    })
    expect(() => swarmWorkerRunListInputSchema.parse({ runId: "run-1", limit: 201 })).toThrow()
  })

  it("defaults and bounds MCP run worker pages", () => {
    expect(swarmRunGetInputSchema.parse({ taskId: "task-1", runId: "run-1" })).toEqual({
      taskId: "task-1",
      runId: "run-1",
      workerOffset: 0,
      workerLimit: SWARM_MCP_WORKER_RUN_PAGE_SIZE,
    })
    expect(() => swarmRunGetInputSchema.parse({
      taskId: "task-1",
      runId: "run-1",
      workerLimit: 201,
    })).toThrow()
  })
})
