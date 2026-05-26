import { Terminal } from "lucide-react"
import type { NodeManifest } from "../types"
import type { ScriptNodeConfig } from "./schema"
import { scriptNodeConfigSchema } from "./schema"

export const scriptNodeManifest: NodeManifest<ScriptNodeConfig> = {
  type: "script",
  title: "脚本",
  icon: Terminal,
  color: "bg-primary/10",
  defaultConfig: { shell: "posix", variables: [] } as unknown as ScriptNodeConfig,
  ports: { inputs: [{ id: "in", label: "输入" }], outputs: [{ id: "out", label: "输出" }] },
  cardSummary: (c) => ({
    title: `${c.shell} 脚本`,
    subtitle: c.script ? c.script.slice(0, 60) : "未编写脚本",
  }),
  configFields: [
    { name: "shell", kind: "select", label: "Shell" },
    { name: "script", kind: "text", label: "脚本" },
    { name: "variables", kind: "variable-binding-list", label: "变量绑定" },
  ],
  configSchema: scriptNodeConfigSchema,
}
