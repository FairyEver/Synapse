import { z } from "zod"
import type { AuditSink, PermissionGuard } from "../../../electron/runtime/security"
import type { DispatchContext, DispatchResult } from "../../../synapse-capabilities/shared/types"
import { checkCapabilityPermission } from "../../../electron/capabilities/permission-audit"
import {
  WECOM_CLI_RUN_CAPABILITY_ID,
  WECOM_CONNECTION_GET_CAPABILITY_ID,
} from "../shared/capability"
import {
  wecomCliRunInputSchema,
  wecomConnectionGetInputSchema,
} from "../shared/command-schema"
import { WecomCliError } from "./cli-client"
import type { WecomInvocationService } from "./invocation-service"

export type WecomDispatcherDeps = {
  readonly service: WecomInvocationService
  readonly permissionGuard?: PermissionGuard
  readonly auditSink?: AuditSink
}

export function createWecomCapabilityDispatcher(deps: WecomDispatcherDeps) {
  return {
    async dispatch(action: string, params: Record<string, unknown>, context: DispatchContext): Promise<DispatchResult> {
      const actor = context.actor ?? { kind: "user" as const, id: "synapse-mcp", display: "Synapse MCP" }
      const metadata = {
        source: context.source ?? "api",
        action,
        controllerInstanceId: context.controllerInstanceId,
      }
      const permission = await checkCapabilityPermission({
        permissionGuard: deps.permissionGuard,
        auditSink: deps.auditSink,
        action: "network.connect",
        actor,
        resource: "wecom-cli",
        context: metadata,
      })
      if (permission && !permission.allowed) {
        deps.auditSink?.record({
          action: "network.connect",
          actor,
          resource: "wecom-cli",
          outcome: "denied",
          metadata,
        })
        return { ok: false, code: "WECOM_LOCAL_PERMISSION_DENIED", error: permission.reason }
      }

      try {
        if (action === WECOM_CONNECTION_GET_CAPABILITY_ID) {
          wecomConnectionGetInputSchema.parse(params)
          const data = await deps.service.getConnection()
          deps.auditSink?.record({ action: "network.connect", actor, resource: "wecom-cli", outcome: "allowed", metadata })
          return { ok: true, data }
        }
        if (action === WECOM_CLI_RUN_CAPABILITY_ID) {
          const input = wecomCliRunInputSchema.parse(params)
          const data = await deps.service.run(input, sessionKey(context), {
            abortSignal: context.abortSignal,
          })
          deps.auditSink?.record({
            action: "network.connect",
            actor,
            resource: "wecom-cli",
            outcome: "allowed",
            metadata: {
              ...metadata,
              service: input.args[0],
              argCount: input.args.length,
            },
          })
          return { ok: true, data }
        }
        return { ok: false, code: "WECOM_UNKNOWN_ACTION", error: "Unknown Enterprise WeChat action." }
      } catch (error) {
        const failure = wecomFailure(error)
        deps.auditSink?.record({
          action: "network.connect",
          actor,
          resource: "wecom-cli",
          outcome: "failed",
          metadata: { ...metadata, errorCode: failure.code },
        })
        return failure
      }
    },
  }
}

function sessionKey(context: DispatchContext): string {
  return context.controllerInstanceId
    ?? context.clientId
    ?? context.actor?.id
    ?? "wecom-default"
}

function wecomFailure(error: unknown): DispatchResult & { readonly ok: false } {
  if (error instanceof z.ZodError) {
    return {
      ok: false,
      code: "WECOM_INVALID_INPUT",
      error: "企业微信命令参数无效。",
      data: { fields: error.issues.map((issue) => issue.path.join(".")).filter(Boolean) },
    }
  }
  if (error instanceof WecomCliError) {
    if (error.code === "connector_required" || error.code === "connector_disabled") {
      return { ok: false, code: "WECOM_CONNECTOR_REQUIRED", error: "请先在连接器中连接企业微信。" }
    }
    if (error.code === "auth_required") {
      return { ok: false, code: "WECOM_AUTH_REQUIRED", error: error.message }
    }
    if (error.code === "permission_denied") {
      return {
        ok: false,
        code: "WECOM_PERMISSION_REQUIRED",
        error: error.message,
        data: {
          ...(error.options.permission ? { permission: error.options.permission } : {}),
          ...(error.options.helpUrl ? { helpUrl: error.options.helpUrl } : {}),
        },
      }
    }
    if (error.code === "cancelled") {
      return { ok: false, code: "WECOM_REQUEST_CANCELLED", error: "企业微信请求已取消。" }
    }
    if (error.code === "cli_unavailable") {
      return { ok: false, code: "WECOM_CLI_UNAVAILABLE", error: error.message }
    }
    if (error.code === "invalid_response") {
      return { ok: false, code: "WECOM_INVALID_RESPONSE", error: error.message }
    }
    return { ok: false, code: "WECOM_COMMAND_FAILED", error: error.message }
  }
  return {
    ok: false,
    code: "WECOM_REQUEST_FAILED",
    error: error instanceof Error ? error.message : "企业微信请求失败，请重试。",
  }
}
