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
  configSchema: commandActionConfigSchema,
} satisfies ActionManifest<CommandActionConfig>
