import type { ActionManifest, ActionStoredConfigValidation } from "../../types"
import {
  workflowActionConfigSchema,
  type WorkflowActionConfig,
} from "./schema"

export const workflowActionManifest = {
  id: "builtin.workflow",
  title: "工作流",
  permissions: ["workflow.run"],
  defaultConfig: {
    workflowId: "",
    paramTemplates: {},
  },
  configFields: [
    {
      name: "workflowId",
      kind: "string",
      required: true,
      description: "Workflow ID.",
    },
    {
      name: "paramTemplates",
      kind: "record",
      required: false,
      description: "Workflow parameter templates.",
    },
  ],
  configSchema: workflowActionConfigSchema,
  validateStoredConfig,
} satisfies ActionManifest<WorkflowActionConfig>

function validateStoredConfig(config: Record<string, unknown>): ActionStoredConfigValidation {
  const parsed = workflowActionConfigSchema.safeParse(config)
  if (!parsed.success) {
    return {
      status: "needs_update",
      issues: [{ field: "workflow.config", message: "检查工作流" }],
    }
  }

  if (!parsed.data.workflowId.trim()) {
    return {
      status: "needs_update",
      issues: [{ field: "workflowId", message: "选择工作流" }],
    }
  }

  return { status: "valid", issues: [] }
}
