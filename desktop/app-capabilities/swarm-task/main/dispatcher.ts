import type { DispatchContext, DispatchResult } from "../../../synapse-capabilities/shared/types"
import type { ActorIdentity, AuditSink, PermissionAction, PermissionGuard } from "../../../electron/runtime/security"
import { checkCapabilityPermission } from "../../../electron/capabilities/permission-audit"
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
  swarmRunGetInputSchema,
  swarmRunIdInputSchema,
  swarmRunListInputSchema,
  swarmRunStartInputSchema,
  swarmTaskCreateInputSchema,
  swarmTaskIdInputSchema,
  swarmTaskUpdateInputSchema,
} from "../shared/schema"
import type { SwarmWorkerRun } from "../shared/schema"
import type { SwarmTaskService } from "./service"

const DEFAULT_ACTOR: ActorIdentity = { kind: "user", id: "synapse-mcp", display: "Synapse MCP" }

type SwarmTaskDispatcherDeps = {
  readonly service: SwarmTaskService
  readonly permissionGuard?: PermissionGuard
  readonly auditSink?: AuditSink
  readonly actor?: ActorIdentity
}

type SwarmAuditContext = {
  readonly action: PermissionAction
  readonly actor: ActorIdentity
  readonly resource: string
  readonly metadata: Record<string, unknown>
}

export type SwarmTaskCapabilityDispatcher = {
  dispatch(action: string, params: Record<string, unknown>, context: DispatchContext): Promise<DispatchResult>
}

export function createSwarmTaskCapabilityDispatcher(deps: SwarmTaskDispatcherDeps): SwarmTaskCapabilityDispatcher {
  return {
    async dispatch(action, params, context) {
      if (action === SWARM_TASK_TASK_CREATE_CAPABILITY_ID) {
        const parsed = swarmTaskCreateInputSchema.parse(params)
        return runSwarmAction(deps, context, {
          action: "automation.mutate",
          capabilityAction: action,
          resource: "swarm-task:task:new",
          metadata: { projectId: parsed.config.projectId },
        }, async () => ({ ok: true, data: await deps.service.createTask(parsed), affected: 1 }))
      }
      if (action === SWARM_TASK_TASK_LIST_CAPABILITY_ID) {
        return runSwarmAction(deps, context, {
          action: "automation.read",
          capabilityAction: action,
          resource: "swarm-task:tasks",
        }, async () => ({ ok: true, data: await deps.service.listTasks(), affected: 0 }))
      }
      if (action === SWARM_TASK_TASK_GET_CAPABILITY_ID) {
        const parsed = swarmTaskIdInputSchema.parse(params)
        return runSwarmAction(deps, context, taskAuditInput("automation.read", action, parsed.taskId), async () => {
          const task = (await deps.service.listTasks()).find((item) => item.id === parsed.taskId) ?? null
          return { ok: true, data: task, affected: task ? 1 : 0 }
        })
      }
      if (action === SWARM_TASK_TASK_UPDATE_CAPABILITY_ID) {
        const parsed = swarmTaskUpdateInputSchema.parse(params)
        return runSwarmAction(deps, context, taskAuditInput("automation.mutate", action, parsed.taskId), async () => (
          { ok: true, data: await deps.service.updateTask(parsed), affected: 1 }
        ))
      }
      if (action === SWARM_TASK_TASK_DELETE_CAPABILITY_ID) {
        const parsed = swarmTaskIdInputSchema.parse(params)
        return runSwarmAction(deps, context, taskAuditInput("automation.mutate", action, parsed.taskId), async () => {
          const exists = (await deps.service.listTasks()).some((task) => task.id === parsed.taskId)
          if (exists) await deps.service.deleteTask(parsed.taskId)
          return { ok: true, data: { ok: true }, affected: exists ? 1 : 0 }
        })
      }
      if (action === SWARM_TASK_RUN_START_CAPABILITY_ID) {
        const parsed = swarmRunStartInputSchema.parse(params)
        return runSwarmAction(deps, context, taskAuditInput("agent.spawn", action, parsed.taskId), async () => (
          { ok: true, data: await deps.service.startRun(parsed), affected: 1 }
        ))
      }
      if (action === SWARM_TASK_RUN_STOP_REFILL_CAPABILITY_ID) {
        const parsed = swarmRunIdInputSchema.parse(params)
        return runSwarmAction(deps, context, runAuditInput("automation.mutate", action, parsed.runId), async () => {
          const run = await deps.service.stopRefill(parsed.runId)
          if (!run) return { ok: false, error: `蜂群运行不存在：${parsed.runId}` }
          return { ok: true, data: run, affected: 1 }
        })
      }
      if (action === SWARM_TASK_RUN_CANCEL_CAPABILITY_ID) {
        const parsed = swarmRunIdInputSchema.parse(params)
        return runSwarmAction(deps, context, runAuditInput("automation.mutate", action, parsed.runId), async () => {
          const run = await deps.service.cancelRun(parsed.runId)
          if (!run) return { ok: false, error: `蜂群运行不存在：${parsed.runId}` }
          return { ok: true, data: run, affected: 1 }
        })
      }
      if (action === SWARM_TASK_RUN_LIST_CAPABILITY_ID) {
        const parsed = swarmRunListInputSchema.parse(params)
        return runSwarmAction(deps, context, taskAuditInput("automation.read", action, parsed.taskId), async () => (
          { ok: true, data: await deps.service.listRuns(parsed.taskId, parsed.limit), affected: 0 }
        ))
      }
      if (action === SWARM_TASK_RUN_GET_CAPABILITY_ID) {
        const parsed = swarmRunGetInputSchema.parse(params)
        return runSwarmAction(
          deps,
          context,
          taskAuditInput("automation.read", action, parsed.taskId, { runId: parsed.runId }),
          async () => {
            const run = await deps.service.getRun(parsed.runId)
            if (!run || run.taskId !== parsed.taskId) return { ok: true, data: null, affected: 0 }
            const workers = (await deps.service.listWorkerRuns(parsed.runId)).map(toMcpWorkerRun)
            return { ok: true, data: { ...run, workers }, affected: 1 }
          },
        )
      }
      throw new Error(`Unknown swarm task action: ${action}`)
    },
  }
}

function toMcpWorkerRun(worker: SwarmWorkerRun): Omit<SwarmWorkerRun, "sessionKey"> {
  const { sessionKey, ...publicWorker } = worker
  void sessionKey
  return publicWorker
}

function taskAuditInput(
  action: PermissionAction,
  capabilityAction: string,
  taskId: string,
  metadata: Record<string, unknown> = {},
) {
  return {
    action,
    capabilityAction,
    resource: `swarm-task:task:${taskId}`,
    metadata: { taskId, ...metadata },
  }
}

function runAuditInput(action: PermissionAction, capabilityAction: string, runId: string) {
  return {
    action,
    capabilityAction,
    resource: `swarm-task:run:${runId}`,
    metadata: { runId },
  }
}

async function runSwarmAction(
  deps: SwarmTaskDispatcherDeps,
  context: DispatchContext,
  input: {
    readonly action: PermissionAction
    readonly capabilityAction: string
    readonly resource: string
    readonly metadata?: Record<string, unknown>
  },
  task: () => Promise<DispatchResult>,
): Promise<DispatchResult> {
  const audit = await authorizeSwarmAction(deps, context, input)
  try {
    const result = await task()
    recordSwarmAudit(deps, audit, result.ok ? "allowed" : "failed", {
      ...("affected" in result && result.affected !== undefined ? { affected: result.affected } : {}),
      ...(result.ok || !result.error ? {} : { errorLength: result.error.length }),
    })
    return result
  } catch (error) {
    recordSwarmAudit(deps, audit, "failed", {
      errorName: error instanceof Error ? error.name : typeof error,
      errorLength: error instanceof Error ? error.message.length : String(error).length,
    })
    throw error
  }
}

async function authorizeSwarmAction(
  deps: SwarmTaskDispatcherDeps,
  context: DispatchContext,
  input: {
    readonly action: PermissionAction
    readonly capabilityAction: string
    readonly resource: string
    readonly metadata?: Record<string, unknown>
  },
): Promise<SwarmAuditContext> {
  const actor = context.actor ?? deps.actor ?? DEFAULT_ACTOR
  const metadata = {
    source: context.source ?? "api",
    capabilityAction: input.capabilityAction,
    boundary: "swarm-task.mcp",
    ...input.metadata,
  }
  const permission = await checkCapabilityPermission({
    permissionGuard: deps.permissionGuard,
    auditSink: deps.auditSink,
    action: input.action,
    actor,
    resource: input.resource,
    context: metadata,
  })
  if (permission && !permission.allowed) {
    deps.auditSink?.record({
      action: input.action,
      actor,
      resource: input.resource,
      outcome: "denied",
      metadata: {
        ...metadata,
        reason: permission.reason,
        policyId: permission.policyId,
      },
    })
    throw new Error(permission.reason)
  }
  return { action: input.action, actor, resource: input.resource, metadata }
}

function recordSwarmAudit(
  deps: Pick<SwarmTaskDispatcherDeps, "auditSink">,
  audit: SwarmAuditContext,
  outcome: "allowed" | "failed",
  metadata?: Record<string, unknown>,
): void {
  deps.auditSink?.record({
    action: audit.action,
    actor: audit.actor,
    resource: audit.resource,
    outcome,
    metadata: metadata ? { ...audit.metadata, ...metadata } : audit.metadata,
  })
}
