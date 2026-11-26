import type { AutomationTriggerEvent } from "../../types.shared"
import type { MailReceivedConfig } from "./schema"

const REPLY_OR_FORWARD_SUBJECT_PATTERN = /^\s*(?:re|fwd|fw|回复|答复|转发)\s*[:：]/iu

const normalize = (value: string): string => value.normalize("NFKC").toLocaleLowerCase("und")

export function hasMailReceivedFilters(config: MailReceivedConfig): boolean {
  return Boolean(config.senderMatches?.length || config.subjectContains?.length || config.originalOnly)
}

export function countMailReceivedFilters(config: MailReceivedConfig): number {
  let count = 0
  if (config.senderMatches?.length) count += 1
  if (config.subjectContains?.length) count += 1
  if (config.originalOnly) count += 1
  return count
}

export function summarizeMailReceivedConfig(config: MailReceivedConfig): string {
  const base = config.accountId ? "指定邮箱账号" : "全部邮箱账号"
  const filterCount = countMailReceivedFilters(config)
  return filterCount > 0 ? `${base} · 已设 ${filterCount} 项筛选` : base
}

export function isReplyOrForwardMail(subject: string, hasReferences: boolean): boolean {
  return hasReferences || REPLY_OR_FORWARD_SUBJECT_PATTERN.test(subject)
}

function matchesSenderEntry(address: string, entry: string): boolean {
  const normalizedAddress = normalize(address).trim()
  const atIndex = normalizedAddress.lastIndexOf("@")
  if (atIndex <= 0 || atIndex === normalizedAddress.length - 1) return false
  const addressDomain = normalizedAddress.slice(atIndex + 1)
  const normalizedEntry = normalize(entry).trim()
  if (!normalizedEntry) return false
  if (normalizedEntry.startsWith("@")) {
    const domain = normalizedEntry.slice(1)
    return Boolean(domain) && addressDomain === domain
  }
  if (!normalizedEntry.includes("@")) {
    return addressDomain === normalizedEntry
  }
  return normalizedAddress === normalizedEntry
}

export function matchesMailReceivedMetadata(
  config: MailReceivedConfig,
  metadata: {
    readonly fromAddresses: readonly string[]
    readonly subject: string
    readonly hasReferences: boolean
  },
): boolean {
  if (config.originalOnly && isReplyOrForwardMail(metadata.subject, metadata.hasReferences)) {
    return false
  }
  if (config.senderMatches?.length) {
    const matched = metadata.fromAddresses.some(address =>
      config.senderMatches!.some(entry => matchesSenderEntry(address, entry)),
    )
    if (!matched) return false
  }
  if (config.subjectContains?.length) {
    const normalizedSubject = normalize(metadata.subject)
    const matched = config.subjectContains.some(keyword => normalizedSubject.includes(normalize(keyword)))
    if (!matched) return false
  }
  return true
}

function extractSenderAddresses(payload: Record<string, unknown>): string[] {
  if (typeof payload.senderAddresses === "string") {
    try {
      const parsed: unknown = JSON.parse(payload.senderAddresses)
      if (Array.isArray(parsed)) return parsed.filter((value): value is string => typeof value === "string")
    } catch {
      return []
    }
  }
  return []
}

export function matchesMailReceivedEvent(config: MailReceivedConfig, event: AutomationTriggerEvent): boolean {
  if (event.source !== "mail" || event.type !== "message.received") return false
  if (!hasMailReceivedFilters(config)) return true
  const payload = event.payload
  if (typeof payload !== "object" || payload === null) return false
  const record = payload as Record<string, unknown>
  const subject = typeof record.subject === "string" ? record.subject : ""
  const fromAddresses = extractSenderAddresses(record)
  return matchesMailReceivedMetadata(config, { fromAddresses, subject, hasReferences: false })
}
