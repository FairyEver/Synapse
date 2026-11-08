import { redactSensitiveText } from "../../../src/lib/agent-redaction"

/** Presentation only: never send this text to the PTY or treat it as program stdout. */
export function formatAutomationLaunchOutput(cwd: string, command: string): string {
  const display = (value: string) => redactSensitiveText(value)
    .replace(/\r\n?/g, "\n")
    .replace(/\p{Cc}/gu, character => character === "\n" ? character : `\\x${character.charCodeAt(0).toString(16).padStart(2, "0")}`)
    .replace(/\n/g, "\r\n")
  return `工作目录: ${display(cwd)}\r\n执行命令: ${display(command)}\r\n\r\n`
}
