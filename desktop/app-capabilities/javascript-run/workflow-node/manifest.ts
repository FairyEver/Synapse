import { Braces } from "lucide-react"
import type { NodeManifest } from "../../../workflow-nodes/types"
import { JAVASCRIPT_RUN_CAPABILITY_ID, JAVASCRIPT_RUN_CAPABILITY_VERSION, JAVASCRIPT_RUN_WORKFLOW_NODE_TYPE } from "../../script-runtime/shared/capability"
import {
  javascriptWorkflowConfigSchema,
  type JavascriptWorkflowConfig,
} from "../../script-runtime/shared/schema"

export const javascriptRunNodeManifest: NodeManifest<JavascriptWorkflowConfig> = {
  type: JAVASCRIPT_RUN_WORKFLOW_NODE_TYPE,
  title: "JavaScript 运行",
  icon: Braces,
  color: "bg-primary/10",
  defaultConfig: {
    source: "",
    inputs: [],
    timeoutSeconds: 60,
    saveRunContent: true,
  },
  ports: {
    inputs: [{ id: "in", label: "输入" }],
    outputs: [{ id: "out", label: "结果" }],
  },
  publicOutputs: ["result"],
  cardSummary: (config) => ({
    title: "JavaScript",
    subtitle: config.source.trim().split(/\r?\n/, 1)[0] || "未编写脚本",
  }),
  configFields: [
    { name: "source", kind: "text", label: "脚本" },
    { name: "inputs", kind: "record", label: "输入" },
    { name: "timeoutSeconds", kind: "number", label: "超时秒数" },
    { name: "saveRunContent", kind: "boolean", label: "保存运行内容" },
  ],
  configSchema: javascriptWorkflowConfigSchema,
  share: {
    selfContained: true,
    capability: {
      id: JAVASCRIPT_RUN_CAPABILITY_ID,
      minVersion: JAVASCRIPT_RUN_CAPABILITY_VERSION,
    },
    risks: [{ path: ["source"], id: "javascript.execute", when: "present" }],
  },
}
