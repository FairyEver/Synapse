import { MOBILE_WORKSPACE_FILES_LIMITS as L } from "@synapse/shared/mobile-live-constants"
import { constants } from "node:fs"
import { lstat, open, opendir, realpath } from "node:fs/promises"
import path from "node:path"

export class MobileWorkspaceFilesError extends Error {
  constructor(readonly code: string) { super(code); this.name = "MobileWorkspaceFilesError" }
}

export const MOBILE_FILE_EXCLUDED_NAMES = new Set([".git", ".svn", ".hg", "CVS", ".DS_Store", "Thumbs.db"])
export const utf8Bytes = (value: unknown): number => Buffer.byteLength(typeof value === "string" ? value : JSON.stringify(value), "utf8")
export const fileIdentity = (stats: Awaited<ReturnType<typeof lstat>>): string => `${stats.dev}:${stats.ino}:${stats.size}:${stats.mtimeMs}:${stats.ctimeMs}:${stats.mode}`

export function safeRelativePath(value: string): string {
  if (value === "") return value
  if (path.isAbsolute(value) || /[\x00-\x1f\x7f]/.test(value) || utf8Bytes(value) > L.maxPathBytes) throw new MobileWorkspaceFilesError("unsafe_path")
  const segments = process.platform === "win32" ? value.split(/[\\/]/) : value.split("/")
  if (segments.some((part) => !part || part === "." || part === ".." || (process.platform === "win32" && (part.includes(":") || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part) || /[. ]$/.test(part))))) {
    throw new MobileWorkspaceFilesError("unsafe_path")
  }
  return segments.join(path.sep)
}

export function isWithinRoot(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
}

export async function canonicalRoot(cwd: string): Promise<{ path: string; identity: string }> {
  if (!path.isAbsolute(cwd) || /[\x00-\x1f\x7f]/.test(cwd) || /^\\\\|^\/\//.test(cwd)) throw new MobileWorkspaceFilesError("unsafe_path")
  const resolved = await realpath(cwd)
  const stats = await lstat(resolved)
  if (!stats.isDirectory() || stats.isSymbolicLink()) throw new MobileWorkspaceFilesError("unsafe_path")
  // Directory timestamps legitimately change; retain object identity only for the root.
  return { path: resolved, identity: `${stats.dev}:${stats.ino}` }
}

/** Verify every ancestor, not just the leaf's realpath. Never follow a link. */
export async function checkedNode(root: string, relative: string, allowSpecial = false) {
  const normalized = safeRelativePath(relative)
  let target = root
  const ancestors: string[] = []
  for (const segment of ["", ...normalized.split(path.sep).filter(Boolean)]) {
    if (segment) target = path.join(target, segment)
    const stats = await lstat(target)
    if (stats.isSymbolicLink()) {
      if (allowSpecial && target === path.join(root, normalized)) return { path: target, stats, identity: fileIdentity(stats), ancestors, kind: "symlink" as const }
      throw new MobileWorkspaceFilesError("unsafe_path")
    }
    if (target !== path.join(root, normalized) && !stats.isDirectory()) throw new MobileWorkspaceFilesError("unsafe_path")
    const resolved = await realpath(target)
    if (!isWithinRoot(root, resolved) || resolved !== target) throw new MobileWorkspaceFilesError("unsafe_path")
    ancestors.push(`${target}:${stats.dev}:${stats.ino}`)
  }
  const stats = await lstat(target)
  const kind = stats.isDirectory() ? "directory" as const : stats.isFile() ? "file" as const : "special" as const
  if (kind === "special" && !allowSpecial) throw new MobileWorkspaceFilesError("special_file")
  return { path: target, stats, identity: fileIdentity(stats), ancestors, kind }
}

export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new MobileWorkspaceFilesError("cancelled")
}

export async function enumerateDirectory(root: string, relative: string, signal: AbortSignal) {
  const before = await checkedNode(root, relative)
  if (before.kind !== "directory") throw new MobileWorkspaceFilesError("unsafe_path")
  const start = performance.now()
  const entries: Array<{ name: string; relativePath: string; kind: "directory" | "file" | "symlink" | "special" }> = []
  let bytes = 0
  const directory = await opendir(before.path)
  for await (const dirent of directory) {
    throwIfAborted(signal)
    if (performance.now() - start > L.searchRequestMs || entries.length >= L.maxDirectoryEntries) throw new MobileWorkspaceFilesError("limit_exceeded")
    if (MOBILE_FILE_EXCLUDED_NAMES.has(dirent.name)) continue
    const relativePath = relative ? path.join(relative, dirent.name) : dirent.name
    let safe = true
    try { safeRelativePath(relativePath) } catch { safe = false }
    if (utf8Bytes(relativePath) > L.maxPathBytes) throw new MobileWorkspaceFilesError("limit_exceeded")
    const entry = { name: dirent.name, relativePath, kind: !safe ? "special" as const : dirent.isDirectory() ? "directory" as const : dirent.isFile() ? "file" as const : dirent.isSymbolicLink() ? "symlink" as const : "special" as const }
    bytes += utf8Bytes(entry)
    if (bytes > L.maxFileSideBytes) throw new MobileWorkspaceFilesError("limit_exceeded")
    entries.push(entry)
  }
  const after = await checkedNode(root, relative)
  if (before.identity !== after.identity || before.ancestors.join("|") !== after.ancestors.join("|")) throw new MobileWorkspaceFilesError("content_stale")
  entries.sort((left, right) => Number(right.kind === "directory") - Number(left.kind === "directory") || left.name.localeCompare(right.name, "en"))
  return { entries, version: before.identity }
}

export async function readDiskFile(root: string, relative: string, signal: AbortSignal): Promise<{ bytes: Buffer; version: string }> {
  const before = await checkedNode(root, relative)
  if (before.kind !== "file") throw new MobileWorkspaceFilesError("special_file")
  if (before.stats.size > L.maxFileSideBytes) throw new MobileWorkspaceFilesError("limit_exceeded")
  const handle = await open(before.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0))
  try {
    const descriptor = await handle.stat()
    if (fileIdentity(descriptor) !== before.identity || !descriptor.isFile()) throw new MobileWorkspaceFilesError("content_stale")
    const chunks: Buffer[] = []
    let bytes = 0
    while (true) {
      throwIfAborted(signal)
      const buffer = Buffer.alloc(Math.min(L.maxPageDisplayBytes, L.maxFileSideBytes + 1 - bytes))
      const result = await handle.read(buffer, 0, buffer.length, null)
      if (result.bytesRead === 0) break
      bytes += result.bytesRead
      if (bytes > L.maxFileSideBytes) throw new MobileWorkspaceFilesError("limit_exceeded")
      chunks.push(buffer.subarray(0, result.bytesRead))
    }
    const after = await checkedNode(root, relative)
    if (before.identity !== after.identity || before.ancestors.join("|") !== after.ancestors.join("|")) throw new MobileWorkspaceFilesError("content_stale")
    return { bytes: Buffer.concat(chunks), version: before.identity }
  } finally { await handle.close() }
}

export function decodeText(bytes: Buffer): string {
  if (bytes.includes(0)) throw new MobileWorkspaceFilesError("binary")
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes) }
  catch { throw new MobileWorkspaceFilesError("unsupported_encoding") }
}

/** Scan complete lines without expanding a newline-heavy file into an array. */
export function* textLines(text: string, start = 0): Generator<{ text: string; start: number; next: number }> {
  let offset = start
  while (offset < text.length) {
    const newline = text.indexOf("\n", offset)
    const next = newline < 0 ? text.length : newline + 1
    const end = newline < 0 ? text.length : newline > offset && text[newline - 1] === "\r" ? newline - 1 : newline
    yield { text: text.slice(offset, end), start: offset, next }
    offset = next
  }
}
