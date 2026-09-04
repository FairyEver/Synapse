export const TERMINAL_COMMAND_ENTER_DELAY_MS = 10

export function buildTerminalCommandWrites(command: string): readonly string[] {
  const normalized = command
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
  const body = normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized

  return body.split("\n").flatMap((line) => line ? [line, "\r"] : ["\r"])
}
