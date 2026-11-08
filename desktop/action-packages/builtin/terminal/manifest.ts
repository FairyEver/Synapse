import type { ActionManifest } from "../../types"
import { terminalActionConfigSchema, type TerminalActionConfig } from "./schema"

export const terminalActionManifest = {
  id: "builtin.terminal",
  title: "终端",
  permissions: ["shell.exec"],
  previousOutputs: "none",
  defaultConfig: { command: "", autoClose: true, timeoutMins: 30 },
  configSchema: terminalActionConfigSchema,
  configFields: [
    { name: "command", kind: "string", required: true, description: "Literal user command, run by the configured terminal shell with no command allowlist. Trigger variables are not interpolated into command text. Configure program arguments or file redirection in the command itself." },
    { name: "autoClose", kind: "boolean", required: false, defaultValue: true, description: "Close this terminal after persisting output and exit status. False retains an ended read-only terminal." },
    { name: "timeoutMins", kind: "number", required: false, defaultValue: 30, description: "Execution timeout in minutes (1–1440). Null disables timeout. Cancellation still stops this execution." },
  ],
} satisfies ActionManifest<TerminalActionConfig>
