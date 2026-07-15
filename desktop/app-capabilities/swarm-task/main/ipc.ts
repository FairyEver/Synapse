import { z } from "zod"

import type { IpcModule } from "../../../electron/runtime/ipc/types"
import { SWARM_TASK_SERVICE_ID } from "../shared/capability"
import {
  swarmRunIdInputSchema,
  swarmRunListInputSchema,
  swarmRunListResultSchema,
  swarmRunSchema,
  swarmRunStartInputSchema,
  swarmTaskChangedDomainEventSchema,
  swarmTaskCreateInputSchema,
  swarmTaskIdInputSchema,
  swarmTaskListResultSchema,
  swarmTaskSchema,
  swarmTaskUpdateInputSchema,
  swarmWorkerRunListResultSchema,
} from "../shared/schema"
import type { SwarmTaskService } from "./service"

function resolveSwarmTaskService(ctx: Parameters<IpcModule["methods"][string]["handler"]>[0]): SwarmTaskService {
  return ctx.resolve<SwarmTaskService>(SWARM_TASK_SERVICE_ID)
}

export const swarmTaskIpcModule: IpcModule = {
  id: "swarmTask",
  methods: {
    listTasks: {
      channel: "synapse:swarm-task:tasks:list",
      kind: "invoke",
      request: z.void(),
      response: swarmTaskListResultSchema,
      handler: (ctx) => resolveSwarmTaskService(ctx).listTasks(),
    },
    createTask: {
      channel: "synapse:swarm-task:tasks:create",
      kind: "invoke",
      request: swarmTaskCreateInputSchema,
      response: swarmTaskSchema,
      handler: (ctx, request: z.infer<typeof swarmTaskCreateInputSchema>) =>
        resolveSwarmTaskService(ctx).createTask(request),
    },
    updateTask: {
      channel: "synapse:swarm-task:tasks:update",
      kind: "invoke",
      request: swarmTaskUpdateInputSchema,
      response: swarmTaskSchema,
      handler: (ctx, request: z.infer<typeof swarmTaskUpdateInputSchema>) =>
        resolveSwarmTaskService(ctx).updateTask(request),
    },
    deleteTask: {
      channel: "synapse:swarm-task:tasks:delete",
      kind: "invoke",
      request: swarmTaskIdInputSchema,
      response: z.void(),
      handler: (ctx, request: z.infer<typeof swarmTaskIdInputSchema>) =>
        resolveSwarmTaskService(ctx).deleteTask(request.taskId),
    },
    startRun: {
      channel: "synapse:swarm-task:runs:start",
      kind: "invoke",
      request: swarmRunStartInputSchema,
      response: swarmRunSchema,
      handler: (ctx, request: z.infer<typeof swarmRunStartInputSchema>) =>
        resolveSwarmTaskService(ctx).startRun(request),
    },
    stopRefill: {
      channel: "synapse:swarm-task:runs:stop-refill",
      kind: "invoke",
      request: swarmRunIdInputSchema,
      response: swarmRunSchema.nullable(),
      handler: (ctx, request: z.infer<typeof swarmRunIdInputSchema>) =>
        resolveSwarmTaskService(ctx).stopRefill(request.runId),
    },
    cancelRun: {
      channel: "synapse:swarm-task:runs:cancel",
      kind: "invoke",
      request: swarmRunIdInputSchema,
      response: swarmRunSchema.nullable(),
      handler: (ctx, request: z.infer<typeof swarmRunIdInputSchema>) =>
        resolveSwarmTaskService(ctx).cancelRun(request.runId),
    },
    listRuns: {
      channel: "synapse:swarm-task:runs:list",
      kind: "invoke",
      request: swarmRunListInputSchema,
      response: swarmRunListResultSchema,
      handler: (ctx, request: z.infer<typeof swarmRunListInputSchema>) =>
        resolveSwarmTaskService(ctx).listRuns(request.taskId, request.limit),
    },
    getRun: {
      channel: "synapse:swarm-task:runs:get",
      kind: "invoke",
      request: swarmRunIdInputSchema,
      response: swarmRunSchema.nullable(),
      handler: (ctx, request: z.infer<typeof swarmRunIdInputSchema>) =>
        resolveSwarmTaskService(ctx).getRun(request.runId),
    },
    listWorkerRuns: {
      channel: "synapse:swarm-task:worker-runs:list",
      kind: "invoke",
      request: swarmRunIdInputSchema,
      response: swarmWorkerRunListResultSchema,
      handler: (ctx, request: z.infer<typeof swarmRunIdInputSchema>) =>
        resolveSwarmTaskService(ctx).listWorkerRuns(request.runId),
    },
  },
  events: {
    changed: {
      kind: "event",
      channel: "synapse:events:swarm-task",
      payload: swarmTaskChangedDomainEventSchema,
    },
  },
}
