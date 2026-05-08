type BlockIndicator = ">" | ">-" | "|" | "|-"

const BLOCK_INDICATORS = new Set<string>([">", ">-", "|", "|-"])

function isBlockIndicator(value: string): value is BlockIndicator {
  return BLOCK_INDICATORS.has(value)
}

function joinBlockLines(lines: string[], indicator: BlockIndicator): string {
  const stripped = lines.map((l) => l.replace(/^[ \t]+/, ""))
  const joined = indicator.startsWith("|")
    ? stripped.join("\n")
    : stripped.join(" ")
  return indicator.endsWith("-") ? joined : `${joined}\n`
}

function parseFrontmatterBlock(raw: string): Record<string, string> {
  const metadata: Record<string, string> = {}
  const lines = raw.split(/\r?\n/)
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const colonIndex = line.indexOf(":")
    if (colonIndex <= 0) { i++; continue }
    const key = line.slice(0, colonIndex).trim()
    const rawValue = line.slice(colonIndex + 1).trim()
    if (!key) { i++; continue }

    if (isBlockIndicator(rawValue)) {
      const blockLines: string[] = []
      i++
      while (i < lines.length && /^[ \t]/.test(lines[i])) {
        blockLines.push(lines[i])
        i++
      }
      metadata[key] = joinBlockLines(blockLines, rawValue).trim()
    } else {
      metadata[key] = decodeYamlScalar(rawValue)
      i++
    }
  }
  return metadata
}

function needsDoubleQuote(value: string): boolean {
  if (value.length === 0) {
    return false
  }

  if (/[\n\r]/.test(value)) {
    return true
  }

  if (/[:#]/.test(value)) {
    return true
  }

  return /^[&*!|>'"%@`\-?,\[\]{}]/.test(value)
}

function encodeYamlScalar(value: string): string {
  if (!needsDoubleQuote(value)) {
    return value
  }

  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`
}

function decodeYamlScalar(raw: string): string {
  const trimmed = raw.trim()

  if (trimmed.length === 0) {
    return ""
  }

  if (trimmed.startsWith("\"") && trimmed.endsWith("\"") && trimmed.length >= 2) {
    const inner = trimmed.slice(1, -1)
    return inner.replace(/\\"/g, "\"").replace(/\\\\/g, "\\")
  }

  if (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2) {
    return trimmed.slice(1, -1).replace(/''/g, "'")
  }

  return trimmed
}

export { decodeYamlScalar, encodeYamlScalar, parseFrontmatterBlock }
