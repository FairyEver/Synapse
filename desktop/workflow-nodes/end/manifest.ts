import { LogOut } from "lucide-react"
import type { NodeManifest } from "../types"
import { builtinWorkflowNodeCapability } from "../share-contract"
import type { EndNodeConfig } from "./schema"
import { endNodeConfigSchema } from "./schema"

export const endNodeManifest: NodeManifest<EndNodeConfig> = {
  type: "end",
  title: "结束",
  icon: LogOut,
  color: "bg-primary/10",
  defaultConfig: { outputType: "text", template: "", variables: [] },
  ports: { inputs: [{ id: "in", label: "输入" }], outputs: [] },
  cardSummary: (c) => ({ title: "结束", subtitle: c.template.slice(0, 40) || "返回文本" }),
  configFields: [
    { name: "outputType", kind: "select", label: "输出类型" },
    { name: "variables", kind: "variable-binding-list", label: "变量绑定" },
    { name: "template", kind: "text", label: "返回文本" },
  ],
  configSchema: endNodeConfigSchema,
  share: {
    selfContained: true,
    capability: builtinWorkflowNodeCapability("end"),
  },
}
