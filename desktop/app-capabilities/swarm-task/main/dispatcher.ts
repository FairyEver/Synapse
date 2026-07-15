import type { DispatchContext, DispatchResult } from "../../../synapse-capabilities/shared/types"
import {
  SWARM_TASK_RUN_CANCEL_CAPABILITY_ID,
  SWARM_TASK_RUN_GET_CAPABILITY_ID,
  SWARM_TASK_RUN_LIST_CAPABILITY_ID,
  SWARM_TASK_RUN_START_CAPABILITY_ID,
  SWARM_TASK_RUN_STOP_REFILL_CAPABILITY_ID,
  SWARM_TASK_TASK_CREATE_CAPABILITY_ID,
  SWARM_TASK_TASK_DELETE_CAPABILITY_ID,
  SWARM_TASK_TASK_GET_CAPABILITY_ID,
  SWARM_TASK_TASK_LIST_CAPABILITY_ID,
  SWARM_TASK_TASK_UPDATE_CAPABILITY_ID,
} from "../shared/capability"
import {
  swarmRunIdInputSchema,
  swarmRunListInputSchema,
  swarmRunStartInputSchema,
  swarmTaskCreateInputSchema,
  swarmTaskIdInputSchema,
  swarmTaskUpdateInputSchema,
} from "../shared/schema"
import type { SwarmTaskService } from "./service"

export type SwarmTaskCapabilityDispatcher = {
  dispatch(action: string, params: Record<string, unknown>, context: DispatchContext): Promise<DispatchResult>
}

export function createSwarmTaskCapabilityDispatcher(deps: {
  readonly service: SwarmTaskService
}): SwarmTaskCapabilityDispatcher {
  return {
    async dispatch(action, params) {
      if (action === SWARM_TASK_TASK_CREATE_CAPABILITY_ID) {
        return { ok: true, data: await deps.service.createTask(swarmTaskCreateInputSchema.parse(params)), affected: 1 }
      }
      if (action === SWARM_TASK_TASK_LIST_CAPABILITY_ID) {
        const tasks = await deps.service.listTasks()
        return { ok: true, data: tasks, affected: 0 }
      }
      if (action === SWARM_TASK_TASK_GET_CAPABILITY_ID) {
        const parsed = swarmTaskIdInputSchema.parse(params)
        const task = (await deps.service.listTasks()).find((item) => item.id === parsed.taskId) ?? null
        return { ok: true, data: task, affected: task ? 1 : 0 }
      }
      if (action === SWARM_TASK_TASK_UPDATE_CAPABILITY_ID) {
        return { ok: true, data: await deps.service.updateTask(swarmTaskUpdateInputSchema.parse(params)), affected: 1 }
      }
      if (action === SWARM_TASK_TASK_DELETE_CAPABILITY_ID) {
        const parsed = swarmTaskIdInputSchema.parse(params)
        const exists = (await deps.service.listTasks()).some((task) => task.id === parsed.taskId)
        if (exists) {
          await deps.service.deleteTask(parsed.taskId)
        }
        return { ok: true, data: { ok: true }, affected: exists ? 1 : 0 }
      }
      if (action === SWARM_TASK_RUN_START_CAPABILITY_ID) {
        return { ok: true, data: await deps.service.startRun(swarmRunStartInputSchema.parse(params)), affected: 1 }
      }
      if (action === SWARM_TASK_RUN_STOP_REFILL_CAPABILITY_ID) {
        const parsed = swarmRunIdInputSchema.parse(params)
        const run = await deps.service.stopRefill(parsed.runId)
        if (!run) return { ok: false, error: `蜂群运行不存在：${parsed.runId}` }
        return { ok: true, data: run, affected: run ? 1 : 0 }
      }
      if (action === SWARM_TASK_RUN_CANCEL_CAPABILITY_ID) {
        const parsed = swarmRunIdInputSchema.parse(params)
        const run = await deps.service.cancelRun(parsed.runId)
        if (!run) return { ok: false, error: `蜂群运行不存在：${parsed.runId}` }
        return { ok: true, data: run, affected: run ? 1 : 0 }
      }
      if (action === SWARM_TASK_RUN_LIST_CAPABILITY_ID) {
        const parsed = swarmRunListInputSchema.parse(params)
        return { ok: true, data: await deps.service.listRuns(parsed.taskId, parsed.limit), affected: 0 }
      }
      if (action === SWARM_TASK_RUN_GET_CAPABILITY_ID) {
        const parsed = swarmRunIdInputSchema.parse(params)
        const run = await deps.service.getRun(parsed.runId)
        return { ok: true, data: run, affected: run ? 1 : 0 }
      }
      throw new Error(`Unknown swarm task action: ${action}`)
    },
  }
}
