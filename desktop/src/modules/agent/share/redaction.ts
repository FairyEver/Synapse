import { redactSensitiveText } from "@/lib/agent-redaction"

function emailRanges(value: string): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = []
  for (const match of value.matchAll(/@/g)) {
    let start = match.index, end = match.index + 1
    while (start > 0 && /[A-Z0-9.!#$%&'*+/=?^_`{|}~-]/i.test(value[start - 1]!)) start--
    while (end < value.length && /[A-Z0-9.-]/i.test(value[end]!)) end++
    if (start === match.index || !/\.[A-Z]{2,}/i.test(value.slice(match.index + 1, end))) continue
    const previous = ranges.at(-1)
    if (previous && start <= previous.end) previous.end = Math.max(previous.end, end)
    else ranges.push({ start, end })
  }
  return ranges
}

export function redactShareText(value: string, hideEmail: boolean): string {
  const safe = redactSensitiveText(value)
  if (!hideEmail) return safe
  // Markdown decodes entities/escapes and OpenUI evaluates string escapes. Map
  // decoded email spans back to the source so surrounding Markdown/DSL stays intact.
  const spans: { start: number; end: number }[] = []
  let decoded = "", cursor = 0
  const tokens = /&#(?:x([0-9a-f]+)|(\d+));?|&([a-z][a-z0-9]+);|\\u([0-9a-f]{4})|\\x([0-9a-f]{2})|\\([!-/:-@[-`{-~])/gi
  if (safe.search(tokens) < 0) {
    let result = "", position = 0
    for (const { start, end } of emailRanges(safe)) { result += safe.slice(position, start) + "［邮箱已隐藏］"; position = end }
    return result + safe.slice(position)
  }
  const append = (text: string, start: number, end?: number) => {
    decoded += text
    for (let index = 0; index < text.length; index++) spans.push({ start: end === undefined ? start + index : start, end: end ?? start + index + 1 })
  }
  const entityDecoder = document.createElement("textarea")
  for (const match of safe.matchAll(tokens)) {
    const start = match.index
    append(safe.slice(cursor, start), cursor)
    const code = match[1] ? parseInt(match[1], 16) : match[2] ? Number(match[2]) : match[4] ? parseInt(match[4], 16) : match[5] ? parseInt(match[5], 16) : undefined
    if (match[3]) entityDecoder.innerHTML = match[0] // token is an entity only, never markup
    const text = match[3] ? entityDecoder.value : match[6] ?? (code !== undefined && code > 0 && code < 128 ? String.fromCharCode(code) : match[0])
    append(text, start, start + match[0].length)
    cursor = start + match[0].length
  }
  append(safe.slice(cursor), cursor)
  let result = "", position = 0
  for (const range of emailRanges(decoded)) {
    const start = spans[range.start]!.start, end = spans[range.end - 1]!.end
    result += safe.slice(position, start) + "［邮箱已隐藏］"; position = end
  }
  return result + safe.slice(position)
}

export function redactShareState(value: Record<string, unknown>): Record<string, unknown> {
  function redact(item: unknown): unknown {
    if (typeof item === "string") return redactShareText(item, true)
    if (Array.isArray(item)) return item.map(redact)
    if (item && typeof item === "object") return Object.fromEntries(Object.entries(item).map(([key, child]) => [key, redact(child)]))
    return item
  }
  return redact(value) as Record<string, unknown>
}
