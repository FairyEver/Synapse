import type {
  SynapseGitFileChange,
  SynapseGitFileStatus,
  SynapseGitStatusParseResult,
} from "../../../src/types/git"

const EMPTY_RESULT: SynapseGitStatusParseResult = {
  currentBranch: null,
  upstream: null,
  trackingStatus: "detached",
  ahead: 0,
  behind: 0,
  hasConflicts: false,
  changeCount: 0,
  changesTruncated: false,
  changes: [],
}

type StatusAccumulator = {
  ahead: number
  behind: number
  changeCount: number
  changes: SynapseGitFileChange[]
  branchHeadSeen: boolean
  currentBranch: string | null
  hasAheadBehind: boolean
  hasConflicts: boolean
  upstream: string | null
}

function createAccumulator(): StatusAccumulator {
  return {
    ahead: 0,
    behind: 0,
    changeCount: 0,
    changes: [],
    branchHeadSeen: false,
    currentBranch: null,
    hasAheadBehind: false,
    hasConflicts: false,
    upstream: null,
  }
}

const gitPathTextDecoder = new TextDecoder()
const gitPathTextEncoder = new TextEncoder()

function appendText(bytes: number[], value: string): void {
  bytes.push(...gitPathTextEncoder.encode(value))
}

function decodeGitPath(rawPath: string): string {
  const value = rawPath.trim()
  if (value.length < 2 || value[0] !== "\"" || value[value.length - 1] !== "\"") return value
  const bytes: number[] = []
  const body = value.slice(1, -1)
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index]
    if (character !== "\\") {
      appendText(bytes, character ?? "")
      continue
    }
    const escaped = body[index + 1]
    if (!escaped) {
      bytes.push("\\".charCodeAt(0))
      continue
    }
    if (/[0-7]/.test(escaped)) {
      let octal = escaped
      let consumed = 1
      while (consumed < 3 && /[0-7]/.test(body[index + 1 + consumed] ?? "")) {
        octal += body[index + 1 + consumed]
        consumed += 1
      }
      bytes.push(Number.parseInt(octal, 8))
      index += consumed
      continue
    }
    const mapped = escaped === "n"
      ? "\n"
      : escaped === "t"
        ? "\t"
        : escaped === "r"
          ? "\r"
          : escaped === "b"
            ? "\b"
            : escaped === "f"
              ? "\f"
              : escaped
    appendText(bytes, mapped)
    index += 1
  }
  return gitPathTextDecoder.decode(Uint8Array.from(bytes))
}

function parseAheadBehind(line: string): Pick<SynapseGitStatusParseResult, "ahead" | "behind"> {
  const match = line.match(/^# branch\.ab \+(\d+) -(\d+)$/)
  if (!match) return { ahead: 0, behind: 0 }
  return {
    ahead: Number.parseInt(match[1] ?? "0", 10) || 0,
    behind: Number.parseInt(match[2] ?? "0", 10) || 0,
  }
}

function statusFromCodes(indexCode: string, worktreeCode: string): SynapseGitFileStatus {
  if (indexCode === "U" || worktreeCode === "U" || (indexCode === "A" && worktreeCode === "A")) return "conflicted"
  if (indexCode === "R") return "renamed"
  if (indexCode === "A") return "added"
  if (indexCode === "D" || worktreeCode === "D") return "deleted"
  if (indexCode === "M" || worktreeCode === "M") return "modified"
  return "unknown"
}

function parseOrdinaryChange(line: string, decodePath: (value: string) => string = decodeGitPath): SynapseGitFileChange | null {
  const fields = line.split(" ")
  if (fields.length < 9) return null
  const xy = fields[1] ?? ".."
  const indexCode = xy[0] ?? "."
  const worktreeCode = xy[1] ?? "."
  const filePath = decodePath(fields.slice(8).join(" "))
  if (!filePath) return null
  const status = statusFromCodes(indexCode, worktreeCode)
  return {
    path: filePath,
    originalPath: null,
    status,
    staged: indexCode !== "." && status !== "conflicted",
    conflicted: status === "conflicted",
  }
}

function parseRenamedChange(line: string): SynapseGitFileChange | null {
  const tabIndex = line.indexOf("\t")
  const beforeTab = tabIndex >= 0 ? line.slice(0, tabIndex) : line
  const originalPath = tabIndex >= 0 ? decodeGitPath(line.slice(tabIndex + 1)) : null
  const fields = beforeTab.split(" ")
  if (fields.length < 10) return null
  const xy = fields[1] ?? ".."
  const path = decodeGitPath(fields.slice(9).join(" "))
  if (!path) return null
  return {
    path,
    originalPath,
    status: "renamed",
    staged: xy[0] !== ".",
    conflicted: false,
  }
}

function parseNulRenamedChange(record: string, originalPath: string): SynapseGitFileChange | null {
  const fields = record.split(" ")
  if (fields.length < 10) return null
  const xy = fields[1] ?? ".."
  const filePath = fields.slice(9).join(" ")
  if (!filePath || !originalPath) return null
  return {
    path: filePath,
    originalPath,
    status: "renamed",
    staged: xy[0] !== ".",
    conflicted: false,
  }
}

function parseUntrackedChange(line: string): SynapseGitFileChange | null {
  const path = decodeGitPath(line.slice(2))
  if (!path) return null
  return {
    path,
    originalPath: null,
    status: "untracked",
    staged: false,
    conflicted: false,
  }
}

function parseConflictChange(line: string, decodePath: (value: string) => string = decodeGitPath): SynapseGitFileChange | null {
  const fields = line.split(" ")
  const filePath = decodePath(fields.slice(11).join(" "))
  if (!filePath) return null
  return {
    path: filePath,
    originalPath: null,
    status: "conflicted",
    staged: false,
    conflicted: true,
  }
}

function appendChange(accumulator: StatusAccumulator, change: SynapseGitFileChange, maxChanges: number): void {
  accumulator.changeCount += 1
  accumulator.hasConflicts = accumulator.hasConflicts || change.conflicted
  if (accumulator.changes.length < maxChanges) accumulator.changes.push(change)
}

function applyHeader(accumulator: StatusAccumulator, record: string): boolean {
  if (record.startsWith("# branch.head ")) {
    accumulator.branchHeadSeen = true
    const value = record.slice("# branch.head ".length).trim()
    accumulator.currentBranch = value === "(detached)" ? null : value
    return true
  }
  if (record.startsWith("# branch.upstream ")) {
    accumulator.upstream = record.slice("# branch.upstream ".length).trim() || null
    return true
  }
  if (record.startsWith("# branch.ab ")) {
    accumulator.hasAheadBehind = true
    const parsed = parseAheadBehind(record)
    accumulator.ahead = parsed.ahead
    accumulator.behind = parsed.behind
    return true
  }
  return record.startsWith("# ")
}

function finishAccumulator(accumulator: StatusAccumulator): SynapseGitStatusParseResult {
  return {
    ...EMPTY_RESULT,
    currentBranch: accumulator.currentBranch,
    upstream: accumulator.upstream,
    trackingStatus: accumulator.currentBranch === null
      ? "detached"
      : accumulator.upstream
        ? accumulator.hasAheadBehind ? "tracked" : "gone"
        : "untracked",
    ahead: accumulator.ahead,
    behind: accumulator.behind,
    hasConflicts: accumulator.hasConflicts,
    changeCount: accumulator.changeCount,
    changesTruncated: accumulator.changeCount > accumulator.changes.length,
    changes: accumulator.changes,
  }
}

export function createGitStatusPorcelainV2Parser(options: { readonly maxChanges?: number } = {}) {
  const accumulator = createAccumulator()
  const maxChanges = Math.max(0, options.maxChanges ?? Number.POSITIVE_INFINITY)
  let pending = Buffer.alloc(0)
  let pendingRename: string | null = null
  let finished = false

  function acceptRecord(record: string): void {
    if (pendingRename !== null) {
      const change = parseNulRenamedChange(pendingRename, record)
      pendingRename = null
      if (change) appendChange(accumulator, change, maxChanges)
      return
    }
    if (!record || applyHeader(accumulator, record)) return
    if (record.startsWith("2 ")) {
      pendingRename = record
      return
    }
    const change = record.startsWith("1 ")
      ? parseOrdinaryChange(record, (value) => value)
      : record.startsWith("? ")
        ? {
            path: record.slice(2),
            originalPath: null,
            status: "untracked" as const,
            staged: false,
            conflicted: false,
          }
        : record.startsWith("u ")
          ? parseConflictChange(record, (value) => value)
          : null
    if (change) appendChange(accumulator, change, maxChanges)
  }

  return {
    push(chunk: Uint8Array): void {
      if (finished) throw new Error("Git status parser has already finished.")
      const bytes = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)
      pending = pending.length === 0 ? Buffer.from(bytes) : Buffer.concat([pending, bytes])
      let separator = pending.indexOf(0)
      while (separator >= 0) {
        acceptRecord(pending.subarray(0, separator).toString("utf8"))
        pending = pending.subarray(separator + 1)
        separator = pending.indexOf(0)
      }
    },
    finish(): SynapseGitStatusParseResult {
      if (finished) throw new Error("Git status parser has already finished.")
      finished = true
      if (pending.length > 0 || pendingRename !== null) {
        throw new Error("Git status output is incomplete.")
      }
      return finishAccumulator(accumulator)
    },
    get sawBranchHead(): boolean {
      return accumulator.branchHeadSeen
    },
  }
}

export function parseGitStatusPorcelainV2(stdout: string): SynapseGitStatusParseResult {
  if (stdout.includes("\0")) {
    const parser = createGitStatusPorcelainV2Parser()
    parser.push(Buffer.from(stdout, "utf8"))
    return parser.finish()
  }
  const accumulator = createAccumulator()

  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue
    if (applyHeader(accumulator, line)) continue

    const change = line.startsWith("1 ")
      ? parseOrdinaryChange(line)
      : line.startsWith("2 ")
        ? parseRenamedChange(line)
        : line.startsWith("? ")
          ? parseUntrackedChange(line)
          : line.startsWith("u ")
            ? parseConflictChange(line)
            : null

    if (change) {
      appendChange(accumulator, change, Number.POSITIVE_INFINITY)
    }
  }

  return finishAccumulator(accumulator)
}
