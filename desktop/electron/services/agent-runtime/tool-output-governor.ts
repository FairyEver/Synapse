export const DEFAULT_TOOL_OUTPUT_MAX_BYTES = 50 * 1024
export const DEFAULT_TOOL_OUTPUT_MAX_LINES = 2_000

const TRUNCATION_MARKER_PREFIX = "[Synapse context guard]"

export interface ToolOutputGovernorResult {
  readonly updatedToolOutput: string
  readonly originalText: string
  readonly originalBytes: number
  readonly deliveredBytes: number
  readonly originalLines: number
  readonly deliveredLines: number
  readonly kept: "head" | "tail"
}

export interface ToolOutputMeasurement {
  readonly text: string
  readonly bytes: number
  readonly lines: number
}

// File-mutation tools answer with a structured result that embeds the whole
// file (`originalFile`, `content`, `original_file`, `updated_file`), but the SDK
// only sends a short confirmation line to the model. Those fields never enter a
// request body, so they must not be bounded, rewritten or replaced.
// Verified against the installed SDK with real Edit/Write/NotebookEdit calls.
const FILE_MUTATION_TOOLS = new Set(["Edit", "Write", "NotebookEdit"])

export function isFileMutationTool(toolName: string): boolean {
  return FILE_MUTATION_TOOLS.has(toolName)
}

/** True when a PostToolUse result is a structured file-mutation payload. */
export function isStructuredFileMutationOutput(toolName: string, toolResponse: unknown): boolean {
  return isFileMutationTool(toolName) && isRecord(toolResponse)
}

// Native tools validate hook replacements against their own result schema.
// A plain string for Read/Bash is silently rejected by SDK 0.3.245.
export function replaceToolOutput(toolName: string, original: unknown, text: string): unknown {
  if (typeof original === "string") return text
  if (!isRecord(original)) return undefined
  if (toolName === "Read" && original.type === "text" && isRecord(original.file)) {
    return { ...original, file: { ...original.file, content: text, numLines: lineCount(text) } }
  }
  if (toolName === "Bash" && typeof original.stdout === "string") {
    return { ...original, stdout: text, stderr: "" }
  }
  if (toolName === "Grep" && typeof original.content === "string") return { ...original, content: text }
  if (toolName === "WebFetch" && typeof original.result === "string") return { ...original, result: text }
  if (toolName.startsWith("mcp__") && Array.isArray(original.content)) {
    return { content: [{ type: "text", text }], ...(original.isError === true ? { isError: true } : {}) }
  }
  return undefined
}

export function governToolOutput(input: {
  readonly toolName: string
  readonly toolResponse: unknown
  readonly maxBytes?: number
  readonly maxLines?: number
  readonly persistedOutputPath?: string
}): ToolOutputGovernorResult | undefined {
  const measurement = measureToolOutput(input.toolName, input.toolResponse)
  if (!measurement) return undefined
  const text = measurement.text
  const maxBytes = nonNegativeInteger(input.maxBytes) ?? DEFAULT_TOOL_OUTPUT_MAX_BYTES
  const maxLines = positiveInteger(input.maxLines) ?? DEFAULT_TOOL_OUTPUT_MAX_LINES
  const originalBytes = measurement.bytes
  const originalLines = measurement.lines
  if (originalBytes <= maxBytes && originalLines <= maxLines) return undefined

  const kept = keepsTail(input.toolName) ? "tail" : "head"
  const marker = truncationMarker({
    toolName: input.toolName,
    originalBytes,
    originalLines,
    kept,
    persistedOutputPath: input.persistedOutputPath,
  })
  const boundedMarker = limitUtf8(marker, maxBytes, "head")
  const markerBytes = Buffer.byteLength(boundedMarker, "utf8")
  const contentByteBudget = Math.max(0, maxBytes - markerBytes)
  const contentLineBudget = Math.max(0, maxLines - lineCount(boundedMarker))
  const lineBounded = limitLines(text, contentLineBudget, kept)
  const byteBounded = limitUtf8(lineBounded, contentByteBudget, kept)
  const updatedToolOutput = kept === "tail"
    ? `${boundedMarker}${byteBounded}`
    : `${byteBounded}${boundedMarker}`

  return {
    updatedToolOutput,
    originalText: text,
    originalBytes,
    deliveredBytes: Buffer.byteLength(updatedToolOutput, "utf8"),
    originalLines,
    deliveredLines: lineCount(updatedToolOutput),
    kept,
  }
}

export function measureToolOutput(toolName: string, toolResponse: unknown): ToolOutputMeasurement | undefined {
  if (containsBinaryPayload(toolResponse)) return undefined
  const text = toolOutputText(toolName, toolResponse)
  if (text === undefined) return undefined
  const measuredText = typeof toolResponse === "string"
    ? text
    : safeJson(toolResponse) ?? text
  return {
    text,
    bytes: Buffer.byteLength(measuredText, "utf8"),
    lines: toolOutputLineCount(toolName, toolResponse, text),
  }
}

function toolOutputText(toolName: string, value: unknown): string | undefined {
  if (typeof value === "string") return value
  if (!isRecord(value)) return safeJson(value)

  if (toolName === "Read" && value.type === "text" && isRecord(value.file)) {
    const file = value.file
    if (typeof file.content !== "string") return safeJson(value)
    const metadata = ["filePath", "startLine", "numLines", "totalLines"]
      .flatMap((key) => scalarMetadataLine(key, file[key]))
    return [...metadata, file.content].join("\n")
  }
  if (toolName === "Bash") {
    const stdout = typeof value.stdout === "string" ? value.stdout : ""
    const stderr = typeof value.stderr === "string" ? value.stderr : ""
    if (stdout || stderr) {
      const metadata = ["rawOutputPath", "persistedOutputPath", "persistedOutputSize", "interrupted", "backgroundTaskId"]
        .flatMap((key) => scalarMetadataLine(key, value[key]))
      return [
        ...metadata,
        stdout ? `stdout:\n${stdout}` : undefined,
        stderr ? `stderr:\n${stderr}` : undefined,
      ].filter((item): item is string => Boolean(item)).join("\n")
    }
  }
  if (toolName === "Grep" && typeof value.content === "string") {
    const metadata = ["mode", "numFiles", "numLines", "numMatches", "appliedLimit", "appliedOffset"]
      .flatMap((key) => scalarMetadataLine(key, value[key]))
    return [...metadata, value.content].join("\n")
  }
  if (toolName === "WebFetch" && typeof value.result === "string") {
    const metadata = ["url", "code", "bytes"]
      .flatMap((key) => scalarMetadataLine(key, value[key]))
    return [...metadata, value.result].join("\n")
  }

  return safeJson(value)
}

function toolOutputLineCount(toolName: string, value: unknown, fallbackText: string): number {
  if (!isRecord(value)) return lineCount(fallbackText)
  if (toolName === "Read" && value.type === "text" && isRecord(value.file) && typeof value.file.content === "string") {
    return lineCount(value.file.content)
  }
  if (toolName === "Grep" && typeof value.content === "string") return lineCount(value.content)
  if (toolName === "WebFetch" && typeof value.result === "string") return lineCount(value.result)
  if (toolName === "Bash") {
    return [value.stdout, value.stderr]
      .filter((item): item is string => typeof item === "string" && item.length > 0)
      .reduce((total, item) => total + lineCount(item), 0)
  }
  return lineCount(fallbackText)
}

function scalarMetadataLine(key: string, value: unknown): string[] {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? [`${key}: ${String(value)}`]
    : []
}

function truncationMarker(input: {
  readonly toolName: string
  readonly originalBytes: number
  readonly originalLines: number
  readonly kept: "head" | "tail"
  readonly persistedOutputPath?: string
}): string {
  const position = input.kept === "tail" ? "last" : "first"
  const continuation = input.toolName === "Read"
    ? "Continue with a smaller limit/offset. For one oversized line, use a byte-range or structured query."
    : input.toolName === "Bash"
      ? "The command already ran. Do not rerun it only to recover omitted output; narrow the persisted output with a read-only command."
      : "Use a narrower read, search, filter, or pagination request for omitted content."
  const persisted = input.persistedOutputPath
    ? ` Output saved at ${input.persistedOutputPath}. Read that file in bounded ranges; do not rerun the original tool only to recover omitted output.`
    : ""
  const marker = `${TRUNCATION_MARKER_PREFIX} Original ${input.toolName} result: ${input.originalBytes} bytes, ${input.originalLines} lines. Keeping the ${position} bounded portion.${persisted} ${continuation}`
  return input.kept === "tail" ? `${marker}\n` : `\n${marker}`
}

function keepsTail(toolName: string): boolean {
  return toolName === "Bash"
}

function limitLines(value: string, maxLines: number, kept: "head" | "tail"): string {
  if (maxLines <= 0) return ""
  const lines = value.split("\n")
  if (lines.length <= maxLines) return value
  return kept === "tail"
    ? lines.slice(-maxLines).join("\n")
    : lines.slice(0, maxLines).join("\n")
}

function limitUtf8(value: string, maxBytes: number, kept: "head" | "tail"): string {
  if (maxBytes <= 0) return ""
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value
  let low = 0
  let high = value.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    const candidate = kept === "tail" ? value.slice(value.length - middle) : value.slice(0, middle)
    if (Buffer.byteLength(candidate, "utf8") <= maxBytes) low = middle
    else high = middle - 1
  }
  let bounded = kept === "tail" ? value.slice(value.length - low) : value.slice(0, low)
  if (kept === "tail" && isLowSurrogate(bounded.charCodeAt(0))) bounded = bounded.slice(1)
  if (kept === "head" && isHighSurrogate(bounded.charCodeAt(bounded.length - 1))) bounded = bounded.slice(0, -1)
  return bounded
}

function lineCount(value: string): number {
  if (value.length === 0) return 0
  let count = 1
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) === 10) count += 1
  }
  return count
}

function containsBinaryPayload(value: unknown, seen = new WeakSet<object>()): boolean {
  if (typeof value === "string") return /^data:(?:image\/[\w.+-]+|application\/pdf);base64,/i.test(value)
  if (!value || typeof value !== "object") return false
  if (seen.has(value)) return false
  seen.add(value)
  if (Array.isArray(value)) return value.some((item) => containsBinaryPayload(item, seen))
  const record = value as Record<string, unknown>
  if (record.type === "image" || record.type === "pdf") return true
  return Object.entries(record).some(([key, item]) =>
    key.toLowerCase() === "base64" || containsBinaryPayload(item, seen))
}

function safeJson(value: unknown): string | undefined {
  try {
    const serialized = JSON.stringify(value, null, 2)
    return typeof serialized === "string" ? serialized : undefined
  } catch {
    return undefined
  }
}

function positiveInteger(value: number | undefined): number | undefined {
  return Number.isInteger(value) && (value ?? 0) > 0 ? value : undefined
}

function nonNegativeInteger(value: number | undefined): number | undefined {
  return Number.isInteger(value) && (value ?? -1) >= 0 ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xD800 && code <= 0xDBFF
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xDC00 && code <= 0xDFFF
}
