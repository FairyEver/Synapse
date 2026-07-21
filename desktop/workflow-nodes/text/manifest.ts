import { Type } from "lucide-react"
import type { NodeManifest } from "../types"
import { builtinWorkflowNodeCapability } from "../share-contract"
import type { TextNodeConfig } from "./schema"
import { textNodeConfigSchema } from "./schema"

export const textNodeManifest: NodeManifest<TextNodeConfig> = {
  type: "text",
  title: "文本",
  icon: Type,
  color: "bg-primary/10",
  defaultConfig: { template: "", variables: [] },
  ports: { inputs: [{ id: "in", label: "输入" }], outputs: [{ id: "out", label: "输出" }] },
  cardSummary: (config) => ({
    title: "文本",
    subtitle: config.template === "" ? "空字符串" : config.template.slice(0, 60),
  }),
  configFields: [
    { name: "variables", kind: "variable-binding-list", label: "变量绑定" },
    { name: "template", kind: "text", label: "输出" },
  ],
  configSchema: textNodeConfigSchema,
  share: {
    selfContained: true,
    capability: builtinWorkflowNodeCapability("text"),
  },
}
