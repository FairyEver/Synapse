export const TERMINAL_COMMAND_ENTER_DELAY_MS = 10

/**
 * 按 bracketed paste 把一段内容包成一个粘贴块。
 *
 * 只在应用自己开了 bracketed paste（DECSET 2004）时才包：多行句子原样写进 PTY，
 * 行规程会把第二个换行当成行终止符执行掉。没开就原样返回，免得在认不出这个序列
 * 的应用里显示成乱码。
 */
export function wrapBracketedPaste(content: string, enabled: boolean): string {
  return enabled ? `\x1b[200~${content}\x1b[201~` : content
}

export function buildTerminalCommandWrites(command: string): readonly string[] {
  const normalized = command
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
  const body = normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized

  return body.split("\n").flatMap((line) => line ? [line, "\r"] : ["\r"])
}
