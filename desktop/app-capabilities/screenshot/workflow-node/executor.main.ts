import { interpolatePrompt } from "../../../electron/services/workflow/variable-resolver"
import type { PermissionAction } from "../../../electron/runtime/security"
import type { NodeExecutor, NodeExecutionInput, NodeExecutionResult, NodeRuntimeDeps } from "../../../workflow-nodes/types"
import { createScreenshotService } from "../main/service"
import { runWithScreenshotWindowState } from "../main/window-capture"
import type { ScreenshotNodeConfig } from "./schema"

export const screenshotNodeExecutor: NodeExecutor<ScreenshotNodeConfig> = {
  async execute(input: NodeExecutionInput<ScreenshotNodeConfig>): Promise<NodeExecutionResult> {
    const start = Date.now()
    try {
      const outputPath = interpolatePrompt(input.config.outputPath, input.resolvedVariables)
      await authorizeFileAccess(input.runtimeDeps, input, "fs.write.outside-userdata", outputPath, "workflow.screenshot.output")

      const capture = input.config.mode === "region"
        ? {
            mode: "region" as const,
            region: {
              x: parseCoordinate(input.config.x, input.resolvedVariables, "X"),
              y: parseCoordinate(input.config.y, input.resolvedVariables, "Y"),
              width: parseCoordinate(input.config.width, input.resolvedVariables, "W"),
              height: parseCoordinate(input.config.height, input.resolvedVariables, "H"),
            },
            hideCurrentWindow: input.config.hideCurrentWindow,
          }
        : {
            mode: "fullscreen" as const,
            hideCurrentWindow: input.config.hideCurrentWindow,
      }

      input.onProgress?.("capturing", "截图")
      const result = await runWithScreenshotWindowState(
        { hideCurrentWindow: input.config.hideCurrentWindow === true },
        (screenshotContext) => createScreenshotService().captureToFile({
          capture,
          outputPath,
          overwrite: input.config.overwrite,
        }, screenshotContext),
      )

      return {
        status: "success",
        output: result.outputPath,
        outputs: result,
        durationMs: Date.now() - start,
      }
    } catch (error) {
      return {
        status: "failed",
        output: "",
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - start,
      }
    }
  },
}

function parseCoordinate(value: string | undefined, variables: Record<string, string>, label: string): number {
  const interpolated = interpolatePrompt(value ?? "", variables).trim()
  const parsed = Number(interpolated)
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} 坐标必须是数字`)
  }
  return parsed
}

async function authorizeFileAccess(
  deps: NodeRuntimeDeps | undefined,
  input: NodeExecutionInput<ScreenshotNodeConfig>,
  action: PermissionAction,
  resource: string,
  source: string,
): Promise<void> {
  if (!deps?.permissionGuard || !deps.auditSink) return
  const actor = input.context.actor ?? { kind: "system" as const, id: "workflow-engine" }
  const metadata = {
    source,
    workflowId: input.context.workflowId,
    runId: input.context.runId,
    nodeId: input.context.nodeId,
    nodeName: input.context.nodeName,
  }
  const permission = await deps.permissionGuard.check({
    action,
    actor,
    resource,
    context: metadata,
  })
  deps.auditSink.record({
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
