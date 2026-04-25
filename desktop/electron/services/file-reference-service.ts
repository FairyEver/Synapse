import fs from "node:fs"
import path from "node:path"

export type FileReferenceKind = "unknown" | "file" | "dir"
export type FileReferenceLocationFormat =
  | "none"
  | "colon_line"
  | "colon_line_col"
  | "colon_line_range"
  | "hash_line"
  | "hash_line_col"

export type FileReference = {
  kind: FileReferenceKind
  raw: string
  pathOriginal: string
  pathAbs: string
  pathRel: string
  isRelative: boolean
  locationFormat: FileReferenceLocationFormat
  lineStart: number
  lineEnd: number
  column: number
}

export type ReferenceRenderConfig = {
  normalizeAgents?: string[]
  renderPlatforms?: string[]
  displayPath?: "absolute" | "relative" | "basename" | "dirname_basename" | "smart"
  markerStyle?: "none" | "ascii" | "emoji"
  enclosureStyle?: "none" | "bracket" | "angle" | "fullwidth" | "code"
}

export type ReferenceViewMode = "file_head" | "context" | "range" | "dir"

export type ReferenceViewRequest = {
  ref: FileReference
  mode: ReferenceViewMode
  window: number
  maxLines: number
  maxEntries: number
}

const DEFAULT_SHOW_HEAD_LINES = 80
const DEFAULT_SHOW_CONTEXT_LINES = 8
const DEFAULT_SHOW_MAX_RANGE = 120
const DEFAULT_SHOW_MAX_ENTRIES = 50

const MARKDOWN_LINK_RE = /^\[([^\]]+)\]\(([^)\s]+)\)((?::\d+(?::\d+)?|:\d+-\d+)?)?$/
const HASH_LOCATION_RE = /^(.*?)(#L(\d+)(?:C(\d+))?)$/
const COLON_LINE_COL_RE = /^(.*):(\d+):(\d+)$/
const COLON_LINE_RANGE_RE = /^(.*):(\d+)-(\d+)$/
const COLON_LINE_ONLY_RE = /^(.*):(\d+)$/
const FENCE_BLOCK_RE = /```[\s\S]*?```/gu
const INLINE_CODE_RE = /`([^`\n]+)`/gu
const BARE_URL_RE = /https?:\/\/[^\s<>()]+/gu
const ABS_OR_FILE_REF_RE = /file:\/\/\/[^\s`<>\[\](),，、;；。！？!？]+|\/[^\s`<>\[\](),，、;；。！？!？]+/gu
const RELATIVE_REF_RE = /(?:\.\.?\/|[A-Za-z0-9_.-]+\/)[^\s`<>\[\](),，、;；。！？!？]+/gu
const BASENAME_FILE_REF_RE = /\b[A-Za-z0-9_.-]+\.[A-Za-z0-9_.-]+(?:#L\d+(?:C\d+)?|:\d+(?::\d+)?|:\d+-\d+)?\b/gu

const SUPPORTED_AGENTS = ["codex", "claudecode"]
const SUPPORTED_PLATFORMS = ["feishu", "weixin"]

function toPosix(value: string): string {
  return value.split(path.sep).join("/")
}

function parsePositiveInt(value: string | undefined): number {
  if (!value || !/^\d+$/u.test(value)) {
    return 0
  }

  return Number.parseInt(value, 10)
}

function isWebUrl(value: string): boolean {
  return value.startsWith("http://") || value.startsWith("https://")
}

function looksLikeLocalPath(value: string): boolean {
  if (!value || isWebUrl(value) || value.startsWith("//")) {
    return false
  }
  if (value.startsWith("/") || value.startsWith("./") || value.startsWith("../")) {
    return true
  }
  if (value.includes("/")) {
    return true
  }

  return path.basename(value).includes(".")
}

function inferKind(ref: Omit<FileReference, "kind">): FileReferenceKind {
  if (ref.pathAbs) {
    try {
      const stat = fs.statSync(ref.pathAbs)
      return stat.isDirectory() ? "dir" : "file"
    } catch {
      // Fall through to syntactic inference.
    }
  }

  if (ref.locationFormat !== "none") {
    return "file"
  }
  if (ref.pathOriginal.endsWith("/")) {
    return "dir"
  }
  if (path.extname(path.basename(ref.pathOriginal.replace(/\/$/u, "")))) {
    return "file"
  }
  return "unknown"
}

function workspaceRelative(workspaceDir: string, absolutePath: string): string {
  return toPosix(path.relative(workspaceDir, absolutePath))
}

function isWithinWorkspace(workspaceDir: string, absolutePath: string): boolean {
  const rel = path.relative(path.resolve(workspaceDir), path.resolve(absolutePath))
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))
}

export function parseLocalReference(rawInput: string, workspaceDir: string): FileReference | null {
  let raw = rawInput.trim()
  if (!raw || isWebUrl(raw) || raw.startsWith("//")) {
    return null
  }

  const markdown = MARKDOWN_LINK_RE.exec(raw)
  if (markdown?.[2]) {
    raw = `${markdown[2]}${markdown[3] ?? ""}`
  }

  let pathPart = raw
  let locationFormat: FileReferenceLocationFormat = "none"
  let lineStart = 0
  let lineEnd = 0
  let column = 0

  const hash = HASH_LOCATION_RE.exec(pathPart)
  const lineCol = COLON_LINE_COL_RE.exec(pathPart)
  const lineRange = COLON_LINE_RANGE_RE.exec(pathPart)
  const lineOnly = COLON_LINE_ONLY_RE.exec(pathPart)

  if (hash?.[1]) {
    pathPart = hash[1]
    lineStart = parsePositiveInt(hash[3])
    column = parsePositiveInt(hash[4])
    locationFormat = column > 0 ? "hash_line_col" : "hash_line"
  } else if (lineCol?.[1]) {
    pathPart = lineCol[1]
    lineStart = parsePositiveInt(lineCol[2])
    column = parsePositiveInt(lineCol[3])
    locationFormat = "colon_line_col"
  } else if (lineRange?.[1]) {
    pathPart = lineRange[1]
    lineStart = parsePositiveInt(lineRange[2])
    lineEnd = parsePositiveInt(lineRange[3])
    locationFormat = "colon_line_range"
  } else if (lineOnly?.[1]) {
    pathPart = lineOnly[1]
    lineStart = parsePositiveInt(lineOnly[2])
    locationFormat = "colon_line"
  }

  if (pathPart.startsWith("file://")) {
    try {
      pathPart = new URL(pathPart).pathname
    } catch {
      return null
    }
  }

  if (!looksLikeLocalPath(pathPart)) {
    return null
  }

  const resolvedWorkspace = workspaceDir ? path.resolve(workspaceDir) : ""
  const isRelative = !path.isAbsolute(pathPart)
  const pathAbs = isRelative && resolvedWorkspace
    ? path.resolve(resolvedWorkspace, pathPart)
    : path.resolve(pathPart)
  const pathRel = resolvedWorkspace ? workspaceRelative(resolvedWorkspace, pathAbs) : ""
  const baseRef = {
    raw,
    pathOriginal: pathPart,
    pathAbs,
    pathRel,
    isRelative,
    locationFormat,
    lineStart,
    lineEnd,
    column,
  }

  return {
    ...baseRef,
    kind: inferKind(baseRef),
  }
}

export function requireWorkspaceReference(rawInput: string, workspaceDir: string): FileReference {
  const ref = parseLocalReference(rawInput, workspaceDir)
  if (!ref) {
    throw new Error("cannot parse local reference")
  }
  if (!workspaceDir || !isWithinWorkspace(workspaceDir, ref.pathAbs)) {
    throw new Error("reference must stay inside the workspace")
  }
  return ref
}

function normalizeScope(values: readonly string[] | undefined, supported: readonly string[]): string[] {
  if (!values?.length) {
    return []
  }

  const out: string[] = []
  let hasAll = false
  for (const value of values) {
    const key = value.trim().toLowerCase()
    if (!key) {
      continue
    }
    if (key === "all") {
      hasAll = true
      continue
    }
    if (supported.includes(key) && !out.includes(key)) {
      out.push(key)
    }
  }

  return hasAll ? [...supported] : out
}

function renderEnabled(config: Required<ReferenceRenderConfig>, agentName: string, platformName: string): boolean {
  const agents = normalizeScope(config.normalizeAgents, SUPPORTED_AGENTS)
  const platforms = normalizeScope(config.renderPlatforms, SUPPORTED_PLATFORMS)
  return agents.includes(agentName.trim().toLowerCase()) && platforms.includes(platformName.trim().toLowerCase())
}

function normalizeConfig(config: ReferenceRenderConfig): Required<ReferenceRenderConfig> {
  return {
    normalizeAgents: config.normalizeAgents ?? [],
    renderPlatforms: config.renderPlatforms ?? [],
    displayPath: config.displayPath ?? "dirname_basename",
    markerStyle: config.markerStyle ?? "emoji",
    enclosureStyle: config.enclosureStyle ?? "code",
  }
}

function appendDirSuffix(value: string, kind: FileReferenceKind): string {
  const cleaned = toPosix(value.trim())
  if (!cleaned) {
    return cleaned
  }
  if (kind === "dir" && !cleaned.endsWith("/")) {
    return `${cleaned}/`
  }
  return cleaned.replace(/\/+$/u, "")
}

function sanitizeRelativeDisplay(value: string): string {
  const rel = toPosix(value.trim())
  if (!rel || rel === "." || rel === ".." || rel.startsWith("../")) {
    return ""
  }
  return rel
}

function cleanDisplayPath(value: string): string {
  return toPosix(value).replace(/^\.\//u, "").trim()
}

function pathTail(ref: FileReference, segments: number): string {
  let source = sanitizeRelativeDisplay(ref.pathRel)
  if (!source) {
    source = ref.isRelative ? cleanDisplayPath(ref.pathOriginal) : toPosix(ref.pathAbs)
  }

  const parts = source.replace(/\/+$/u, "").split("/")
  if (segments <= 0 || parts.length <= segments) {
    return source
  }
  return parts.slice(parts.length - segments).join("/")
}

function displaySource(ref: FileReference, mode: Required<ReferenceRenderConfig>["displayPath"]): string {
  switch (mode) {
    case "absolute":
      return appendDirSuffix(ref.pathAbs || cleanDisplayPath(ref.pathOriginal), ref.kind)
    case "relative":
      if (ref.pathRel === ".") {
        return ref.kind === "dir" ? "./" : "."
      }
      return appendDirSuffix(sanitizeRelativeDisplay(ref.pathRel) || cleanDisplayPath(ref.pathOriginal), ref.kind)
    case "basename":
      return appendDirSuffix(pathTail(ref, 1), ref.kind)
    case "dirname_basename":
      return appendDirSuffix(pathTail(ref, 2), ref.kind)
    case "smart":
      return appendDirSuffix(pathTail(ref, 1), ref.kind)
  }
}

function referenceLocation(ref: FileReference): string {
  switch (ref.locationFormat) {
    case "colon_line":
      return `:${ref.lineStart}`
    case "colon_line_col":
      return `:${ref.lineStart}:${ref.column}`
    case "colon_line_range":
      return `:${ref.lineStart}-${ref.lineEnd}`
    case "hash_line":
      return `#L${ref.lineStart}`
    case "hash_line_col":
      return `#L${ref.lineStart}C${ref.column}`
    case "none":
      return ""
  }
}

function applyEnclosure(style: Required<ReferenceRenderConfig>["enclosureStyle"], body: string): string {
  switch (style) {
    case "bracket":
      return `[${body}]`
    case "angle":
      return `<${body}>`
    case "fullwidth":
      return `【${body}】`
    case "code":
      return `\`${body}\``
    case "none":
      return body
  }
}

function applyMarker(style: Required<ReferenceRenderConfig>["markerStyle"], kind: FileReferenceKind, body: string): string {
  if (style === "ascii") {
    if (kind === "dir") {
      return `[DIR] ${body}`
    }
    if (kind === "file") {
      return `[FILE] ${body}`
    }
  }
  if (style === "emoji") {
    if (kind === "dir") {
      return `\u{1f4c1} ${body}`
    }
    if (kind === "file") {
      return `\u{1f4c4} ${body}`
    }
  }
  return body
}

function renderLocalReference(
  ref: FileReference,
  config: Required<ReferenceRenderConfig>,
  basenameCounts: Map<string, number>,
): string {
  let displayMode = config.displayPath
  if (displayMode === "smart") {
    const base = displaySource(ref, "basename").replace(/\/$/u, "")
    displayMode = (basenameCounts.get(base) ?? 0) <= 1 ? "basename" : "dirname_basename"
  }

  const body = applyEnclosure(config.enclosureStyle, `${displaySource(ref, displayMode)}${referenceLocation(ref)}`)
  return applyMarker(config.markerStyle, ref.kind, body)
}

function splitWithMatches(text: string, regex: RegExp): Array<{ text: string; matched: boolean }> {
  const parts: Array<{ text: string; matched: boolean }> = []
  let last = 0
  for (const match of text.matchAll(regex)) {
    const index = match.index ?? 0
    if (index > last) {
      parts.push({ text: text.slice(last, index), matched: false })
    }
    parts.push({ text: match[0], matched: true })
    last = index + match[0].length
  }
  if (last < text.length) {
    parts.push({ text: text.slice(last), matched: false })
  }
  return parts.length ? parts : [{ text, matched: false }]
}

type ReferenceCandidate = {
  token: string
  start: number
  end: number
  ref: FileReference
}

function collectReferenceCandidates(text: string, workspaceDir: string): ReferenceCandidate[] {
  const candidates: ReferenceCandidate[] = []
  for (const regex of [ABS_OR_FILE_REF_RE, RELATIVE_REF_RE, BASENAME_FILE_REF_RE]) {
    regex.lastIndex = 0
    for (const match of text.matchAll(regex)) {
      const token = match[0]
      const start = match.index ?? 0
      const ref = parseLocalReference(token, workspaceDir)
      if (!ref || !isWithinWorkspace(workspaceDir, ref.pathAbs)) {
        continue
      }
      candidates.push({ token, start, end: start + token.length, ref })
    }
  }

  const selected: ReferenceCandidate[] = []
  for (const candidate of candidates.sort((left, right) =>
    left.start - right.start || right.token.length - left.token.length
  )) {
    const previous = selected[selected.length - 1]
    if (previous && candidate.start < previous.end) {
      continue
    }
    selected.push(candidate)
  }
  return selected
}

function transformOutsideFence(text: string, config: Required<ReferenceRenderConfig>, workspaceDir: string): string {
  const inlineParts = splitWithMatches(text, INLINE_CODE_RE)
  return inlineParts.map((part) => {
    if (part.matched) {
      const inner = part.text.slice(1, -1)
      const ref = parseLocalReference(inner, workspaceDir)
      if (!ref || !isWithinWorkspace(workspaceDir, ref.pathAbs)) {
        return part.text
      }
      return renderLocalReference(ref, config, new Map([[displaySource(ref, "basename").replace(/\/$/u, ""), 1]]))
    }

    const protectedText = part.text.replace(BARE_URL_RE, (url) => `\u0000KEEP:${Buffer.from(url).toString("base64")}\u0000`)
    const candidates = collectReferenceCandidates(protectedText, workspaceDir)
    const basenameCounts = new Map<string, number>()
    for (const candidate of candidates) {
      const base = displaySource(candidate.ref, "basename").replace(/\/$/u, "")
      basenameCounts.set(base, (basenameCounts.get(base) ?? 0) + 1)
    }

    let rendered = ""
    let cursor = 0
    for (const candidate of candidates) {
      rendered += protectedText.slice(cursor, candidate.start)
      rendered += renderLocalReference(candidate.ref, config, basenameCounts)
      cursor = candidate.end
    }
    rendered += protectedText.slice(cursor)

    return rendered.replace(/\u0000KEEP:([A-Za-z0-9+/=]+)\u0000/gu, (_token, encoded: string) =>
      Buffer.from(encoded, "base64").toString("utf8"))
  }).join("")
}

export function transformLocalReferences(
  text: string,
  config: ReferenceRenderConfig,
  agentName: string,
  platformName: string,
  workspaceDir: string,
): string {
  const normalized = normalizeConfig(config)
  if (!text.trim() || !renderEnabled(normalized, agentName, platformName)) {
    return text
  }

  return splitWithMatches(text, FENCE_BLOCK_RE)
    .map((part) => part.matched ? part.text : transformOutsideFence(part.text, normalized, workspaceDir))
    .join("")
}

export function buildReferenceViewRequest(rawRef: string, workspaceDir: string): ReferenceViewRequest {
  const ref = requireWorkspaceReference(rawRef, workspaceDir)
  if (ref.kind === "dir" && ref.locationFormat !== "none") {
    throw new Error("directory reference cannot carry a location")
  }

  const request: ReferenceViewRequest = {
    ref,
    mode: "file_head",
    window: DEFAULT_SHOW_CONTEXT_LINES,
    maxLines: DEFAULT_SHOW_HEAD_LINES,
    maxEntries: DEFAULT_SHOW_MAX_ENTRIES,
  }

  if (ref.kind === "dir") {
    request.mode = "dir"
  } else if (ref.locationFormat === "colon_line_range") {
    request.mode = "range"
    request.maxLines = DEFAULT_SHOW_MAX_RANGE
  } else if (ref.locationFormat !== "none") {
    request.mode = "context"
    request.maxLines = DEFAULT_SHOW_MAX_RANGE
  }

  return request
}

function readFileLines(filePath: string): string[] {
  return fs.readFileSync(filePath, "utf8").split(/\r?\n/u)
}

function readFileHead(filePath: string, maxLines: number): { lines: string[]; truncated: boolean } {
  const lines = readFileLines(filePath)
  return {
    lines: lines.slice(0, maxLines),
    truncated: lines.length > maxLines,
  }
}

function readFileRange(filePath: string, start: number, end: number, maxLines: number): { lines: string[]; truncated: boolean } {
  if (start <= 0) {
    throw new Error("invalid start line")
  }
  if (end <= 0 || end < start) {
    throw new Error("invalid end line")
  }

  const lines = readFileLines(filePath)
  const selected = lines.slice(start - 1, end)
  return {
    lines: selected.slice(0, maxLines),
    truncated: selected.length > maxLines,
  }
}

function readFileContext(filePath: string, line: number, before: number, after: number, maxLines: number): { lines: string[]; truncated: boolean } {
  if (line <= 0) {
    throw new Error("invalid line")
  }
  return readFileRange(filePath, Math.max(1, line - before), line + after, maxLines)
}

function codeFenceLanguage(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case ".go":
      return "go"
    case ".ts":
      return "ts"
    case ".tsx":
      return "tsx"
    case ".js":
      return "js"
    case ".jsx":
      return "jsx"
    case ".py":
      return "python"
    case ".md":
      return "markdown"
    case ".json":
      return "json"
    case ".yaml":
    case ".yml":
      return "yaml"
    case ".sh":
      return "bash"
    default:
      return ""
  }
}

function showTitle(ref: FileReference): string {
  const body = `${displaySource(ref, "relative")}${referenceLocation(ref)}`
  return applyMarker("ascii", ref.kind, body)
}

export function renderReferenceView(request: ReferenceViewRequest): string {
  if (!request.ref.pathAbs) {
    throw new Error("empty path")
  }
  const stat = fs.statSync(request.ref.pathAbs)
  if (stat.isDirectory()) {
    if (request.ref.locationFormat !== "none") {
      throw new Error("directory reference cannot carry a location")
    }
    const entries = fs.readdirSync(request.ref.pathAbs, { withFileTypes: true })
    const visible = entries.slice(0, request.maxEntries).map((entry) => `${entry.name}${entry.isDirectory() ? "/" : ""}`)
    const lines = [showTitle(request.ref)]
    if (visible.length === 0) {
      lines.push("(empty)")
    } else {
      lines.push(...visible.map((entry) => `- ${entry}`))
    }
    if (entries.length > request.maxEntries) {
      lines.push("", `Only showing the first ${request.maxEntries} entries.`)
    }
    return lines.join("\n")
  }

  let body: { lines: string[]; truncated: boolean }
  let note = ""
  if (request.mode === "context") {
    body = readFileContext(request.ref.pathAbs, request.ref.lineStart, request.window, request.window, request.maxLines)
  } else if (request.mode === "range") {
    body = readFileRange(request.ref.pathAbs, request.ref.lineStart, request.ref.lineEnd, request.maxLines)
    if (body.truncated) {
      note = `Only showing the first ${request.maxLines} lines of the requested range.`
    }
  } else {
    body = readFileHead(request.ref.pathAbs, request.maxLines)
    if (body.truncated) {
      note = `Only showing the first ${request.maxLines} lines.`
    }
  }

  const language = codeFenceLanguage(request.ref.pathAbs)
  return [
    showTitle(request.ref),
    ...(note ? [note] : []),
    `\`\`\`${language}`,
    ...body.lines,
    "```",
  ].join("\n")
}
