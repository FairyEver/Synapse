import type { Address, MailInputs, MailSummary } from "./types"

export type MailFilters = Omit<MailInputs["message.list"], "accountId" | "cursor" | "limit">
export const normalizeMailText = (text: string): string => text.normalize("NFKC").toLocaleLowerCase("und")
function matchesAddress(addresses: Address[], query: string): boolean {
  const term = normalizeMailText(query)
  return addresses.some(address => term.includes("@")
    ? normalizeMailText(address.address) === term
    : normalizeMailText(address.name ?? "").includes(term))
}
export function matchesMailFilters(message: Omit<MailSummary, "revision">, filters: MailFilters): boolean {
  if (message.stale || (filters.folderId && filters.folderId !== message.locator.folderId)) return false
  if (filters.unreadOnly && message.read || filters.starredOnly && !message.star) return false
  if ((filters.from || filters.to) && !message.date) return false
  if (filters.from && Date.parse(message.date!) < Date.parse(filters.from) || filters.to && Date.parse(message.date!) > Date.parse(filters.to)) return false
  if ((filters.receivedAfter || filters.receivedBefore) && !message.receivedAt) return false
  if (filters.receivedAfter && Date.parse(message.receivedAt!) < Date.parse(filters.receivedAfter) || filters.receivedBefore && Date.parse(message.receivedAt!) >= Date.parse(filters.receivedBefore)) return false
  if (filters.sender && !matchesAddress(message.from, filters.sender)) return false
  if (filters.recipient && !matchesAddress([...message.to, ...message.cc], filters.recipient)) return false
  return !filters.subject || normalizeMailText(message.subject).includes(normalizeMailText(filters.subject))
}
export function matchesMailText(message: Omit<MailSummary, "revision">, query: string, body = ""): boolean {
  const haystack = normalizeMailText([message.subject, message.snippet, ...[...message.from, ...message.to, ...message.cc].flatMap(a => [a.address, a.name ?? ""]), body].join("\n"))
  return haystack.includes(normalizeMailText(query))
}
