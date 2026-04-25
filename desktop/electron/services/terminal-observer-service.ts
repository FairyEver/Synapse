export type TerminalObservationRole = "user" | "assistant"

export type TerminalObservation = {
  role: TerminalObservationRole
  text: string
  sessionId?: string
}

export type TerminalSessionFileSnapshot = {
  path: string
  content: string
}

type ObserverFileState = {
  offset: number
  partial: string
}

const OBSERVATION_MAX_BYTES = 3900
const TRUNCATED_SUFFIX = "\n... (truncated)"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readTextContent(content: unknown): string {
  if (typeof content === "string") {
    return content
  }

  if (!Array.isArray(content)) {
    return ""
  }

  return content
    .filter(isRecord)
    .filter((block) => block.type === "text")
    .map((block) => typeof block.text === "string" ? block.text : "")
    .filter(Boolean)
    .join("\n")
}

function truncateUtf8(value: string, maxBytes: number): string {
  let output = ""
  let used = 0

  for (const char of value) {
    const nextBytes = Buffer.byteLength(char, "utf8")
    if (used + nextBytes > maxBytes) {
      break
    }
    output += char
    used += nextBytes
  }

  return output
}

export function parseObservationLine(line: string | Uint8Array): TerminalObservation | null {
  const rawText = typeof line === "string" ? line : Buffer.from(line).toString("utf8")
  let raw: unknown
  try {
    raw = JSON.parse(rawText)
  } catch {
    return null
  }

  if (!isRecord(raw)) {
    return null
  }

  const role = raw.type
  if (role !== "user" && role !== "assistant") {
    return null
  }
  if (raw.entrypoint === "sdk-cli") {
    return null
  }
  if (!isRecord(raw.message)) {
    return null
  }

  const observation: TerminalObservation = {
    role,
    text: readTextContent(raw.message.content),
  }

  if (typeof raw.sessionId === "string") {
    observation.sessionId = raw.sessionId
  }

  return observation
}

export function formatObservation(observation: TerminalObservation): string | null {
  if (!observation.text) {
    return null
  }

  const formatted = observation.role === "user"
    ? `user: ${observation.text}`
    : `\nClaude: ${observation.text}`

  if (Buffer.byteLength(formatted, "utf8") <= OBSERVATION_MAX_BYTES) {
    return formatted
  }

  return `${truncateUtf8(formatted, OBSERVATION_MAX_BYTES)}${TRUNCATED_SUFFIX}`
}

function completeLinesFromChunk(chunk: string, prefix: string): { lines: string[]; partial: string } {
  const combined = `${prefix}${chunk}`
  const lines = combined.split(/\r?\n/)
  const ended = combined.endsWith("\n") || combined.endsWith("\r")

  if (ended) {
    return { lines: lines.filter((line) => line.length > 0), partial: "" }
  }

  const partial = lines.pop() ?? ""
  return { lines: lines.filter((line) => line.length > 0), partial }
}

export class TerminalObserverService {
  private readonly files = new Map<string, ObserverFileState>()

  initialize(files: readonly TerminalSessionFileSnapshot[]): void {
    for (const file of files) {
      if (!file.path.endsWith(".jsonl")) {
        continue
      }
      this.files.set(file.path, { offset: Buffer.byteLength(file.content, "utf8"), partial: "" })
    }
  }

  poll(files: readonly TerminalSessionFileSnapshot[]): string[] {
    const forwarded: string[] = []

    for (const file of files) {
      if (!file.path.endsWith(".jsonl")) {
        continue
      }

      const contentBytes = Buffer.byteLength(file.content, "utf8")
      let state = this.files.get(file.path)
      if (!state) {
        this.files.set(file.path, { offset: contentBytes, partial: "" })
        continue
      }

      if (contentBytes < state.offset) {
        state = { offset: 0, partial: "" }
      }

      if (contentBytes <= state.offset) {
        this.files.set(file.path, state)
        continue
      }

      const chunk = Buffer.from(file.content, "utf8").subarray(state.offset).toString("utf8")
      const { lines, partial } = completeLinesFromChunk(chunk, state.partial)

      for (const line of lines) {
        const observation = parseObservationLine(line)
        const message = observation ? formatObservation(observation) : null
        if (message) {
          forwarded.push(message)
        }
      }

      this.files.set(file.path, { offset: contentBytes, partial })
    }

    return forwarded
  }
}
