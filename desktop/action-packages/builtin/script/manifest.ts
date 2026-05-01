import type { ActionManifest } from "../../types"
import {
  scriptActionConfigSchema,
  type ScriptActionConfig,
} from "./schema"

export const scriptActionManifest = {
  id: "builtin.script",
  title: "脚本",
  permissions: ["shell.exec"],
  defaultConfig: {
    script: "",
    shell: "posix",
    timeoutMins: 30,
  },
  configSchema: scriptActionConfigSchema,
} satisfies ActionManifest<ScriptActionConfig>
