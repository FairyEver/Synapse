import type { MailSummary } from "./types"

export interface MailFilters { folderId?: string; unreadOnly?: boolean; starredOnly?: boolean; from?: string; to?: string }
export const normalizeMailText = (text: string): string => text.normalize("NFKC").toLocaleLowerCase("und")
export function matchesMailFilters(message: Omit<MailSummary, "revision">, filters: MailFilters): boolean {
  if (message.stale || (filters.folderId && filters.folderId !== message.locator.folderId)) return false
  if (filters.unreadOnly && message.read || filters.starredOnly && !message.star) return false
  if ((filters.from || filters.to) && !message.date) return false
  return !(filters.from && message.date! < filters.from || filters.to && message.date! > filters.to)
}
export function matchesMailText(message: Omit<MailSummary, "revision">, query: string, body = ""): boolean {
  const haystack = normalizeMailText([message.subject, message.snippet, ...[...message.from, ...message.to, ...message.cc].flatMap(a => [a.address, a.name ?? ""]), body].join("\n"))
  return haystack.includes(normalizeMailText(query))
}
