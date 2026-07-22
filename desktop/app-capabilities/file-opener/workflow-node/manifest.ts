import { FileOutput } from "lucide-react"
import type { NodeManifest } from "../../../workflow-nodes/types"
import { FILE_OPENER_CAPABILITY_ID, FILE_OPENER_WORKFLOW_NODE_TYPE } from "../shared/capability"
import { fileOpenerNodeConfigSchema, type FileOpenerNodeConfig } from "./schema"

export const fileOpenerNodeManifest: NodeManifest<FileOpenerNodeConfig> = {
  type: FILE_OPENER_WORKFLOW_NODE_TYPE,
  title: "默认应用打开",
  icon: FileOutput,
  color: "bg-primary/10",
  defaultConfig: { path: "", variables: [] },
  ports: {
    inputs: [{ id: "in", label: "输入" }],
    outputs: [{ id: "out", label: "路径" }],
  },
  cardSummary: (config) => ({
    title: "默认应用打开",
    subtitle: config.path || "未设置文件路径",
  }),
  configFields: [
    { name: "path", kind: "text", label: "文件路径" },
    { name: "variables", kind: "variable-binding-list", label: "变量绑定" },
  ],
  configSchema: fileOpenerNodeConfigSchema,
  share: {
    selfContained: false,
    capability: {
      id: FILE_OPENER_CAPABILITY_ID,
      minVersion: "1.0.0",
      installSourceId: "synapse.builtin",
    },
    resources: [{ path: ["path"], entryType: "file", cardinality: "one", access: "read" }],
    risks: [{ path: ["path"], id: "shell.execute", when: "present" }],
  },
}

