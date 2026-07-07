import type { NamespaceSchema } from "../types"
import {
  swarmRunSchema,
  swarmTaskSchema,
  swarmWorkerRunSchema,
  type SwarmRun,
  type SwarmTask,
  type SwarmWorkerRun,
} from "../../../../app-capabilities/swarm-task/shared/schema"

export const SWARM_TASKS_NAMESPACE = "app.swarm-task.tasks" as const
export const SWARM_TASK_RUNS_NAMESPACE = "app.swarm-task.runs" as const
export const SWARM_TASK_WORKER_RUNS_NAMESPACE = "app.swarm-task.worker-runs" as const

export type SwarmTaskEntryV1 = SwarmTask
export type SwarmRunEntryV1 = SwarmRun
export type SwarmWorkerRunEntryV1 = SwarmWorkerRun

export const swarmTaskTasksSchemaDefinition: NamespaceSchema<SwarmTaskEntryV1> = {
  name: SWARM_TASKS_NAMESPACE,
  currentVersion: 1,
  backend: "sqlite",
  validate(value: unknown) {
    return swarmTaskSchema.parse(value)
  },
}

export const swarmTaskRunsSchemaDefinition: NamespaceSchema<SwarmRunEntryV1> = {
  name: SWARM_TASK_RUNS_NAMESPACE,
  currentVersion: 1,
  backend: "sqlite",
  validate(value: unknown) {
    return swarmRunSchema.parse(value)
  },
}

export const swarmTaskWorkerRunsSchemaDefinition: NamespaceSchema<SwarmWorkerRunEntryV1> = {
  name: SWARM_TASK_WORKER_RUNS_NAMESPACE,
  currentVersion: 1,
  backend: "sqlite",
  validate(value: unknown) {
    return swarmWorkerRunSchema.parse(value)
  },
}
