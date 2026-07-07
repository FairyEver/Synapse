import type { CapabilityId } from "../../../synapse-capabilities/shared/naming"

export const SWARM_TASK_APP_ID = "swarm-task" as const
export const SWARM_TASK_SERVICE_ID = "core.swarm-task" as const
export const SWARM_TASK_WORKFLOW_NODE_TYPE = "swarm_task_run" as const

export const SWARM_TASK_TASK_CREATE_CAPABILITY_ID =
  "app.swarm_task.task.create" as CapabilityId
export const SWARM_TASK_TASK_LIST_CAPABILITY_ID =
  "app.swarm_task.task.list" as CapabilityId
export const SWARM_TASK_TASK_GET_CAPABILITY_ID =
  "app.swarm_task.task.get" as CapabilityId
export const SWARM_TASK_TASK_UPDATE_CAPABILITY_ID =
  "app.swarm_task.task.update" as CapabilityId
export const SWARM_TASK_TASK_DELETE_CAPABILITY_ID =
  "app.swarm_task.task.delete" as CapabilityId
export const SWARM_TASK_RUN_START_CAPABILITY_ID =
  "app.swarm_task.run.start" as CapabilityId
export const SWARM_TASK_RUN_STOP_REFILL_CAPABILITY_ID =
  "app.swarm_task.run.stopRefill" as CapabilityId
export const SWARM_TASK_RUN_CANCEL_CAPABILITY_ID =
  "app.swarm_task.run.cancel" as CapabilityId
export const SWARM_TASK_RUN_LIST_CAPABILITY_ID =
  "app.swarm_task.run.list" as CapabilityId
export const SWARM_TASK_RUN_GET_CAPABILITY_ID =
  "app.swarm_task.run.get" as CapabilityId

export const SWARM_TASK_CAPABILITY_IDS = [
  SWARM_TASK_TASK_CREATE_CAPABILITY_ID,
  SWARM_TASK_TASK_LIST_CAPABILITY_ID,
  SWARM_TASK_TASK_GET_CAPABILITY_ID,
  SWARM_TASK_TASK_UPDATE_CAPABILITY_ID,
  SWARM_TASK_TASK_DELETE_CAPABILITY_ID,
  SWARM_TASK_RUN_START_CAPABILITY_ID,
  SWARM_TASK_RUN_STOP_REFILL_CAPABILITY_ID,
  SWARM_TASK_RUN_CANCEL_CAPABILITY_ID,
  SWARM_TASK_RUN_LIST_CAPABILITY_ID,
  SWARM_TASK_RUN_GET_CAPABILITY_ID,
] as const

export const SWARM_TASK_MCP_TOOL_NAMES = {
  taskCreate: "app_swarm_task_task_create",
  taskList: "app_swarm_task_task_list",
  taskGet: "app_swarm_task_task_get",
  taskUpdate: "app_swarm_task_task_update",
  taskDelete: "app_swarm_task_task_delete",
  runStart: "app_swarm_task_run_start",
  runStopRefill: "app_swarm_task_run_stopRefill",
  runCancel: "app_swarm_task_run_cancel",
  runList: "app_swarm_task_run_list",
  runGet: "app_swarm_task_run_get",
} as const
