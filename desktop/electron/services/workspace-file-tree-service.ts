import { randomUUID } from "node:crypto"
import { lstat, readdir, realpath } from "node:fs/promises"
import { watch, type FSWatcher } from "node:fs"
import path from "node:path"

import type {
  WorkspaceFileTreeChangedEvent,
  WorkspaceFileTreeDirectoryResult,
  WorkspaceFileTreeEntry,
  WorkspaceFileTreeResolvePathsResult,
  WorkspaceFileTreeScope,
} from "../../src/types/workspace-file-tree"
import type { AuditSink, PermissionGuard } from "../runtime/security"

export const WORKSPACE_FILE_TREE_SERVICE_ID = "core.workspace-file-tree"

type WorkspaceFileTreeSurface = "agent" | "terminal"

type WorkspaceFileTreeLogger = {
  warn(message: string, metadata?: Record<string, unknown>): void
}

type TreeScope = {
  readonly id: string
  readonly ownerId: number
  readonly rootPath: string
  readonly rootKey: string
  readonly surface: WorkspaceFileTreeSurface
  revision: number
}

type RootWatch = {
  readonly rootPath: string
  readonly scopeIds: Set<string>
  readonly directoryWatchers: Map<string, FSWatcher>
  readonly pendingPaths: Set<string>
  recursiveWatcher?: FSWatcher
  flushTimer?: ReturnType<typeof setTimeout>
}

export type WorkspaceFileTreeInternalChangedEvent = WorkspaceFileTreeChangedEvent & {
  readonly ownerId: number
  readonly surface: WorkspaceFileTreeSurface
}

export type WorkspaceFileTreeService = ReturnType<typeof createWorkspaceFileTreeService>

const EXCLUDED_NAMES = new Set([".git", ".svn", ".hg", "CVS", ".DS_Store", "Thumbs.db"])
const WATCH_DEBOUNCE_MS = 100

export function createWorkspaceFileTreeService(deps: {
  readonly permissionGuard: PermissionGuard
  readonly auditSink: AuditSink
  readonly logger?: WorkspaceFileTreeLogger
}) {
  const scopes = new Map<string, TreeScope>()
  const roots = new Map<string, RootWatch>()
  const listeners = new Set<(event: WorkspaceFileTreeInternalChangedEvent) => void>()

  function requireScope(scopeId: string, ownerId: number): TreeScope {
    const scope = scopes.get(scopeId)
    if (!scope || scope.ownerId !== ownerId) throw new WorkspaceFileTreeError("invalid_scope")
    return scope
  }

  function surfaceForRoot(root: RootWatch): WorkspaceFileTreeSurface | "unknown" {
    for (const scopeId of root.scopeIds) {
      const scope = scopes.get(scopeId)
      if (scope) return scope.surface
    }
    return "unknown"
  }

  async function openScope(input: {
    readonly ownerId: number
    readonly rootPath: string
    readonly surface: WorkspaceFileTreeSurface
    readonly projectId?: string
    readonly sessionId?: string
  }): Promise<WorkspaceFileTreeScope> {
    const permission = await deps.permissionGuard.check({
      action: "fs.read.outside-userdata",
      actor: { kind: "user", id: "renderer" },
      resource: input.rootPath,
      context: { source: "workspace-file-tree", surface: input.surface },
    })
    if (!permission.allowed) {
      recordAudit(input, "denied")
      throw new WorkspaceFileTreeError("permission_denied")
    }

    let canonicalRoot: string
    try {
      const surfaceStats = await lstat(input.rootPath)
      if (!surfaceStats.isDirectory() && !surfaceStats.isSymbolicLink()) {
        throw new WorkspaceFileTreeError("unavailable")
      }
      canonicalRoot = await realpath(input.rootPath)
      const canonicalStats = await lstat(canonicalRoot)
      if (!canonicalStats.isDirectory()) throw new WorkspaceFileTreeError("unavailable")
    } catch (error) {
      recordAudit(input, "failed")
      if (error instanceof WorkspaceFileTreeError) throw error
      throw new WorkspaceFileTreeError("unavailable")
    }

    const id = randomUUID()
    const rootKey = normalizeRootKey(canonicalRoot)
    const scope: TreeScope = {
      id,
      ownerId: input.ownerId,
      rootPath: canonicalRoot,
      rootKey,
      surface: input.surface,
      revision: 0,
    }
    scopes.set(id, scope)
    ensureRootWatch(scope)
    recordAudit(input, "allowed")
    return {
      scopeId: id,
      rootName: path.basename(canonicalRoot) || canonicalRoot,
      revision: 0,
    }
  }

  async function listDirectory(input: {
    readonly ownerId: number
    readonly scopeId: string
    readonly relativePath: string
  }): Promise<WorkspaceFileTreeDirectoryResult> {
    const scope = requireScope(input.scopeId, input.ownerId)
    const relativePath = normalizeRelativePath(input.relativePath)
    const targetPath = resolveDescendantPath(scope.rootPath, relativePath)

    let entries: WorkspaceFileTreeEntry[]
    try {
      const targetStats = await lstat(targetPath)
      if (!targetStats.isDirectory() || targetStats.isSymbolicLink()) {
        throw new WorkspaceFileTreeError("invalid_path")
      }
      const canonicalTarget = await realpath(targetPath)
      assertWithinRoot(scope.rootPath, canonicalTarget)
      const dirents = await readdir(canonicalTarget, { withFileTypes: true })
      entries = dirents
        .filter((entry) => !isExcludedName(entry.name))
        .flatMap((entry): WorkspaceFileTreeEntry[] => {
          const kind = entry.isDirectory()
            ? "directory" as const
            : entry.isFile()
              ? "file" as const
              : entry.isSymbolicLink()
                ? "symbolic-link" as const
                : null
          if (!kind) return []
          return [{
            relativePath: joinRelativePath(relativePath, entry.name),
            name: entry.name,
            kind,
          }]
        })
        .sort(compareEntries)
      ensureFallbackDirectoryWatch(scope.rootKey, canonicalTarget)
    } catch (error) {
      if (error instanceof WorkspaceFileTreeError) throw error
      throw new WorkspaceFileTreeError("unavailable")
    }

    return {
      scopeId: scope.id,
      relativePath,
      revision: scope.revision,
      entries,
    }
  }

  async function resolvePaths(input: {
    readonly ownerId: number
    readonly scopeId: string
    readonly relativePaths: readonly string[]
  }): Promise<WorkspaceFileTreeResolvePathsResult> {
    const scope = requireScope(input.scopeId, input.ownerId)
    const paths = await Promise.all(input.relativePaths.map(async (value) => {
      const relativePath = normalizeRelativePath(value)
      if (!relativePath) throw new WorkspaceFileTreeError("invalid_path")
      const targetPath = resolveDescendantPath(scope.rootPath, relativePath)
      try {
        const targetStats = await lstat(targetPath)
        if (!targetStats.isDirectory() && !targetStats.isFile() && !targetStats.isSymbolicLink()) {
          throw new WorkspaceFileTreeError("invalid_path")
        }
        if (!targetStats.isSymbolicLink()) {
          const canonicalTarget = await realpath(targetPath)
          assertWithinRoot(scope.rootPath, canonicalTarget)
        }
      } catch (error) {
        if (error instanceof WorkspaceFileTreeError) throw error
        throw new WorkspaceFileTreeError("unavailable")
      }
      return targetPath
    }))
    return { scopeId: scope.id, paths }
  }

  function closeScope(input: { readonly ownerId: number; readonly scopeId: string }): void {
    const scope = scopes.get(input.scopeId)
    if (!scope || scope.ownerId !== input.ownerId) return
    scopes.delete(scope.id)
    const root = roots.get(scope.rootKey)
    if (!root) return
    root.scopeIds.delete(scope.id)
    if (root.scopeIds.size === 0) closeRootWatch(scope.rootKey, root)
  }

  function closeOwner(ownerId: number): void {
    for (const scope of [...scopes.values()]) {
      if (scope.ownerId === ownerId) closeScope({ ownerId, scopeId: scope.id })
    }
  }

  function onChanged(listener: (event: WorkspaceFileTreeInternalChangedEvent) => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  function stop(): void {
    for (const [rootKey, root] of roots) closeRootWatch(rootKey, root)
    scopes.clear()
    listeners.clear()
  }

  function ensureRootWatch(scope: TreeScope): void {
    const existing = roots.get(scope.rootKey)
    if (existing) {
      existing.scopeIds.add(scope.id)
      return
    }
    const root: RootWatch = {
      rootPath: scope.rootPath,
      scopeIds: new Set([scope.id]),
      directoryWatchers: new Map(),
      pendingPaths: new Set(),
    }
    roots.set(scope.rootKey, root)
    try {
      root.recursiveWatcher = createWatcher(root, scope.rootPath, true, "")
    } catch {
      ensureFallbackDirectoryWatch(scope.rootKey, scope.rootPath)
    }
  }

  function ensureFallbackDirectoryWatch(rootKey: string, directoryPath: string): void {
    const root = roots.get(rootKey)
    if (!root || root.recursiveWatcher || root.directoryWatchers.has(directoryPath)) return
    const relativePath = toRelativePath(root.rootPath, directoryPath)
    try {
      root.directoryWatchers.set(
        directoryPath,
        createWatcher(root, directoryPath, false, relativePath),
      )
    } catch {
      deps.logger?.warn("Workspace file tree watcher unavailable.", {
        surface: surfaceForRoot(root),
        strategy: "directory",
      })
    }
  }

  function createWatcher(
    root: RootWatch,
    directoryPath: string,
    recursive: boolean,
    baseRelativePath: string,
  ): FSWatcher {
    const watcher = watch(directoryPath, { persistent: false, recursive }, (_eventType, filename) => {
      const changedPath = typeof filename === "string"
        ? joinRelativePath(baseRelativePath, filename.split(path.sep).join("/"))
        : baseRelativePath
      const affectedPath = excludedRelativePath(changedPath)
        ? null
        : parentRelativePath(changedPath)
      if (affectedPath === null) return
      root.pendingPaths.add(affectedPath)
      if (root.flushTimer) clearTimeout(root.flushTimer)
      root.flushTimer = setTimeout(() => flushRootChanges(root), WATCH_DEBOUNCE_MS)
    })
    watcher.on("error", () => {
      if (recursive && root.recursiveWatcher === watcher) {
        watcher.close()
        root.recursiveWatcher = undefined
        ensureFallbackDirectoryWatch(normalizeRootKey(root.rootPath), root.rootPath)
      } else {
        watcher.close()
        root.directoryWatchers.delete(directoryPath)
      }
      deps.logger?.warn("Workspace file tree watcher failed.", {
        surface: surfaceForRoot(root),
        strategy: recursive ? "recursive" : "directory",
      })
    })
    return watcher
  }

  function flushRootChanges(root: RootWatch): void {
    root.flushTimer = undefined
    const paths = root.pendingPaths.size > 0 ? [...root.pendingPaths] : [""]
    root.pendingPaths.clear()
    for (const scopeId of root.scopeIds) {
      const scope = scopes.get(scopeId)
      if (!scope) continue
      scope.revision++
      for (const relativePath of paths) {
        const event = {
          scopeId,
          relativePath,
          revision: scope.revision,
          ownerId: scope.ownerId,
          surface: scope.surface,
        } satisfies WorkspaceFileTreeInternalChangedEvent
        for (const listener of listeners) listener(event)
      }
    }
  }

  function closeRootWatch(rootKey: string, root: RootWatch): void {
    if (root.flushTimer) clearTimeout(root.flushTimer)
    root.recursiveWatcher?.close()
    for (const watcher of root.directoryWatchers.values()) watcher.close()
    roots.delete(rootKey)
  }

  function recordAudit(
    input: {
      readonly rootPath: string
      readonly surface: WorkspaceFileTreeSurface
      readonly projectId?: string
      readonly sessionId?: string
    },
    outcome: "allowed" | "denied" | "failed",
  ): void {
    deps.auditSink.record({
      action: "fs.read.outside-userdata",
      actor: { kind: "user", id: "renderer" },
      resource: input.rootPath,
      outcome,
      metadata: {
        source: "workspace-file-tree",
        surface: input.surface,
        ...(input.projectId ? { projectId: input.projectId } : {}),
        ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      },
    })
  }

  return { openScope, listDirectory, resolvePaths, closeScope, closeOwner, onChanged, stop }
}

export class WorkspaceFileTreeError extends Error {
  constructor(readonly code: "invalid_path" | "invalid_scope" | "permission_denied" | "unavailable") {
    super(code)
    this.name = "WorkspaceFileTreeError"
  }
}

function normalizeRelativePath(value: string): string {
  if (value.includes("\0") || path.posix.isAbsolute(value)) {
    throw new WorkspaceFileTreeError("invalid_path")
  }
  if (!value) return ""
  const segments = value.split("/")
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new WorkspaceFileTreeError("invalid_path")
  }
  return segments.join("/")
}

function resolveDescendantPath(rootPath: string, relativePath: string): string {
  const targetPath = relativePath
    ? path.join(rootPath, ...relativePath.split("/"))
    : rootPath
  assertWithinRoot(rootPath, targetPath)
  return targetPath
}

function assertWithinRoot(rootPath: string, targetPath: string): void {
  const relative = path.relative(rootPath, targetPath)
  if (relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) return
  throw new WorkspaceFileTreeError("invalid_path")
}

function joinRelativePath(parent: string, child: string): string {
  return parent ? `${parent}/${child}` : child
}

function parentRelativePath(relativePath: string): string {
  if (!relativePath) return ""
  const parent = path.posix.dirname(relativePath)
  return parent === "." ? "" : parent
}

function toRelativePath(rootPath: string, targetPath: string): string {
  const relative = path.relative(rootPath, targetPath)
  return relative ? relative.split(path.sep).join("/") : ""
}

function excludedRelativePath(relativePath: string): boolean {
  return relativePath.split("/").some(isExcludedName)
}

function isExcludedName(name: string): boolean {
  if (EXCLUDED_NAMES.has(name)) return true
  if (process.platform !== "win32") return false
  const folded = name.toLocaleLowerCase()
  return [...EXCLUDED_NAMES].some((candidate) => candidate.toLocaleLowerCase() === folded)
}

function normalizeRootKey(rootPath: string): string {
  return process.platform === "win32" ? rootPath.toLocaleLowerCase() : rootPath
}

function compareEntries(left: WorkspaceFileTreeEntry, right: WorkspaceFileTreeEntry): number {
  if (left.kind === "directory" && right.kind !== "directory") return -1
  if (left.kind !== "directory" && right.kind === "directory") return 1
  return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" })
}
