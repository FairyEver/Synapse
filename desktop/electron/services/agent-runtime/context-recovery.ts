import path from "node:path"

import type { ConversationEntryV1 } from "../../runtime/data-repo"
import { redactSensitiveText } from "./redaction"

export const CONTEXT_RECOVERY_HANDOFF_MAX_BYTES = 32 * 1024
const MAX_HANDOFF_TEXT_CHARS = 8_000
const MAX_HANDOFF_FILES = 20

export function buildContextRecoveryHandoff(input: {
  readonly conversation: ConversationEntryV1
  readonly workspacePath?: string
}): string {
  const history = input.conversation.history
  const latestUserIndex = findLastIndex(history, (entry) => entry.role === "user")
  const latestUser = latestUserIndex >= 0 ? history[latestUserIndex] : undefined
  const latestAssistant = findLast(history, (entry) => entry.role === "assistant")
  const failedTurnEntries = latestUserIndex >= 0 ? history.slice(latestUserIndex + 1) : []
  const toolStates = failedTurnEntries
    .filter((entry) => entry.role === "tool")
    .map((entry) => {
      const toolName = stringValue(entry.metadata?.toolName) ?? "tool"
      const status = stringValue(entry.metadata?.status)
        ?? (entry.metadata?.success === true ? "completed" : entry.metadata?.success === false ? "failed" : "observed")
      const inputSummary = stringValue(entry.metadata?.toolInputSummary)
      return `${toolName}: ${status}${inputSummary ? `; input ${inputSummary}` : ""}`
    })
    .slice(-20)
  const files = collectRelativeFiles(failedTurnEntries, input.workspacePath)
  const attachments = collectAttachmentLabels(latestUser?.metadata)

  const sections = [
    "<synapse_context_recovery>",
    "这是一次上下文恢复交接。先检查工作区和相关外部状态，再决定如何继续；不要假定先前操作失败，也不要直接重放任何工具调用。",
    latestUser ? `最近用户请求：\n${safeContextHandoffText(presentedUserContent(latestUser))}` : undefined,
    latestAssistant ? `最近有效回复：\n${safeContextHandoffText(latestAssistant.content)}` : undefined,
    toolStates.length > 0 ? `失败轮已观察到的工具状态：\n${toolStates.map((item) => `- ${safeContextHandoffText(item)}`).join("\n")}` : undefined,
    files.length > 0 ? `相关工作区文件：\n${files.map((item) => `- ${item}`).join("\n")}` : undefined,
    attachments.length > 0 ? `相关附件引用：\n${attachments.map((item) => `- ${safeContextHandoffText(item)}`).join("\n")}` : undefined,
    "</synapse_context_recovery>",
  ].filter((value): value is string => Boolean(value))

  return truncateUtf8(sections.join("\n\n"), CONTEXT_RECOVERY_HANDOFF_MAX_BYTES)
}

function presentedUserContent(entry: ConversationEntryV1["history"][number]): string {
  const presentation = entry.metadata?.userMessagePresentation
  if (isRecord(presentation) && typeof presentation.content === "string") return presentation.content
  return entry.content
}

function collectAttachmentLabels(metadata: Record<string, unknown> | undefined): string[] {
  const attachments = metadata?.attachments
  if (!Array.isArray(attachments)) return []
  return attachments.flatMap((attachment) => {
    if (!isRecord(attachment)) return []
    const kind = stringValue(attachment.kind) ?? stringValue(attachment.entryType) ?? "attachment"
    const name = stringValue(attachment.name)
    return name ? [`${kind}: ${name}`] : [kind]
  }).slice(0, 20)
}

function collectRelativeFiles(
  entries: readonly ConversationEntryV1["history"][number][],
  workspacePath: string | undefined,
): string[] {
  const files = entries.flatMap((entry) => Array.isArray(entry.metadata?.files) ? entry.metadata.files : [])
  const result: string[] = []
  for (const file of files) {
    if (!isRecord(file)) continue
    const raw = stringValue(file.relativePath) ?? stringValue(file.path)
    if (!raw) continue
    const relative = safeRelativePath(raw, workspacePath)
    if (!relative || result.includes(relative)) continue
    result.push(relative)
    if (result.length >= MAX_HANDOFF_FILES) break
  }
  return result
}

function safeRelativePath(value: string, workspacePath: string | undefined): string | undefined {
  if (!path.isAbsolute(value)) {
    const normalized = path.normalize(value)
    return normalized === ".." || normalized.startsWith(`..${path.sep}`) ? undefined : normalized
  }
  if (!workspacePath) return undefined
  const relative = path.relative(workspacePath, value)
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return undefined
  }
  return relative
}

export function safeContextHandoffText(value: string, maxChars = MAX_HANDOFF_TEXT_CHARS): string {
  return redactSensitiveText(value)
    .replace(/data:[^;,\s]+;base64,[A-Za-z0-9+/=\s]+/gi, "[base64 omitted]")
    .replace(/(^|[\s"'=(:])\/(?:[^\s"'<>]+\/?)+/gm, "$1[absolute-path]")
    .replace(/\b[A-Za-z]:\\(?:[^\s"'<>]+\\?)+/g, "[absolute-path]")
    .slice(0, maxChars)
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value
  let low = 0
  let high = value.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (Buffer.byteLength(value.slice(0, middle), "utf8") <= maxBytes) low = middle
    else high = middle - 1
  }
  return value.slice(0, low)
}

function findLastIndex<T>(values: readonly T[], predicate: (value: T) => boolean): number {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const value = values[index]
    if (value !== undefined && predicate(value)) return index
  }
  return -1
}

function findLast<T>(values: readonly T[], predicate: (value: T) => boolean): T | undefined {
  const index = findLastIndex(values, predicate)
  return index >= 0 ? values[index] : undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
