import { FileOutput } from "lucide-react"
import { builtinWorkflowNodeCapability } from "../share-contract"
import type { NodeManifest } from "../types"
import { openFileNodeConfigSchema, type OpenFileNodeConfig } from "./schema"

export const openFileNodeManifest: NodeManifest<OpenFileNodeConfig> = {
  type: "open_file",
  title: "默认应用打开",
  icon: FileOutput,
  color: "bg-primary/10",
  defaultConfig: {
    filePath: "",
    variables: [],
  },
  ports: {
    inputs: [{ id: "in", label: "输入" }],
    outputs: [{ id: "out", label: "路径" }],
  },
  cardSummary: (config) => ({
    title: "默认应用打开",
    subtitle: config.filePath || "未设置文件路径",
  }),
  configFields: [
    { name: "filePath", kind: "text", label: "文件路径" },
    { name: "variables", kind: "variable-binding-list", label: "变量绑定" },
  ],
  configSchema: openFileNodeConfigSchema,
  share: {
    selfContained: false,
    capability: builtinWorkflowNodeCapability("open_file"),
    resources: [{
      path: ["filePath"],
      entryType: "file",
      cardinality: "one",
      access: "read",
    }],
    risks: [{ path: ["filePath"], id: "shell.execute", when: "present" }],
  },
}
