import { Braces } from "lucide-react"
import type { NodeManifest } from "../../../workflow-nodes/types"
import {
  JSON_REPAIR_CAPABILITY_ID,
  JSON_REPAIR_CAPABILITY_VERSION,
  JSON_REPAIR_WORKFLOW_NODE_TYPE,
} from "../shared/capability"
import {
  jsonRepairNodeConfigSchema,
  type JsonRepairNodeConfig,
} from "./schema"

export const jsonRepairNodeManifest: NodeManifest<JsonRepairNodeConfig> = {
  type: JSON_REPAIR_WORKFLOW_NODE_TYPE,
  title: "JSON 修复",
  icon: Braces,
  color: "bg-primary/10",
  defaultConfig: {
    text: "",
    variables: [],
  },
  ports: {
    inputs: [{ id: "in", label: "输入" }],
    outputs: [{ id: "out", label: "JSON" }],
  },
  cardSummary: () => ({
    title: "JSON 修复",
    subtitle: "",
  }),
  configFields: [
    { name: "text", kind: "text", label: "输入文本" },
    { name: "variables", kind: "variable-binding-list", label: "变量绑定" },
  ],
  configSchema: jsonRepairNodeConfigSchema,
  share: {
    selfContained: false,
    capability: {
      id: JSON_REPAIR_CAPABILITY_ID,
      minVersion: JSON_REPAIR_CAPABILITY_VERSION,
      installSourceId: "synapse.builtin",
    },
  },
}
