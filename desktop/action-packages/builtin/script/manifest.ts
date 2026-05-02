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
  configFields: [
    {
      name: "script",
      kind: "string",
      required: true,
      description: "Shell script content to run.",
      defaultValue: "",
    },
    {
      name: "shell",
      kind: "enum",
      required: true,
      description: "Shell runtime.",
      choices: ["posix", "cmd", "powershell"],
      defaultValue: "posix",
    },
    {
      name: "env",
      kind: "record",
      required: false,
      description: "Additional environment variables.",
    },
    {
      name: "timeoutMins",
      kind: "number",
      required: false,
      description: "Timeout in minutes. Null disables the timeout.",
      defaultValue: 30,
    },
  ],
  configSchema: scriptActionConfigSchema,
} satisfies ActionManifest<ScriptActionConfig>
