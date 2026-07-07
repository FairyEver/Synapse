import { Network } from "lucide-react"

import type { NodeManifest } from "../../../workflow-nodes/types"
import { SWARM_TASK_WORKFLOW_NODE_TYPE } from "../shared/capability"
import { swarmTaskNodeConfigSchema, type SwarmTaskNodeConfig } from "./schema"

export const swarmTaskNodeManifest: NodeManifest<SwarmTaskNodeConfig> = {
  type: SWARM_TASK_WORKFLOW_NODE_TYPE,
  title: "蜂群任务",
  icon: Network,
  color: "bg-primary/10",
  defaultConfig: {
    taskId: "",
    waitForCompletion: false,
    variables: [],
  },
  ports: { inputs: [{ id: "in", label: "输入" }], outputs: [{ id: "out", label: "输出" }] },
  cardSummary: (config) => ({
    title: "蜂群任务",
    subtitle: config.taskId || "未设置任务",
  }),
  configFields: [
    { name: "taskId", kind: "text", label: "任务 ID" },
    { name: "promptOverride", kind: "text", label: "提示词覆盖", optional: true },
    { name: "runModeOverride", kind: "select", label: "运行模式", optional: true },
    { name: "maxRoundsOverride", kind: "number", label: "最大轮次", optional: true },
    { name: "concurrencyOverride", kind: "number", label: "并发数", optional: true },
    { name: "waitForCompletion", kind: "record", label: "等待完成", optional: true },
    { name: "variables", kind: "variable-binding-list", label: "变量绑定" },
  ],
  configSchema: swarmTaskNodeConfigSchema,
}
