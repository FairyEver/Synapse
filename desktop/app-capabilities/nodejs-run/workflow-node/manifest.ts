import { SquareTerminal } from "lucide-react"
import type { NodeManifest } from "../../../workflow-nodes/types"
import { NODEJS_RUN_CAPABILITY_ID, NODEJS_RUN_CAPABILITY_VERSION, NODEJS_RUN_WORKFLOW_NODE_TYPE } from "../../script-runtime/shared/capability"
import {
  nodejsWorkflowConfigSchema,
  type NodejsWorkflowConfig,
} from "../../script-runtime/shared/schema"

export const nodejsRunNodeManifest: NodeManifest<NodejsWorkflowConfig> = {
  type: NODEJS_RUN_WORKFLOW_NODE_TYPE,
  title: "Node.js 运行",
  icon: SquareTerminal,
  color: "bg-primary/10",
  defaultConfig: {
    source: "",
    inputs: [],
    timeoutSeconds: 60,
    saveRunContent: true,
    moduleMode: "commonjs",
  },
  ports: {
    inputs: [{ id: "in", label: "输入" }],
    outputs: [{ id: "out", label: "结果" }],
  },
  publicOutputs: ["result"],
  cardSummary: (config) => ({
    title: config.moduleMode === "esm" ? "Node.js · ESM" : "Node.js · CommonJS",
    subtitle: config.source.trim().split(/\r?\n/, 1)[0] || "未编写脚本",
  }),
  configFields: [
    { name: "source", kind: "text", label: "脚本" },
    { name: "inputs", kind: "record", label: "输入" },
    { name: "moduleMode", kind: "select", label: "模块模式" },
    { name: "workingDirectory", kind: "text", label: "工作目录", optional: true },
    { name: "timeoutSeconds", kind: "number", label: "超时秒数" },
    { name: "saveRunContent", kind: "boolean", label: "保存运行内容" },
  ],
  configSchema: nodejsWorkflowConfigSchema,
  share: {
    selfContained: false,
    capability: {
      id: NODEJS_RUN_CAPABILITY_ID,
      minVersion: NODEJS_RUN_CAPABILITY_VERSION,
    },
    risks: [{ path: ["source"], id: "local-code.execute", when: "present" }],
    portabilityWarnings: ["node-local-dependencies", "node-working-directory"],
  },
}
