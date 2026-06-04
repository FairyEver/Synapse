import type { AuditSink, PermissionGuard } from "../../runtime/security"
import { BuiltinToolError, toBuiltinToolErrorPayload } from "./errors"
import { getBuiltinToolDescriptor, type BuiltinToolRegistry } from "./registry"
import { resolveBuiltinToolPermissions } from "./permissions"
import type { BuiltinToolExecutionContext, BuiltinToolRunResult } from "./types"
import { executeBuiltinToolInWorker } from "./worker-runner"

export interface BuiltinToolRunRequest {
  readonly toolId: string
  readonly input: unknown
  readonly context: BuiltinToolExecutionContext
  readonly registry?: BuiltinToolRegistry
  readonly permissionGuard: PermissionGuard
  readonly auditSink: AuditSink
  readonly executeInWorker?: (payload: { readonly toolId: string; readonly input: unknown }) => Promise<unknown>
}

export async function runBuiltinTool(request: BuiltinToolRunRequest): Promise<BuiltinToolRunResult> {
  const descriptor = getBuiltinToolDescriptor(request.toolId, request.registry)
  if (!descriptor) {
    return failure(request.toolId, new BuiltinToolError("unknown_tool", `Unknown builtin tool: ${request.toolId}`))
  }

  const parsedInput = descriptor.inputSchema.safeParse(request.input)
  if (!parsedInput.success) {
    return failure(descriptor.id, new BuiltinToolError("invalid_input", parsedInput.error.message))
  }

  try {
    const permissions = resolveBuiltinToolPermissions(descriptor, parsedInput.data as Record<string, unknown>)
    for (const permission of permissions) {
      const guardResult = await request.permissionGuard.check({
        action: permission.action,
        actor: request.context.actor,
        resource: permission.resource,
        context: {
          source: "tools.builtinTool.run",
          toolId: descriptor.id,
          entryPoint: request.context.entryPoint,
        },
      })
      request.auditSink.record({
        action: permission.action,
        actor: request.context.actor,
        resource: permission.resource,
        outcome: guardResult.allowed ? "allowed" : "denied",
        metadata: guardResult.allowed
          ? { source: "tools.builtinTool.run", toolId: descriptor.id, entryPoint: request.context.entryPoint }
          : {
              source: "tools.builtinTool.run",
              toolId: descriptor.id,
              entryPoint: request.context.entryPoint,
              reason: guardResult.reason,
              policyId: guardResult.policyId,
            },
      })
      if (!guardResult.allowed) {
        throw new BuiltinToolError("permission_denied", guardResult.reason)
      }
    }

    const execute = request.executeInWorker ?? executeBuiltinToolInWorker
    const rawOutput = await execute({ toolId: descriptor.id, input: parsedInput.data })
    const parsedOutput = descriptor.outputSchema.safeParse(rawOutput)
    if (!parsedOutput.success) {
      throw new BuiltinToolError("conversion_failed", parsedOutput.error.message)
    }
    return {
      ok: true,
      toolId: descriptor.id,
      output: parsedOutput.data,
      warnings: warningsFromOutput(parsedOutput.data),
      metadata: {},
    }
  } catch (error) {
    return failure(descriptor.id, error)
  }
}

function failure(toolId: string, error: unknown): BuiltinToolRunResult {
  return {
    ok: false,
    toolId,
    error: toBuiltinToolErrorPayload(error),
    metadata: {},
  }
}

function warningsFromOutput(output: unknown): readonly { readonly code: string; readonly message: string }[] {
  if (!output || typeof output !== "object" || !("warnings" in output)) return []
  const warnings = (output as { readonly warnings?: unknown }).warnings
  if (!Array.isArray(warnings)) return []
  return warnings.filter((warning): warning is { readonly code: string; readonly message: string } =>
    Boolean(warning) &&
    typeof warning === "object" &&
    typeof (warning as { readonly code?: unknown }).code === "string" &&
    typeof (warning as { readonly message?: unknown }).message === "string",
  )
}

