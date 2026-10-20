import { Fragment } from "react"
import { driveSearchTerms, normalizeDriveSearchText } from "@synapse/shared/drive-search"

export function driveSearchHighlightParts(text: string, query: string): readonly { value: string; match: boolean }[] {
  const terms = driveSearchTerms(query)
  if (!terms.length) return [{ value: text, match: false }]
  const segments = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)]
  let normalized = ""
  const mapping: { from: number; to: number; start: number; end: number }[] = []
  for (const segment of segments) {
    const value = normalizeDriveSearchText(segment.segment)
    mapping.push({ from: normalized.length, to: normalized.length + value.length, start: segment.index, end: segment.index + segment.segment.length })
    normalized += value
  }
  const selected = new Set<number>()
  for (const term of terms) {
    let offset = normalized.indexOf(term)
    while (offset >= 0) {
      mapping.forEach((part, index) => { if (part.from < offset + term.length && part.to > offset) selected.add(index) })
      offset = normalized.indexOf(term, offset + 1)
    }
  }
  const parts: { value: string; match: boolean }[] = []
  mapping.forEach((part, index) => {
    const match = selected.has(index)
    const value = text.slice(part.start, part.end)
    const last = parts.at(-1)
    if (last && last.match === match) last.value += value
    else parts.push({ value, match })
  })
  return parts
}

export function DriveSearchHighlight({ text, query }: { text: string; query: string }) {
  return <>{driveSearchHighlightParts(text, query).map((part, index) => part.match
    ? <mark key={index} className="rounded-sm bg-secondary text-secondary-foreground font-semibold">{part.value}</mark>
    : <Fragment key={index}>{part.value}</Fragment>)}</>
}
