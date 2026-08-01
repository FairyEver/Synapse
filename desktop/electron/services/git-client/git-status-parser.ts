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
  changes: [],
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

function parseOrdinaryChange(line: string): SynapseGitFileChange | null {
  const fields = line.split(" ")
  if (fields.length < 9) return null
  const xy = fields[1] ?? ".."
  const indexCode = xy[0] ?? "."
  const worktreeCode = xy[1] ?? "."
  const path = decodeGitPath(fields.slice(8).join(" "))
  if (!path) return null
  const status = statusFromCodes(indexCode, worktreeCode)
  return {
    path,
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

function parseConflictChange(line: string): SynapseGitFileChange | null {
  const fields = line.split(" ")
  const path = decodeGitPath(fields.slice(11).join(" "))
  if (!path) return null
  return {
    path,
    originalPath: null,
    status: "conflicted",
    staged: false,
    conflicted: true,
  }
}

export function parseGitStatusPorcelainV2(stdout: string): SynapseGitStatusParseResult {
  const result: SynapseGitStatusParseResult = { ...EMPTY_RESULT, changes: [] }
  const changes: SynapseGitFileChange[] = []
  let ahead = 0
  let behind = 0
  let currentBranch: string | null = null
  let upstream: string | null = null
  let hasConflicts = false

  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue
    if (line.startsWith("# branch.head ")) {
      const value = line.slice("# branch.head ".length).trim()
      currentBranch = value === "(detached)" ? null : value
      continue
    }
    if (line.startsWith("# branch.upstream ")) {
      upstream = line.slice("# branch.upstream ".length).trim() || null
      continue
    }
    if (line.startsWith("# branch.ab ")) {
      const parsed = parseAheadBehind(line)
      ahead = parsed.ahead
      behind = parsed.behind
      continue
    }

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
      changes.push(change)
      hasConflicts = hasConflicts || change.conflicted
    }
  }

  return {
    ...result,
    currentBranch,
    upstream,
    trackingStatus: currentBranch === null ? "detached" : upstream ? "tracked" : "untracked",
    ahead,
    behind,
    hasConflicts,
    changes,
  }
}
