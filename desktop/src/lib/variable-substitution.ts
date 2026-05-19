// Matches both escaped (\${{ NAME }}) and unescaped (${{ NAME }}) placeholders.
// Group 1: the backslash escape prefix (if present).
// Group 2: the variable name.
const PLACEHOLDER_REGEX = /(?:(\\)\$|\$)\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g

function isInsideCodeBlock(content: string, matchIndex: number): boolean {
  const before = content.slice(0, matchIndex)
  const fenceCount = (before.match(/^ {0,3}```/gm) ?? []).length
  return fenceCount % 2 === 1
}

export function detectPlaceholders(content: string): string[] {
  const seen = new Set<string>()
  const result: string[] = []

  for (const match of content.matchAll(PLACEHOLDER_REGEX)) {
    const escaped = match[1] === "\\"
    if (escaped) continue
    if (isInsideCodeBlock(content, match.index)) continue

    const name = match[2]
    const key = name.toLowerCase()

    if (!seen.has(key)) {
      seen.add(key)
      result.push(name)
    }
  }

  return result
}

export function applyVariableSubstitutions(
  content: string,
  substitutions: Record<string, string>,
): string {
  const lowerMap = new Map<string, string>()

  for (const [key, value] of Object.entries(substitutions)) {
    lowerMap.set(key.toLowerCase(), value)
  }

  return content.replace(
    PLACEHOLDER_REGEX,
    (original: string, escape: string | undefined, name: string, offset: number) => {
      if (escape === "\\") {
        return original.slice(1)
      }

      if (isInsideCodeBlock(content, offset)) {
        return original
      }

      const value = lowerMap.get(name.toLowerCase())
      return value !== undefined ? value : original
    },
  )
}
