import { Workflow } from "lucide-react"
import type { NodeManifest } from "../types"
import { builtinWorkflowNodeCapability } from "../share-contract"
import type { WorkflowCallNodeConfig } from "./schema"
import { workflowCallNodeConfigSchema } from "./schema"

export const workflowCallNodeManifest: NodeManifest<WorkflowCallNodeConfig> = {
  type: "workflow_call",
  title: "调用工作流",
  icon: Workflow,
  color: "bg-primary/10",
  defaultConfig: { workflowId: "", variables: [], paramTemplates: {}, paramBindings: {} },
  ports: { inputs: [{ id: "in", label: "输入" }], outputs: [{ id: "out", label: "输出" }] },
  cardSummary: (config) => ({
    title: config.workflowId ? "已选择工作流" : "未选择工作流",
    subtitle: workflowCallParamCount(config) > 0 ? `${workflowCallParamCount(config)} 个参数` : "无参数映射",
  }),
  configFields: [
    { name: "workflowId", kind: "select", label: "工作流" },
    { name: "variables", kind: "variable-binding-list", label: "变量绑定" },
    { name: "paramTemplates", kind: "record", label: "参数模板" },
    { name: "paramBindings", kind: "record", label: "参数绑定" },
  ],
  configSchema: workflowCallNodeConfigSchema,
  share: {
    selfContained: false,
    capability: builtinWorkflowNodeCapability("workflow_call"),
    workflows: [{ path: ["workflowId"] }],
  },
}

function workflowCallParamCount(config: WorkflowCallNodeConfig): number {
  return new Set([...Object.keys(config.paramTemplates), ...Object.keys(config.paramBindings ?? {})]).size
}
