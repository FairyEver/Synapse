import { describe, expect, it } from "vitest"
import {
  swarmTaskRunsSchemaDefinition,
  swarmTaskTasksSchemaDefinition,
  swarmTaskWorkerRunsSchemaDefinition,
} from "../schemas/swarm-task"
import { allSchemas } from "../schemas"
import { normalizeSwarmTaskConfig } from "../../../../app-capabilities/swarm-task/shared/schema"

const baseConfig = {
  projectId: "project-1",
  prompt: "Run the task.",
  presetId: "general",
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
  runMode: "continuous",
  concurrency: 3,
  maxRounds: 9,
  agent: {
    providerId: "provider-1",
    modelTier: "default",
    permissionMode: "default",
    mainThreadPersonaId: null,
  },
}

const legacyConfig = {
  projectId: "project-1",
  workspacePath: "/Users/liyang/Documents/code/github/Synapse",
  prompt: "Run the task.",
  presetId: "general",
  injectOptions: {
    workerIdentity: true,
    roundContext: true,
    runContext: true,
    outputProtocol: true,
    parallelContext: true,
    gitContext: false,
    customAppendix: "Legacy appendix.",
  },
  runMode: "continuous",
  concurrency: 3,
  maxRounds: 9,
  output: {
    mode: "target-file",
    targetFile: "reports/legacy.md",
    targetFilePolicy: "section-update",
  },
  summary: {
    enabled: true,
    injectRecent: true,
    recentLimit: 5,
  },
  handoff: {
    enabled: true,
  },
  agent: {},
}

describe("swarm task DataRepository schemas", () => {
  it("registers task, run, and worker namespaces", () => {
    expect(allSchemas.map((schema) => schema.name)).toContain("app.swarm-task.tasks")
    expect(allSchemas.map((schema) => schema.name)).toContain("app.swarm-task.runs")
    expect(allSchemas.map((schema) => schema.name)).toContain("app.swarm-task.worker-runs")
  })

  it("validates a new pure-executor task config", () => {
    const entry = {
      id: "task-1",
      schemaVersion: 1,
      name: "巡检",
      description: "",
      currentConfig: baseConfig,
      createdAt: "2026-07-07T00:00:00.000Z",
      updatedAt: "2026-07-07T00:00:00.000Z",
      lastRunId: "run-1",
      lastStatus: "success",
    }

    expect(swarmTaskTasksSchemaDefinition.validate(entry)).toBe(true)
  })

  it("normalizes legacy injection fields to promptInjection", () => {
    const config = normalizeSwarmTaskConfig(legacyConfig)

    expect(config.promptInjection).toEqual({
      sequenceBatch: { enabled: true },
      previousHandoff: { enabled: true },
      summary: { enabled: true, injectRecent: true, recentLimit: 5 },
      fileWrite: {
        enabled: true,
        path: "reports/legacy.md",
        mode: "update",
        lock: { enabled: true },
      },
      customAppendix: "Legacy appendix.",
    })
    expect("workspacePath" in config).toBe(false)
    expect("output" in config).toBe(false)
    expect("injectOptions" in config).toBe(false)
    expect("summaryFile" in config).toBe(false)
    expect("handoff" in config).toBe(false)
  })

  it("keeps new task defaults as pure executor", () => {
    const config = normalizeSwarmTaskConfig({
      projectId: "project-1",
      prompt: "Run the task.",
    })

    expect(config.promptInjection).toEqual({
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
    })
  })

  it("validates a legacy task entry through normalization", () => {
    const entry = {
      id: "task-1",
      schemaVersion: 1,
      name: "巡检",
      currentConfig: legacyConfig,
      createdAt: "2026-07-07T00:00:00.000Z",
      updatedAt: "2026-07-07T00:00:00.000Z",
    }

    expect(swarmTaskTasksSchemaDefinition.validate(entry)).toBe(true)
  })

  it("normalizes legacy summary file config to fileWrite", () => {
    const config = normalizeSwarmTaskConfig({
      ...legacyConfig,
      output: undefined,
      summaryFile: {
        enabled: true,
        path: "reports/swarm.md",
      },
    })

    expect(config.promptInjection.fileWrite).toEqual({
      enabled: true,
      path: "reports/swarm.md",
      mode: "append-only",
      lock: { enabled: true },
    })
  })

  it("validates a run snapshot", () => {
    const entry = {
      id: "run-1",
      schemaVersion: 1,
      taskId: "task-1",
      status: "running",
      configSnapshot: baseConfig,
      startedAt: "2026-07-07T00:00:00.000Z",
      totals: { started: 1, success: 0, failed: 0, cancelled: 0, timeout: 0 },
      outputDirectory: "/tmp/swarm-runs/run-1",
      stopRequested: false,
    }

    expect(swarmTaskRunsSchemaDefinition.validate(entry)).toBe(true)
  })

  it("validates a worker run", () => {
    const entry = {
      id: "worker-1",
      schemaVersion: 1,
      taskId: "task-1",
      runId: "run-1",
      workerIndex: 1,
      roundIndex: 1,
      sequenceIndex: 1,
      slotIndex: 1,
      batchIndex: 1,
      status: "running",
      conversationId: "conversation-1",
      sessionKey: "swarm:task-1:run-1",
      startedAt: "2026-07-07T00:00:00.000Z",
      lastPhase: "thinking",
      lastMessage: "思考",
    }

    expect(swarmTaskWorkerRunsSchemaDefinition.validate(entry)).toBe(true)
  })

  it("rejects invalid legacy output policies", () => {
    const entry = {
      id: "task-1",
      schemaVersion: 1,
      name: "bad",
      currentConfig: {
        ...legacyConfig,
        output: { mode: "target-file", targetFilePolicy: "overwrite" },
      },
      createdAt: "2026-07-07T00:00:00.000Z",
      updatedAt: "2026-07-07T00:00:00.000Z",
    }

    expect(swarmTaskTasksSchemaDefinition.validate(entry)).toBe(false)
  })

  it("rejects enabled file write paths outside the project", () => {
    const entry = {
      id: "task-1",
      schemaVersion: 1,
      name: "bad",
      currentConfig: {
        ...baseConfig,
        promptInjection: {
          ...baseConfig.promptInjection,
          fileWrite: {
            enabled: true,
            path: "../outside.md",
            mode: "append-only",
            lock: { enabled: true },
          },
        },
      },
      createdAt: "2026-07-07T00:00:00.000Z",
      updatedAt: "2026-07-07T00:00:00.000Z",
    }

    expect(swarmTaskTasksSchemaDefinition.validate(entry)).toBe(false)
  })
})
