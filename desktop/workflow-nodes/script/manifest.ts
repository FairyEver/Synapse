import { Terminal } from "lucide-react"
import type { NodeManifest } from "../types"
import { builtinWorkflowNodeCapability } from "../share-contract"
import type { ScriptNodeConfig } from "./schema"
import { scriptNodeConfigSchema } from "./schema"

export const scriptNodeManifest: NodeManifest<ScriptNodeConfig> = {
  type: "script",
  title: "脚本",
  icon: Terminal,
  color: "bg-primary/10",
  defaultConfig: { variables: [] } as unknown as ScriptNodeConfig,
  ports: { inputs: [{ id: "in", label: "输入" }], outputs: [{ id: "out", label: "输出" }] },
  cardSummary: (c) => ({
    title: `${c.shell ?? "默认"} 脚本`,
    subtitle: c.script ? c.script.slice(0, 60) : "未编写脚本",
  }),
  configFields: [
    { name: "shell", kind: "select", label: "Shell" },
    { name: "script", kind: "text", label: "脚本" },
    { name: "variables", kind: "variable-binding-list", label: "变量绑定" },
  ],
  configSchema: scriptNodeConfigSchema,
  share: {
    selfContained: false,
    capability: builtinWorkflowNodeCapability("script"),
    projects: [{ path: ["projectId"], inheritFromWorkflow: true }],
    sensitive: [{ path: ["env", "*"] }],
    risks: [{ path: ["script"], id: "shell.execute", when: "present" }],
    runtimes: [{
      path: ["shell"],
      capabilityByValue: {
        posix: { id: "runtime.shell.posix", minVersion: "1.0.0" },
        cmd: { id: "runtime.shell.cmd", minVersion: "1.0.0" },
        powershell: { id: "runtime.shell.powershell", minVersion: "1.0.0" },
      },
    }],
    portabilityWarnings: ["script-platform-syntax"],
  },
}
