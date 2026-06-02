export function parseRecordText(value: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const rawLine of value.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    const separatorIndex = rawLine.indexOf("=")
    if (separatorIndex < 0) {
      throw new Error("配置项需使用 KEY=value")
    }
    const key = rawLine.slice(0, separatorIndex).trim()
    if (!key) {
      throw new Error("配置项名称不能为空")
    }
    result[key] = rawLine.slice(separatorIndex + 1).trim()
  }
  return result
}

export function tryParseRecordText(value: string):
  | { ok: true; value: Record<string, string> }
  | { ok: false; error: Error } {
  try {
    return { ok: true, value: parseRecordText(value) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error : new Error(String(error)) }
  }
}

export function stringifyRecordText(record: Record<string, string> | undefined): string {
  if (!record) return ""
  return Object.entries(record)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n")
}
