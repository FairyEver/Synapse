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
    { name: "projectId", kind: "string", required: false, description: "Optional existing Synapse project. Uses its Terminal group and current launch settings, exactly like its plus button; its working directory takes precedence over Automation cwd. Omit to keep the existing default group/cwd behavior. An unavailable selected project fails without launching elsewhere." },
    { name: "command", kind: "string", required: true, description: "Literal user command entered into the ordinary interactive terminal after shell and measured desktop grid readiness, with no command allowlist or -c/eval wrapper. Reliable completion currently requires zsh/bash. Trigger variables are not interpolated. Configure program arguments or file redirection in the command itself." },
    { name: "autoClose", kind: "boolean", required: false, defaultValue: true, description: "Close this terminal after persisting output and exit status. False retains a reusable interactive shell unless the command exits it." },
    { name: "timeoutMins", kind: "number", required: false, defaultValue: 30, description: "Execution timeout in minutes (1–1440). Null disables timeout. Cancellation still stops this execution." },
  ],
} satisfies ActionManifest<TerminalActionConfig>
