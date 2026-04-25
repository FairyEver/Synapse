import { redactToken } from "./access-policy-service"

export type DaemonLogInput = {
  name: string
  content: string
  mtimeMs?: number
}

export type DaemonLogExportFile = {
  name: string
  content: string
}

export type DaemonLogExportResult = {
  fileCount: number
  files: DaemonLogExportFile[]
  combinedContent: string
}

export type RotatingLogState = {
  current: string
  backup?: string
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8")
}

export function readLastLines(content: string, lineCount: number): string {
  const lines = content.replace(/\n$/, "").split(/\r?\n/)
  const start = Math.max(0, lines.length - Math.max(0, lineCount))

  return lines.slice(start).join("\n")
}

export function redactDaemonLogContent(content: string, tokens: readonly string[] = []): string {
  let output = content

  for (const token of tokens) {
    output = redactToken(output, token)
  }

  return output
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer ***")
    .replace(
      /\b([A-Za-z0-9_-]*(?:api[_-]?key|token|secret|password)[A-Za-z0-9_-]*)(\s*[:=]\s*|["']\s*:\s*["'])([^,\s"']+)/gi,
      (_match, key: string, separator: string) => `${key}${separator}***`,
    )
    .replace(/(--(?:api-key|api_key|apikey|token|secret|password)=)[^\s]+/gi, "$1***")
}

export function appendRotatingLog(
  state: RotatingLogState,
  chunk: string,
  maxSizeBytes: number,
): RotatingLogState {
  const nextCurrent = `${state.current}${chunk}`

  if (byteLength(nextCurrent) <= maxSizeBytes) {
    return {
      ...state,
      current: nextCurrent,
    }
  }

  return {
    current: "",
    backup: nextCurrent,
  }
}

export function prepareDaemonLogExport(
  files: readonly DaemonLogInput[],
  options: {
    lineCount?: number
    tokens?: readonly string[]
  } = {},
): DaemonLogExportResult {
  const sortedFiles = [...files].sort((a, b) => (a.mtimeMs ?? 0) - (b.mtimeMs ?? 0))
  const exportedFiles = sortedFiles.map((file) => {
    const content = options.lineCount
      ? readLastLines(file.content, options.lineCount)
      : file.content

    return {
      name: file.name,
      content: redactDaemonLogContent(content, options.tokens),
    }
  })

  return {
    fileCount: exportedFiles.length,
    files: exportedFiles,
    combinedContent: exportedFiles
      .map((file) => `== ${file.name} ==\n${file.content}`)
      .join("\n"),
  }
}
