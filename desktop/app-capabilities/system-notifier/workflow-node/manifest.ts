import { Bell } from "lucide-react"
import type { NodeManifest } from "../../../workflow-nodes/types"
import {
  SYSTEM_NOTIFIER_CAPABILITY_VERSION,
  SYSTEM_NOTIFIER_TRIGGER_CAPABILITY_ID,
  SYSTEM_NOTIFIER_WORKFLOW_NODE_TYPE,
} from "../shared/capability"
import {
  systemNotifierNodeConfigSchema,
  type SystemNotifierNodeConfig,
} from "./schema"

export const systemNotifierNodeManifest: NodeManifest<SystemNotifierNodeConfig> = {
  type: SYSTEM_NOTIFIER_WORKFLOW_NODE_TYPE,
  title: "系统通知",
  icon: Bell,
  color: "bg-primary/10",
  defaultConfig: {
    title: "",
    body: "",
    variables: [],
  },
  ports: {
    inputs: [{ id: "in", label: "输入" }],
    outputs: [{ id: "out", label: "结果" }],
  },
  cardSummary: (config) => ({
    title: "系统通知",
    subtitle: config.title || "未设置标题",
  }),
  configFields: [
    { name: "title", kind: "text", label: "标题" },
    { name: "body", kind: "text", label: "正文" },
    { name: "variables", kind: "variable-binding-list", label: "变量绑定" },
  ],
  configSchema: systemNotifierNodeConfigSchema,
  share: {
    selfContained: false,
    capability: {
      id: SYSTEM_NOTIFIER_TRIGGER_CAPABILITY_ID,
      minVersion: SYSTEM_NOTIFIER_CAPABILITY_VERSION,
      installSourceId: "synapse.builtin",
    },
  },
}
