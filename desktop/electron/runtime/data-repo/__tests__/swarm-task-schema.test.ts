import { describe, expect, it } from "vitest"
import {
  swarmTaskRunsSchemaDefinition,
  swarmTaskTasksSchemaDefinition,
  swarmTaskWorkerRunsSchemaDefinition,
} from "../schemas/swarm-task"
import { allSchemas } from "../schemas"

const baseConfig = {
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
    customAppendix: "",
  },
  runMode: "continuous",
  concurrency: 3,
  maxRounds: 9,
  output: {
    mode: "managed-directory",
    targetFilePolicy: "append-only",
  },
  summary: {
    enabled: true,
    injectRecent: true,
    recentLimit: 3,
  },
  handoff: {
    enabled: false,
  },
  agent: {
    providerId: "provider-1",
    modelTier: "default",
    permissionMode: "default",
    mainThreadPersonaId: null,
  },
}

describe("swarm task DataRepository schemas", () => {
  it("registers task, run, and worker namespaces", () => {
    expect(allSchemas.map((schema) => schema.name)).toContain("app.swarm-task.tasks")
    expect(allSchemas.map((schema) => schema.name)).toContain("app.swarm-task.runs")
    expect(allSchemas.map((schema) => schema.name)).toContain("app.swarm-task.worker-runs")
  })

  it("validates a task entry", () => {
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
      status: "running",
      conversationId: "conversation-1",
      sessionKey: "swarm:task-1:run-1",
      startedAt: "2026-07-07T00:00:00.000Z",
      lastPhase: "thinking",
      lastMessage: "思考",
    }

    expect(swarmTaskWorkerRunsSchemaDefinition.validate(entry)).toBe(true)
  })

  it("rejects invalid output policies", () => {
    const entry = {
      id: "task-1",
      schemaVersion: 1,
      name: "bad",
      currentConfig: {
        ...baseConfig,
        output: { mode: "target-file", targetFilePolicy: "overwrite" },
      },
      createdAt: "2026-07-07T00:00:00.000Z",
      updatedAt: "2026-07-07T00:00:00.000Z",
    }

    expect(swarmTaskTasksSchemaDefinition.validate(entry)).toBe(false)
  })
})
