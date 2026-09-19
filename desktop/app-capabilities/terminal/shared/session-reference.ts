/**
 * 终端会话引用的可粘贴文本。
 *
 * 与 cmux 的 Copy IDs 同形态：每行一个 `key=value`，ref 供人读，不可变 UUID 供机器用。不含 pane：
 * 布局树里的 pane 与 session 是 1:1 的，且 `paneId` 不对外寻址，写出来没人能用。
 *
 * 引用只在本次运行内有效——会话不跨重启（ADR 0215），所以复制入口的文案必须一并说明这一点，
 * 不得让这段文本显得长期可用。
 */

export const TERMINAL_SESSION_REFERENCE_PREFIX = "tsr_" as const

export type TerminalSessionReferenceTextInput = {
  readonly workspaceId: string
  readonly sessionRef: string
  readonly sessionId: string
}

export function buildTerminalSessionReferenceText(input: TerminalSessionReferenceTextInput): string {
  const values = [input.workspaceId, input.sessionRef, input.sessionId]
  if (values.some((value) => !value || /\s/.test(value))) {
    throw new Error("invalid_terminal_session_reference_text")
  }
  return [
    `workspace_id=${input.workspaceId}`,
    `session_ref=${input.sessionRef}`,
    `session_id=${input.sessionId}`,
  ].join("\n")
}
