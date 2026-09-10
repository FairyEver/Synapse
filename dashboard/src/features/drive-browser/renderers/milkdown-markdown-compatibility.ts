type MarkdownFence = {
  readonly marker: '`' | '~'
  readonly length: number
}

type MarkdownSourceLine = {
  readonly content: string
  readonly ending: string
  readonly line: string
  readonly prose: boolean
}

const COMMONMARK_URI_AUTOLINK_VALUE_PATTERN = String.raw`[A-Za-z][A-Za-z0-9+.-]{1,31}:[^<>\s]*`
const COMMONMARK_EMAIL_AUTOLINK_VALUE_PATTERN = '[A-Za-z0-9.!#$%&\'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?'
const COMMONMARK_EXPLICIT_AUTOLINK_PATTERN = new RegExp(
  `<(${COMMONMARK_URI_AUTOLINK_VALUE_PATTERN}|${COMMONMARK_EMAIL_AUTOLINK_VALUE_PATTERN})>`,
  'gu',
)
const COMMONMARK_AUTOLINK_TOKEN_PATTERN = new RegExp(
  `<(${COMMONMARK_URI_AUTOLINK_VALUE_PATTERN}|${COMMONMARK_EMAIL_AUTOLINK_VALUE_PATTERN})>|https?:\\/\\/[^\\s<>()]*[^\\s<>()\\].,!?:;]|${COMMONMARK_EMAIL_AUTOLINK_VALUE_PATTERN}`,
  'gu',
)

export function requiresMilkdownSourceMode(markdown: string): boolean {
  const normalizedMarkdown = markdown.replace(/^\uFEFF/u, '')
  if (hasLinkReferenceDefinition(normalizedMarkdown)) return true
  const lines = normalizedMarkdown.split(/\r?\n/u)
  const marker = lines[0]?.trim()
  if (marker !== '---' && marker !== '+++') return false
  const closingIndex = lines.slice(1).findIndex((line) => {
    const value = line.trim()
    return value === marker || (marker === '---' && value === '...')
  })
  return closingIndex >= 0
}

export function preserveMilkdownCommonMarkAutolinks(markdown: string, sourceMarkdown: string): string {
  const sourceLines = sourceMarkdown.split(/\r?\n/u)
  const markdownParts = markdown.split(/(\r?\n)/u)
  const markdownLines = markdownParts.filter((_, index) => index % 2 === 0)
  const sourceCanonicalLines = canonicalizeMilkdownAutolinks(sourceMarkdown).split(/\r?\n/u)
  const markdownCanonicalLines = canonicalizeMilkdownAutolinks(markdown).split(/\r?\n/u)
  const sourceLineByMarkdownLine = matchMilkdownAutolinkSourceLines(
    sourceLines,
    markdownLines,
    sourceCanonicalLines,
    markdownCanonicalLines,
  )
  const sourcePreferences = collectCommonMarkAutolinkPreferences(sourceMarkdown)
  const markdownPreferences = collectCommonMarkAutolinkPreferences(markdown)
  const uniquePreferences = new Map(Array.from(sourcePreferences.entries()).flatMap(([value, preferences]) => (
    preferences.length === 1 && markdownPreferences.get(value)?.length === 1
      ? [[value, preferences[0]] as const]
      : []
  )))

  return markdownParts.map((part, partIndex) => {
    if (partIndex % 2 === 1) return part
    const sourceLineIndex = sourceLineByMarkdownLine.get(partIndex / 2)
    const preferences = sourceLineIndex === undefined
      ? null
      : collectCommonMarkAutolinkPreferences(sourceLines[sourceLineIndex] ?? '')
    return transformMilkdownInlineProse(part, (proseText) => proseText.replace(
      COMMONMARK_EXPLICIT_AUTOLINK_PATTERN,
      (autolink, value: string) => (
        preferences?.get(value)?.shift() === 'bare' || (!preferences && uniquePreferences.get(value) === 'bare')
          ? value
        : autolink
      ),
    ))
  }).join('')
}

function hasLinkReferenceDefinition(markdown: string): boolean {
  return scanMarkdownSourceLines(markdown).some(({ content, prose }) => (
    prose && /^\[(?:\\.|[^\]\\])+\]:/u.test(content)
  ))
}

function canonicalizeMilkdownAutolinks(markdown: string): string {
  return transformMilkdownMarkdownProse(markdown, (prose) => prose.replace(
    COMMONMARK_EXPLICIT_AUTOLINK_PATTERN,
    '$1',
  ))
}

function matchMilkdownAutolinkSourceLines(
  sourceLines: readonly string[],
  markdownLines: readonly string[],
  sourceCanonicalLines: readonly string[],
  markdownCanonicalLines: readonly string[],
): Map<number, number> {
  const sourceLineByMarkdownLine = new Map<number, number>()
  const sourceGroups = new Map<string, number[]>()
  const markdownCounts = new Map<string, number>()
  const markdownOccurrences = new Map<string, number>()
  sourceCanonicalLines.forEach((line, index) => {
    const indexes = sourceGroups.get(line) ?? []
    indexes.push(index)
    sourceGroups.set(line, indexes)
  })
  markdownCanonicalLines.forEach((line) => markdownCounts.set(line, (markdownCounts.get(line) ?? 0) + 1))

  markdownCanonicalLines.forEach((canonicalLine, markdownIndex) => {
    const sourceIndexes = sourceGroups.get(canonicalLine) ?? []
    if (sourceIndexes.length === 0) return
    const occurrence = markdownOccurrences.get(canonicalLine) ?? 0
    markdownOccurrences.set(canonicalLine, occurrence + 1)
    if (sourceIndexes.length === markdownCounts.get(canonicalLine)) {
      const sourceIndex = sourceIndexes[occurrence]
      if (sourceIndex !== undefined) sourceLineByMarkdownLine.set(markdownIndex, sourceIndex)
      return
    }
    const exactSourceIndexes = sourceIndexes.filter((sourceIndex) => sourceLines[sourceIndex] === markdownLines[markdownIndex])
    if (exactSourceIndexes.length === 1) {
      sourceLineByMarkdownLine.set(markdownIndex, exactSourceIndexes[0] as number)
      return
    }
    const preferenceSignatures = new Set(sourceIndexes.map((sourceIndex) => (
      JSON.stringify(Array.from(collectCommonMarkAutolinkPreferences(sourceLines[sourceIndex] ?? '').entries()))
    )))
    if (preferenceSignatures.size !== 1) return
    const sourceIndex = sourceIndexes[Math.min(occurrence, sourceIndexes.length - 1)]
    if (sourceIndex !== undefined) sourceLineByMarkdownLine.set(markdownIndex, sourceIndex)
  })
  return sourceLineByMarkdownLine
}

function collectCommonMarkAutolinkPreferences(markdown: string): Map<string, Array<'bare' | 'explicit'>> {
  const preferences = new Map<string, Array<'bare' | 'explicit'>>()
  transformMilkdownMarkdownProse(markdown, (prose) => {
    for (const match of prose.matchAll(COMMONMARK_AUTOLINK_TOKEN_PATTERN)) {
      const token = match[1] ?? match[0]
      const explicit = match[1] !== undefined
      const previousCharacter = prose[(match.index ?? 0) - 1] ?? ''
      if (!explicit && /[:<(]/u.test(previousCharacter)) continue
      const entries = preferences.get(token) ?? []
      entries.push(explicit ? 'explicit' : 'bare')
      preferences.set(token, entries)
    }
    return prose
  })
  return preferences
}

function transformMilkdownMarkdownProse(markdown: string, transform: (prose: string) => string): string {
  return scanMarkdownSourceLines(markdown).map(({ ending, line, prose }) => (
    `${prose ? transformMilkdownInlineProse(line, transform) : line}${ending}`
  )).join('')
}

function scanMarkdownSourceLines(markdown: string): readonly MarkdownSourceLine[] {
  const parts = markdown.split(/(\r?\n)/u)
  const lines: MarkdownSourceLine[] = []
  let fence: MarkdownFence | null = null

  for (let index = 0; index < parts.length; index += 2) {
    const line = parts[index] ?? ''
    const ending = parts[index + 1] ?? ''
    const content = stripMarkdownContainerPrefix(line)
    const fenceMatch = /^(`{3,}|~{3,})(.*)$/u.exec(content)
    if (fenceMatch?.[1]) {
      const marker = fenceMatch[1][0] as MarkdownFence['marker']
      if (!fence) fence = { marker, length: fenceMatch[1].length }
      else if (
        marker === fence.marker
        && fenceMatch[1].length >= fence.length
        && /^\s*$/u.test(fenceMatch[2] ?? '')
      ) fence = null
      lines.push({ content, ending, line, prose: false })
      continue
    }
    lines.push({ content, ending, line, prose: fence === null })
  }

  return lines
}

function stripMarkdownContainerPrefix(line: string): string {
  let content = line
  while (true) {
    const indented = /^ {0,3}/u.exec(content)?.[0] ?? ''
    content = content.slice(indented.length)
    const quote = /^> ?/u.exec(content)?.[0]
    if (quote) {
      content = content.slice(quote.length)
      continue
    }
    const list = /^(?:[-+*]|\d{1,9}[.)])(?:[ \t]+)/u.exec(content)?.[0]
    if (list) {
      content = content.slice(list.length)
      continue
    }
    return content
  }
}

function transformMilkdownInlineProse(line: string, transform: (prose: string) => string): string {
  let result = ''
  let cursor = 0
  while (cursor < line.length) {
    const openingIndex = line.indexOf('`', cursor)
    if (openingIndex < 0) return result + transform(line.slice(cursor))
    result += transform(line.slice(cursor, openingIndex))
    const marker = /^`+/u.exec(line.slice(openingIndex))?.[0] ?? '`'
    let closingIndex = openingIndex + marker.length
    while (closingIndex < line.length) {
      closingIndex = line.indexOf(marker, closingIndex)
      if (closingIndex < 0) return result + transform(line.slice(openingIndex))
      const beforeIsBacktick = line[closingIndex - 1] === '`'
      const afterIsBacktick = line[closingIndex + marker.length] === '`'
      if (!beforeIsBacktick && !afterIsBacktick) break
      closingIndex += marker.length
    }
    result += line.slice(openingIndex, closingIndex + marker.length)
    cursor = closingIndex + marker.length
  }
  return result
}
