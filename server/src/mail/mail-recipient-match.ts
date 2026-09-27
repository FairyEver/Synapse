export function recipientMatch(query: string, values: (string | null)[]): { matchKind: "exact" | "prefix" | "partial" | "fuzzy"; similarity: number } | null {
  const term = query.trim().toLocaleLowerCase()
  const names = values.filter((value): value is string => !!value).map((value) => value.toLocaleLowerCase())
  if (names.includes(term)) return { matchKind: "exact", similarity: 1 }
  if (names.some((value) => value.startsWith(term))) return { matchKind: "prefix", similarity: 0.8 }
  if (names.some((value) => value.includes(term))) return { matchKind: "partial", similarity: 0.65 }
  const similarity = Math.max(0, ...names.map((value) => 1 - distance(term, value) / Math.max(term.length, value.length)))
  return similarity >= 0.45 ? { matchKind: "fuzzy", similarity } : null
}

function distance(left: string, right: string): number {
  let prior = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let row = 1; row <= left.length; row += 1) {
    const next = [row]
    for (let column = 1; column <= right.length; column += 1) {
      next[column] = Math.min(next[column - 1]! + 1, prior[column]! + 1, prior[column - 1]! + (left[row - 1] === right[column - 1] ? 0 : 1))
    }
    prior = next
  }
  return prior[right.length]!
}
