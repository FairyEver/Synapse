import { FileSearch } from "lucide-react"
import type { NodeManifest } from "../../../workflow-nodes/types"
import {
  TEXT_EXTRACTOR_CAPABILITY_ID,
  TEXT_EXTRACT_WORKFLOW_NODE_TYPE,
} from "../shared/capability"
import {
  textExtractNodeConfigSchema,
  type TextExtractNodeConfig,
} from "./schema"

export const textExtractNodeManifest: NodeManifest<TextExtractNodeConfig> = {
  type: TEXT_EXTRACT_WORKFLOW_NODE_TYPE,
  title: "文本提取",
  icon: FileSearch,
  color: "bg-primary/10",
  defaultConfig: {
    filePath: "",
    variables: [],
  },
  ports: {
    inputs: [{ id: "in", label: "输入" }],
    outputs: [{ id: "out", label: "文本" }],
  },
  cardSummary: (config) => ({
    title: "文本提取",
    subtitle: config.filePath || "未设置文档文件",
  }),
  configFields: [
    { name: "filePath", kind: "text", label: "文档文件" },
    { name: "variables", kind: "variable-binding-list", label: "变量绑定" },
  ],
  configSchema: textExtractNodeConfigSchema,
  share: {
    selfContained: false,
    capability: {
      id: TEXT_EXTRACTOR_CAPABILITY_ID,
      minVersion: "1.0.0",
      installSourceId: "synapse.builtin",
    },
    resources: [{
      path: ["filePath"],
      entryType: "file",
      cardinality: "one",
      access: "read",
    }],
  },
}
