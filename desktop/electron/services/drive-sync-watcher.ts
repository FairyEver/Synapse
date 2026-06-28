import { lstatSync, watch as nodeWatch, type FSWatcher } from "node:fs"
import path from "node:path"
import type { DriveSyncBaselineEntryV1, DriveSyncBindingEntryV1 } from "../runtime/data-repo"
import { isDriveSyncExcluded } from "./drive-sync-excludes"
import { hashDriveSyncFile, inspectDriveSyncLocalPath, scanDriveSyncLocalTree } from "./drive-sync-local-snapshot"
import { toDriveSyncRelativePath } from "./drive-sync-paths"

export type DriveSyncLocalChangeKind = "created" | "modified" | "deleted"

export interface DriveSyncLocalChange {
  readonly bindingId: string
  readonly relativePath: string
  readonly kind: DriveSyncLocalChangeKind
  readonly localPath: string
  readonly localKind: "missing" | "file" | "folder" | "other"
}

export interface DriveSyncWatcherBindingScanInput {
  readonly binding: DriveSyncBindingEntryV1
  readonly baseline: readonly DriveSyncBaselineEntryV1[]
}

export interface DriveSyncWatcherDeps {
  readonly onChanges: (changes: readonly DriveSyncLocalChange[]) => void | Promise<void>
  readonly debounceMs?: number
  readonly watch?: DriveSyncWatchFactory
}

export type DriveSyncWatchFactory = (
  rootPath: string,
  options: { readonly persistent: false; readonly recursive: boolean },
  listener: (eventType: string, filename: string | Buffer | null) => void,
) => Pick<FSWatcher, "close" | "on">

interface WatchEntry {
  readonly binding: DriveSyncBindingEntryV1
  readonly rootPath: string
  readonly watcher: Pick<FSWatcher, "close" | "on">
}

export function createDriveSyncWatcher(deps: DriveSyncWatcherDeps) {
  const watch = deps.watch ?? defaultWatch
  const debounceMs = deps.debounceMs ?? 500
  const entries = new Map<string, WatchEntry>()
  const pending = new Map<string, Map<string, DriveSyncLocalChange>>()
  const timers = new Map<string, NodeJS.Timeout>()
  const selfWrites = new Map<string, number>()

  function reconcile(bindings: readonly DriveSyncBindingEntryV1[]): void {
    const active = bindings.filter((binding) => binding.status === "active")
    const activeIds = new Set(active.map((binding) => binding.id))

    for (const bindingId of entries.keys()) {
      if (!activeIds.has(bindingId)) stopBinding(bindingId)
    }

    for (const binding of active) {
      const existing = entries.get(binding.id)
      const rootPath = watchRootPath(binding)
      if (existing?.rootPath === rootPath && existing.binding.updatedAt === binding.updatedAt) continue
      stopBinding(binding.id)
      startBinding(binding, rootPath)
    }
  }

  function stop(): void {
    for (const bindingId of entries.keys()) stopBinding(bindingId)
    for (const timer of timers.values()) clearTimeout(timer)
    timers.clear()
    pending.clear()
    selfWrites.clear()
  }

  function markSelfWrite(input: { readonly bindingId: string; readonly relativePath: string }): void {
    selfWrites.set(selfWriteKey(input.bindingId, input.relativePath), Date.now() + 30_000)
  }

  async function scanBinding(input: DriveSyncWatcherBindingScanInput): Promise<readonly DriveSyncLocalChange[]> {
    const binding = input.binding
    if (binding.kind === "file") return scanFileBinding(binding, input.baseline)

    const localEntries = await scanDriveSyncLocalTree({
      rootPath: binding.localPath,
      rules: binding.excludeRules,
      hashFiles: true,
    })
    const localByPath = new Map(localEntries.map((entry) => [entry.relativePath, entry] as const))
    const baselineByPath = new Map(
      input.baseline
        .filter((entry) => entry.deletedAt === null)
        .map((entry) => [entry.relativePath, entry] as const),
    )
    const changes: DriveSyncLocalChange[] = []

    for (const local of localEntries) {
      const baseline = baselineByPath.get(local.relativePath)
      const localPath = path.join(binding.localPath, local.relativePath)
      if (!baseline) {
        changes.push(localChange(binding.id, local.relativePath, "created", localPath, local.kind))
      } else if (hasLocalChanged(local, baseline)) {
        changes.push(localChange(binding.id, local.relativePath, "modified", localPath, local.kind))
      }
    }

    for (const baseline of baselineByPath.values()) {
      if (baseline.relativePath === "" || localByPath.has(baseline.relativePath)) continue
      changes.push(localChange(
        binding.id,
        baseline.relativePath,
        "deleted",
        path.join(binding.localPath, baseline.relativePath),
        "missing",
      ))
    }

    return changes.sort(compareChanges)
  }

  function startBinding(binding: DriveSyncBindingEntryV1, rootPath: string): void {
    try {
      const watcher = watch(rootPath, { persistent: false, recursive: true }, (eventType, filename) => {
        handleRawEvent(binding.id, eventType, filename)
      })
      watcher.on("error", () => {
        enqueueLocalChange(binding, "", "deleted", binding.localPath, "missing")
      })
      entries.set(binding.id, { binding, rootPath, watcher })
    } catch {
      enqueueLocalChange(binding, "", "deleted", binding.localPath, "missing")
    }
  }

  function stopBinding(bindingId: string): void {
    const entry = entries.get(bindingId)
    if (!entry) return
    entry.watcher.close()
    entries.delete(bindingId)
  }

  function handleRawEvent(
    bindingId: string,
    eventType: string,
    filename: string | Buffer | null,
  ): void {
    const entry = entries.get(bindingId)
    if (!entry) return
    const binding = entry.binding
    const relativePath = eventRelativePath(binding, filename)
    if (relativePath === null) return
    if (binding.kind === "folder" && isDriveSyncExcluded(relativePath, binding.excludeRules)) return
    if (consumeSelfWrite(bindingId, relativePath)) return

    const localPath = binding.kind === "file" ? binding.localPath : path.join(binding.localPath, relativePath)
    const local = inspectDriveSyncLocalPathSync(localPath)
    const kind = local.kind === "missing"
      ? "deleted"
      : eventType === "rename"
        ? "created"
        : "modified"
    enqueueLocalChange(binding, relativePath, kind, localPath, local.kind)
  }

  function enqueueLocalChange(
    binding: DriveSyncBindingEntryV1,
    relativePath: string,
    kind: DriveSyncLocalChangeKind,
    localPath: string,
    localKind: DriveSyncLocalChange["localKind"],
  ): void {
    const byPath = pending.get(binding.id) ?? new Map<string, DriveSyncLocalChange>()
    byPath.set(relativePath, localChange(binding.id, relativePath, kind, localPath, localKind))
    pending.set(binding.id, byPath)

    const existingTimer = timers.get(binding.id)
    if (existingTimer) clearTimeout(existingTimer)
    timers.set(binding.id, setTimeout(() => {
      timers.delete(binding.id)
      void flush(binding.id)
    }, debounceMs))
  }

  async function flush(bindingId: string): Promise<void> {
    const byPath = pending.get(bindingId)
    if (!byPath || byPath.size === 0) return
    pending.delete(bindingId)
    await deps.onChanges([...byPath.values()].sort(compareChanges))
  }

  function consumeSelfWrite(bindingId: string, relativePath: string): boolean {
    const key = selfWriteKey(bindingId, relativePath)
    const expiresAt = selfWrites.get(key)
    if (!expiresAt) return false
    if (expiresAt < Date.now()) {
      selfWrites.delete(key)
      return false
    }
    selfWrites.delete(key)
    return true
  }

  return {
    reconcile,
    stop,
    markSelfWrite,
    scanBinding,
  }
}

async function scanFileBinding(
  binding: DriveSyncBindingEntryV1,
  baseline: readonly DriveSyncBaselineEntryV1[],
): Promise<readonly DriveSyncLocalChange[]> {
  const current = await inspectDriveSyncLocalPath(binding.localPath)
  const existing = baseline.find((entry) => entry.relativePath === "" && entry.deletedAt === null)
  if (current.kind === "missing") {
    return existing ? [localChange(binding.id, "", "deleted", binding.localPath, "missing")] : []
  }
  if (current.kind !== "file") {
    return [localChange(binding.id, "", existing ? "modified" : "created", binding.localPath, current.kind)]
  }
  if (!existing) return [localChange(binding.id, "", "created", binding.localPath, "file")]
  const hash = await hashDriveSyncFile(binding.localPath)
  return hash !== existing.localHash
    ? [localChange(binding.id, "", "modified", binding.localPath, "file")]
    : []
}

function eventRelativePath(binding: DriveSyncBindingEntryV1, filename: string | Buffer | null): string | null {
  if (binding.kind === "file") {
    if (!filename) return ""
    return path.basename(String(filename)) === path.basename(binding.localPath) ? "" : null
  }
  if (!filename) return ""
  return toDriveSyncRelativePath(binding.localPath, path.join(binding.localPath, String(filename)))
}

function watchRootPath(binding: DriveSyncBindingEntryV1): string {
  return binding.kind === "file" ? path.dirname(binding.localPath) : binding.localPath
}

function hasLocalChanged(
  local: { readonly kind: "file" | "folder"; readonly hash: string | null; readonly size: number | null; readonly mtimeMs: number | null },
  baseline: DriveSyncBaselineEntryV1,
): boolean {
  if (local.kind !== baseline.kind) return true
  if (local.kind === "folder") return false
  if (baseline.localHash && local.hash) return baseline.localHash !== local.hash
  return baseline.localSize !== local.size || baseline.localMtimeMs !== local.mtimeMs
}

function inspectDriveSyncLocalPathSync(
  targetPath: string,
): { readonly kind: "missing" | "file" | "folder" | "other" } {
  try {
    const stats = lstatSync(targetPath)
    if (stats.isFile()) return { kind: "file" }
    if (stats.isDirectory()) return { kind: "folder" }
    return { kind: "other" }
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return { kind: "missing" }
    }
    throw error
  }
}

function localChange(
  bindingId: string,
  relativePath: string,
  kind: DriveSyncLocalChangeKind,
  localPath: string,
  localKind: DriveSyncLocalChange["localKind"],
): DriveSyncLocalChange {
  return { bindingId, relativePath, kind, localPath, localKind }
}

function compareChanges(left: DriveSyncLocalChange, right: DriveSyncLocalChange): number {
  return left.relativePath.localeCompare(right.relativePath)
}

function selfWriteKey(bindingId: string, relativePath: string): string {
  return `${bindingId}:${relativePath}`
}

function defaultWatch(
  rootPath: string,
  options: { readonly persistent: false; readonly recursive: boolean },
  listener: (eventType: string, filename: string | Buffer | null) => void,
): Pick<FSWatcher, "close" | "on"> {
  return nodeWatch(rootPath, options, listener)
}
