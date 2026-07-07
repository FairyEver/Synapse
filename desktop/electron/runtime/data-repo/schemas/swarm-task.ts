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
  migrations: [],
  validate(value: unknown): value is SwarmTaskEntryV1 {
    return swarmTaskSchema.safeParse(value).success
  },
}

export const swarmTaskRunsSchemaDefinition: NamespaceSchema<SwarmRunEntryV1> = {
  name: SWARM_TASK_RUNS_NAMESPACE,
  currentVersion: 1,
  backend: "sqlite",
  migrations: [],
  validate(value: unknown): value is SwarmRunEntryV1 {
    return swarmRunSchema.safeParse(value).success
  },
}

export const swarmTaskWorkerRunsSchemaDefinition: NamespaceSchema<SwarmWorkerRunEntryV1> = {
  name: SWARM_TASK_WORKER_RUNS_NAMESPACE,
  currentVersion: 1,
  backend: "sqlite",
  migrations: [],
  validate(value: unknown): value is SwarmWorkerRunEntryV1 {
    return swarmWorkerRunSchema.safeParse(value).success
  },
}
