import { describe, expect, it } from "vitest"

import {
  SWARM_TASK_DEFAULT_CONCURRENCY,
  SWARM_TASK_DEFAULT_MAX_ROUNDS,
  SWARM_WORKER_RUN_PAGE_SIZE,
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

  it("accepts project-relative and absolute file write paths", () => {
    expect(swarmTaskConfigSchema.parse(baseConfig).promptInjection.fileWrite.path)
      .toBe("reports/swarm.md")

    expect(swarmTaskConfigSchema.parse({
      ...baseConfig,
      promptInjection: {
        ...baseConfig.promptInjection,
        fileWrite: {
          ...baseConfig.promptInjection.fileWrite,
          path: "/Users/liyang/Downloads/demo.md",
        },
      },
    }).promptInjection.fileWrite.path).toBe("/Users/liyang/Downloads/demo.md")
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
})
