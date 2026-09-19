/**
 * 终端会话引用的可粘贴文本。
 *
 * 与 cmux 的 Copy IDs 同形态：每行一个 `key=value`。id 供机器用，title 供人认。标题不是装饰——
 * 只有 id 的话，一个标签里分屏出来的几个会话（标题常常就是「Synapse #2」「Synapse #3」）在任何
 * 一段文字里都认不出谁是谁，人和 agent 都一样，而认不出正是指错对象的起点。
 *
 * 不含 pane：布局树里的 pane 与 session 是 1:1 的，且 `paneId` 不对外寻址，写出来没人能用。
 *
 * 引用只在本次运行内有效——会话不跨重启（ADR 0215），所以复制入口的文案必须一并说明这一点，
 * 不得让这段文本显得长期可用。
 */

export const TERMINAL_SESSION_REFERENCE_PREFIX = "tsr_" as const

export type TerminalSessionReferenceTextInput = {
  readonly workspaceId: string
  readonly workspaceTitle: string
  readonly sessionId: string
  readonly sessionTitle: string
  readonly sessionRef: string
}

export function buildTerminalSessionReferenceText(input: TerminalSessionReferenceTextInput): string {
  const identifiers = [input.workspaceId, input.sessionId, input.sessionRef]
  if (identifiers.some((value) => !value || /\s/.test(value))) {
    throw new Error("invalid_terminal_session_reference_text")
  }
  // 标题是人写的，允许空格；不允许换行——那会把一行拆成两行，破坏 key=value 结构。
  const titles = [input.workspaceTitle, input.sessionTitle]
  if (titles.some((value) => !value.trim() || /[\r\n]/.test(value))) {
    throw new Error("invalid_terminal_session_reference_text")
  }
  return [
    `workspace_id=${input.workspaceId}`,
    `workspace_title=${input.workspaceTitle}`,
    `session_id=${input.sessionId}`,
    `session_title=${input.sessionTitle}`,
    `session_ref=${input.sessionRef}`,
  ].join("\n")
}
