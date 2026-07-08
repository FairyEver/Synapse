import { describe, expect, it } from "vitest"

import { swarmTaskConfigSchema } from "../schema"

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
})
