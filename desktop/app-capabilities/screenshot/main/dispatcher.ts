import type { DispatchContext, DispatchResult } from "../../../synapse-capabilities/shared/types"
import type { ActorIdentity, AuditSink, PermissionAction, PermissionGuard } from "../../../electron/runtime/security"
import {
  SCREENSHOT_CAPTURE_CAPABILITY_ID,
  SCREENSHOT_FILE_SAVE_CAPABILITY_ID,
} from "../shared/capability"
import {
  screenshotCaptureInputSchema,
  screenshotCaptureToFileInputSchema,
} from "../shared/schema"
import type { ScreenshotService } from "./service"
import { publicArtifact } from "./service"
import { runWithScreenshotWindowState } from "./window-capture"

const DEFAULT_ACTOR: ActorIdentity = { kind: "user", id: "synapse-mcp", display: "Synapse MCP" }

export type ScreenshotCapabilityDispatcher = {
  dispatch(action: string, params: Record<string, unknown>, context: DispatchContext): Promise<DispatchResult>
}

export function createScreenshotCapabilityDispatcher(deps: {
  readonly service: ScreenshotService
  readonly permissionGuard?: PermissionGuard
  readonly auditSink?: AuditSink
  readonly actor?: ActorIdentity
}): ScreenshotCapabilityDispatcher {
  return {
    async dispatch(action, params, context) {
      if (action === SCREENSHOT_CAPTURE_CAPABILITY_ID) {
        const parsed = screenshotCaptureInputSchema.parse(params)
        const artifact = await runWithScreenshotWindowState(
          { hideCurrentWindow: parsed.hideCurrentWindow === true },
          (screenshotContext) => deps.service.capture(parsed, screenshotContext),
        )
        return { ok: true, data: publicArtifact(artifact), affected: 1 }
      }
      if (action === SCREENSHOT_FILE_SAVE_CAPABILITY_ID) {
        const parsed = screenshotCaptureToFileInputSchema.parse(params)
        await authorizeFileAccess(deps, context, "fs.write.outside-userdata", parsed.outputPath, "screenshot.mcp.output")
        const result = await runWithScreenshotWindowState(
          { hideCurrentWindow: parsed.capture.hideCurrentWindow === true },
          (screenshotContext) => deps.service.captureToFile(parsed, screenshotContext),
        )
        return { ok: true, data: result, affected: 1 }
      }
      throw new Error(`Unknown screenshot action: ${action}`)
    },
  }
}

async function authorizeFileAccess(
  deps: {
    readonly permissionGuard?: PermissionGuard
    readonly auditSink?: AuditSink
    readonly actor?: ActorIdentity
  },
  context: DispatchContext,
  action: PermissionAction,
  resource: string,
  source: string,
): Promise<void> {
  if (!deps.permissionGuard) return
  const actor = context.actor ?? deps.actor ?? DEFAULT_ACTOR
  const metadata = {
    source: context.source ?? "api",
    capabilityAction: SCREENSHOT_FILE_SAVE_CAPABILITY_ID,
    boundary: source,
  }
  const permission = await deps.permissionGuard.check({
    action,
    actor,
    resource,
    context: metadata,
  })
  deps.auditSink?.record({
    action,
    actor,
    resource,
    outcome: permission.allowed ? "allowed" : "denied",
    metadata: permission.allowed
      ? metadata
      : { ...metadata, reason: permission.reason, policyId: permission.policyId },
  })
  if (!permission.allowed) {
    throw new Error(permission.reason)
  }
}
