import { interpolatePrompt } from "../../../electron/services/workflow/variable-resolver"
import type { PermissionAction } from "../../../electron/runtime/security"
import type { NodeExecutor, NodeExecutionInput, NodeExecutionResult, NodeRuntimeDeps } from "../../../workflow-nodes/types"
import { createDocumentTemplateService } from "../main/service"
import { generateDocxInputSchema } from "../shared/schema"
import type { DocumentTemplateNodeConfig } from "./schema"

export const documentTemplateNodeExecutor: NodeExecutor<DocumentTemplateNodeConfig> = {
  async execute(input: NodeExecutionInput<DocumentTemplateNodeConfig>): Promise<NodeExecutionResult> {
    const start = Date.now()
    try {
      const templatePath = interpolatePrompt(input.config.templatePath, input.resolvedVariables)
      const outputPath = interpolatePrompt(input.config.outputPath, input.resolvedVariables)
      const dataPath = input.config.dataPath
        ? interpolatePrompt(input.config.dataPath, input.resolvedVariables)
        : undefined
      const dataJson = input.config.dataJson
        ? interpolatePrompt(input.config.dataJson, input.resolvedVariables)
        : undefined
      const data = input.config.dataSource === "inline" && dataJson
        ? parseJsonObject(dataJson)
        : undefined
      const generationInput = generateDocxInputSchema.parse({
        templatePath,
        outputPath,
        overwrite: input.config.overwrite,
        ...(input.config.dataSource === "dataPath" ? { dataPath } : { data }),
      })

      await authorizeFileAccess(input.runtimeDeps, input, "fs.read.outside-userdata", generationInput.templatePath, "workflow.documentTemplate.template")
      if (generationInput.dataPath) {
        await authorizeFileAccess(input.runtimeDeps, input, "fs.read.outside-userdata", generationInput.dataPath, "workflow.documentTemplate.data")
      }
      await authorizeFileAccess(input.runtimeDeps, input, "fs.write.outside-userdata", generationInput.outputPath, "workflow.documentTemplate.output")

      input.onProgress?.("generating", "模板生成文档")
      const result = await createDocumentTemplateService().generateDocx(generationInput)

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

function parseJsonObject(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("JSON 数据必须是对象")
  }
  return parsed as Record<string, unknown>
}

async function authorizeFileAccess(
  deps: NodeRuntimeDeps | undefined,
  input: NodeExecutionInput<DocumentTemplateNodeConfig>,
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
