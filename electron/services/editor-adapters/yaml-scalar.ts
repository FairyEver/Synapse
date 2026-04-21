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

export { decodeYamlScalar, encodeYamlScalar }
