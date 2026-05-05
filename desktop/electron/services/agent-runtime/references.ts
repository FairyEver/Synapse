import { fileURLToPath } from "node:url"
import fs from "node:fs/promises"
import path from "node:path"

export interface LocalReference {
  readonly raw: string
  readonly path: string
  readonly relativePath: string
  readonly line?: number
  readonly column?: number
  readonly endLine?: number
  readonly endColumn?: number
}

export interface ReferenceViewOptions {
  readonly head?: number
  readonly context?: number
  readonly maxRange?: number
  readonly maxEntries?: number
}

const DEFAULT_HEAD = 80
const DEFAULT_CONTEXT = 8
const DEFAULT_MAX_RANGE = 120
const DEFAULT_MAX_ENTRIES = 50
const MAX_OUTPUT_RUNES = 12000

export function resolveLocalReference(
  input: string,
  workspacePath: string,
): LocalReference | null {
  const normalized = normalizeReferenceInput(input)
  if (!normalized || isWebUrl(normalized)) return null
  const parsed = splitLocationSuffix(normalized)
  const rawPath = parsed.path
  if (!rawPath || isWebUrl(rawPath)) return null

  let candidate: string
  try {
    candidate = rawPath.startsWith("file://")
      ? fileURLToPath(rawPath)
      : rawPath
  } catch {
    return null
  }
  const absolutePath = path.isAbsolute(candidate)
    ? path.normalize(candidate)
    : path.resolve(workspacePath, candidate)
  if (!isInsideWorkspace(absolutePath, workspacePath)) return null
  return {
    raw: input,
    path: absolutePath,
    relativePath: (path.relative(workspacePath, absolutePath) || path.basename(absolutePath)).replaceAll("\\", "/"),
    line: parsed.line,
    column: parsed.column,
    endLine: parsed.endLine,
    endColumn: parsed.endColumn,
  }
}

export async function renderReferenceView(
  input: string,
  workspacePath: string,
  options: ReferenceViewOptions = {},
): Promise<string> {
  const reference = resolveLocalReference(input, workspacePath)
  if (!reference) return "Reference is outside the workspace or invalid."
  const stat = await fs.stat(reference.path)
  if (stat.isDirectory()) {
    return renderDirectory(reference, options)
  }
  if (!stat.isFile()) return "Reference is not a file or directory."
  return renderFile(reference, options)
}

export function parseReferenceViewOptions(args: readonly string[]): {
  readonly reference: string
  readonly options: ReferenceViewOptions
} | null {
  const values = [...args]
  const options: {
    head?: number
    context?: number
  } = {}
  const referenceParts: string[] = []
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    if (!value) continue
    if (value === "--head") {
      options.head = positiveInt(values[index + 1])
      index += 1
      continue
    }
    if (value === "--context") {
      options.context = positiveInt(values[index + 1])
      index += 1
      continue
    }
    referenceParts.push(value)
  }
  const reference = referenceParts.join(" ").trim()
  return reference ? { reference, options } : null
}

async function renderDirectory(
  reference: LocalReference,
  options: ReferenceViewOptions,
): Promise<string> {
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES
  const entries = await fs.readdir(reference.path, { withFileTypes: true })
  const lines = entries
    .sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    .slice(0, maxEntries)
    .map((entry) => `${entry.isDirectory() ? "dir " : "file"} ${entry.name}`)
  return [
    `${reference.relativePath}/`,
    "```text",
    ...lines,
    "```",
  ].join("\n")
}

async function renderFile(
  reference: LocalReference,
  options: ReferenceViewOptions,
): Promise<string> {
  const bytes = await fs.readFile(reference.path)
  if (bytes.includes(0)) return `${reference.relativePath} is a binary file.`
  const text = bytes.toString("utf8")
  const allLines = text.split(/\r?\n/)
  const context = options.context ?? DEFAULT_CONTEXT
  const maxRange = options.maxRange ?? DEFAULT_MAX_RANGE
  const head = options.head ?? DEFAULT_HEAD
  let startLine = 1
  let endLine = Math.min(allLines.length, head)
  if (reference.line !== undefined) {
    const rangeEnd = Math.max(reference.line, reference.endLine ?? reference.line)
    startLine = Math.max(1, reference.line - context)
    endLine = Math.min(allLines.length, rangeEnd + context, startLine + maxRange - 1)
  }
  const rendered = allLines
    .slice(startLine - 1, endLine)
    .map((line, index) => `${String(startLine + index).padStart(4, " ")} | ${line}`)
  return truncateRunes([
    `${reference.relativePath}:${String(startLine)}`,
    "```text",
    ...rendered,
    "```",
  ].join("\n"), MAX_OUTPUT_RUNES)
}

function normalizeReferenceInput(input: string): string {
  const trimmed = input.trim().replace(/^["'`]+|["'`]+$/g, "")
  const markdown = /^\[[^\]]+\]\(([^)]+)\)$/.exec(trimmed)
  return (markdown?.[1] ?? trimmed).trim()
}

function splitLocationSuffix(input: string): {
  readonly path: string
  readonly line?: number
  readonly column?: number
  readonly endLine?: number
  readonly endColumn?: number
} {
  const hash = /^(.*)#L(\d+)(?:C(\d+))?(?:-L?(\d+)(?:C(\d+))?)?$/.exec(input)
  if (hash) {
    return {
      path: hash[1] ?? "",
      line: positiveInt(hash[2]),
      column: positiveInt(hash[3]),
      endLine: positiveInt(hash[4]),
      endColumn: positiveInt(hash[5]),
    }
  }
  const colon = /^(.*?):(\d+)(?::(\d+))?(?:-(\d+))?$/.exec(input)
  if (colon && !/^[A-Za-z]$/.test(colon[1] ?? "")) {
    return {
      path: colon[1] ?? "",
      line: positiveInt(colon[2]),
      column: positiveInt(colon[3]),
      endLine: positiveInt(colon[4]),
    }
  }
  return { path: input }
}

function positiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number.parseInt(value, 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

function isInsideWorkspace(filePath: string, workspacePath: string): boolean {
  const relative = path.relative(path.resolve(workspacePath), path.resolve(filePath))
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

function isWebUrl(value: string): boolean {
  return /^https?:\/\//i.test(value) || value.startsWith("//")
}

function truncateRunes(value: string, maxRunes: number): string {
  const runes = [...value]
  if (runes.length <= maxRunes) return value
  return `${runes.slice(0, maxRunes).join("")}...`
}
