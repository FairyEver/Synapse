import type { ActionManifest } from "../../types"
import {
  commandActionConfigSchema,
  type CommandActionConfig,
} from "./schema"

export const commandActionManifest = {
  id: "builtin.command",
  title: "命令",
  permissions: ["shell.exec"],
  defaultConfig: {
    command: "",
    shell: "posix",
    timeoutMins: 30,
  },
  configFields: [
    {
      name: "command",
      kind: "string",
      required: true,
      description: "Shell command to run.",
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
      name: "pathStrategy",
      kind: "enum",
      required: false,
      description: "How to compute PATH: merge (default) or replace.",
      choices: ["merge", "replace"],
      defaultValue: "merge",
    },
    {
      name: "posixLogin",
      kind: "boolean",
      required: false,
      description: "Launch POSIX shell as login shell (-lc). Default true.",
      defaultValue: true,
    },
    {
      name: "timeoutMins",
      kind: "number",
      required: false,
      description: "Timeout in minutes. Null disables the timeout.",
      defaultValue: 30,
    },
  ],
  configSchema: commandActionConfigSchema,
} satisfies ActionManifest<CommandActionConfig>
