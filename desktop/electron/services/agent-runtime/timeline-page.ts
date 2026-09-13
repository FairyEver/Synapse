/** Build a contiguous tail page without expanding to a whole user turn. */
export function boundedTimelinePage<T>(options: {
  readonly endIndex: number
  readonly limit: number
  readonly maxBytes: number
  readonly project: (index: number) => T
}): { entries: T[]; startIndex: number } {
  const entries: T[] = []
  let startIndex = options.endIndex
  const lowerBound = Math.max(0, options.endIndex - Math.min(options.limit, 100))
  let bytes = 2 // JSON array brackets
  for (let index = options.endIndex - 1; index >= lowerBound; index -= 1) {
    const entry = options.project(index)
    const entryBytes = Buffer.byteLength(JSON.stringify(entry), "utf8") + (entries.length > 0 ? 1 : 0)
    if (bytes + entryBytes > options.maxBytes) {
      // Never return an empty page that cannot advance its cursor.
      if (entries.length === 0) throw new Error("Timeline entry exceeds page byte budget")
      break
    }
    entries.push(entry)
    bytes += entryBytes
    startIndex = index
  }
  return { entries: entries.reverse(), startIndex }
}
