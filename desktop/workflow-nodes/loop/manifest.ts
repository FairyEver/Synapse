import { Repeat } from "lucide-react"
import type { NodeManifest } from "../types"
import type { LoopNodeConfig } from "./schema"
import { loopNodeConfigSchema } from "./schema"

const modeLabel: Record<string, string> = { while: "while", for: "for", forEach: "forEach" }

export const loopNodeManifest: NodeManifest<LoopNodeConfig> = {
  type: "loop",
  title: "循环",
  icon: Repeat,
  color: "bg-secondary",
  defaultConfig: {
    mode: "while",
    maxIterations: 10,
    onError: "stop",
    loopVariables: [],
    subgraph: { nodes: [], edges: [], outputMappings: [] },
  },
  ports: { inputs: [{ id: "in", label: "输入" }], outputs: [{ id: "out", label: "输出" }] },
  cardSummary: (c) => {
    const mode = modeLabel[c.mode] ?? c.mode
    const varInfo = c.loopVariables.length > 0 ? ` · ${c.loopVariables.length} 个变量` : ""
    return { title: `${mode} · 最多 ${c.maxIterations} 次`, subtitle: varInfo }
  },
  configFields: [
    { name: "mode", kind: "select", label: "循环模式" },
    { name: "maxIterations", kind: "text", label: "最大迭代次数" },
    { name: "onError", kind: "select", label: "错误处理" },
  ],
  configSchema: loopNodeConfigSchema,
}
