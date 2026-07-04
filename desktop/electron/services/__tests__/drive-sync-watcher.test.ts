import { EventEmitter } from "node:events"
import { lstat, mkdtemp, rm, unlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { DriveSyncBaselineEntryV1, DriveSyncBindingEntryV1 } from "../../runtime/data-repo"
import { createDriveSyncWatcher, type DriveSyncLocalChange, type DriveSyncWatchFactory } from "../drive-sync-watcher"
import { createDefaultDriveSyncExcludeRules } from "../drive-sync-excludes"

describe("drive sync watcher", () => {
  let tempDir: string

  beforeEach(async () => {
    vi.useFakeTimers()
    tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-sync-watcher-"))
  })

  afterEach(async () => {
    vi.useRealTimers()
    await rm(tempDir, { recursive: true, force: true })
  })

  it("debounces local file changes and ignores excluded paths", async () => {
    const changes: Array<readonly DriveSyncLocalChange[]> = []
    const fakeWatch = createFakeWatch()
    const watcher = createDriveSyncWatcher({
      debounceMs: 10,
      watch: fakeWatch.watch,
      onChanges: (batch) => { changes.push(batch) },
    })
    watcher.reconcile([binding({ localPath: tempDir })])

    await writeFile(path.join(tempDir, "notes.md"), "hello", "utf8")
    fakeWatch.emit(tempDir, "rename", "notes.md")
    await writeFile(path.join(tempDir, ".git", "config"), "ignored", "utf8").catch(async () => {
      await import("node:fs/promises").then(({ mkdir }) => mkdir(path.join(tempDir, ".git"), { recursive: true }))
      await writeFile(path.join(tempDir, ".git", "config"), "ignored", "utf8")
    })
    fakeWatch.emit(tempDir, "rename", ".git/config")

    await vi.advanceTimersByTimeAsync(9)
    expect(changes).toEqual([])
    await vi.advanceTimersByTimeAsync(1)

    expect(changes).toEqual([[
      expect.objectContaining({
        bindingId: "binding-1",
        relativePath: "notes.md",
        kind: "created",
        localKind: "file",
      }),
    ]])
  })

  it("ignores paths marked as self writes once", async () => {
    const changes: Array<readonly DriveSyncLocalChange[]> = []
    const fakeWatch = createFakeWatch()
    const watcher = createDriveSyncWatcher({
      debounceMs: 1,
      watch: fakeWatch.watch,
      onChanges: (batch) => { changes.push(batch) },
    })
    watcher.reconcile([binding({ localPath: tempDir })])
    watcher.markSelfWrite({ bindingId: "binding-1", relativePath: "remote.md" })

    await writeFile(path.join(tempDir, "remote.md"), "downloaded", "utf8")
    fakeWatch.emit(tempDir, "change", "remote.md")
    await vi.advanceTimersByTimeAsync(1)

    expect(changes).toEqual([])
  })

  it("scans local changes missed while the app was not running", async () => {
    await writeFile(path.join(tempDir, "new.md"), "new", "utf8")
    await writeFile(path.join(tempDir, "changed.md"), "after", "utf8")
    const watcher = createDriveSyncWatcher({ onChanges: () => undefined })

    const changes = await watcher.scanBinding({
      binding: binding({ localPath: tempDir }),
      baseline: [
        baseline({ relativePath: "old.md", localHash: "sha256:old" }),
        baseline({ relativePath: "changed.md", localHash: "sha256:before" }),
      ],
    })

    expect(changes).toEqual([
      expect.objectContaining({ relativePath: "changed.md", kind: "modified" }),
      expect.objectContaining({ relativePath: "new.md", kind: "created" }),
      expect.objectContaining({ relativePath: "old.md", kind: "deleted" }),
    ])
  })

  it("reuses baseline hashes for unchanged files during folder scans", async () => {
    const filePath = path.join(tempDir, "unchanged.md")
    await writeFile(filePath, "unchanged", "utf8")
    const stats = await lstat(filePath)
    const watcher = createDriveSyncWatcher({ onChanges: () => undefined })

    const changes = await watcher.scanBinding({
      binding: binding({ localPath: tempDir }),
      baseline: [
        baseline({
          relativePath: "unchanged.md",
          localHash: "sha256:cached",
          localSize: stats.size,
          localMtimeMs: stats.mtimeMs,
        }),
      ],
    })

    expect(changes).toEqual([])
  })

  it("detects delete events", async () => {
    const changes: Array<readonly DriveSyncLocalChange[]> = []
    const fakeWatch = createFakeWatch()
    const filePath = path.join(tempDir, "gone.md")
    await writeFile(filePath, "bye", "utf8")
    const watcher = createDriveSyncWatcher({
      debounceMs: 1,
      watch: fakeWatch.watch,
      onChanges: (batch) => { changes.push(batch) },
    })
    watcher.reconcile([binding({ localPath: tempDir })])

    await unlink(filePath)
    fakeWatch.emit(tempDir, "rename", "gone.md")
    await vi.runAllTimersAsync()

    expect(changes).toEqual([[
      expect.objectContaining({ relativePath: "gone.md", kind: "deleted", localKind: "missing" }),
    ]])
  })

  it("ignores folder watcher events without a filename", async () => {
    const changes: Array<readonly DriveSyncLocalChange[]> = []
    const fakeWatch = createFakeWatch()
    const watcher = createDriveSyncWatcher({
      debounceMs: 1,
      watch: fakeWatch.watch,
      onChanges: (batch) => { changes.push(batch) },
    })
    watcher.reconcile([binding({ localPath: tempDir })])

    fakeWatch.emit(tempDir, "change", null)
    await vi.runAllTimersAsync()

    expect(changes).toEqual([])
  })

  it("ignores single-file watcher events without a filename", async () => {
    const changes: Array<readonly DriveSyncLocalChange[]> = []
    const fakeWatch = createFakeWatch()
    const filePath = path.join(tempDir, "tracked.md")
    await writeFile(filePath, "tracked", "utf8")
    const watcher = createDriveSyncWatcher({
      debounceMs: 1,
      watch: fakeWatch.watch,
      onChanges: (batch) => { changes.push(batch) },
    })
    watcher.reconcile([binding({ localPath: filePath, kind: "file" })])

    fakeWatch.emit(tempDir, "change", null)
    await vi.runAllTimersAsync()

    expect(changes).toEqual([])
  })

  it("maps single-file watcher events for the tracked filename to the binding root", async () => {
    const changes: Array<readonly DriveSyncLocalChange[]> = []
    const fakeWatch = createFakeWatch()
    const filePath = path.join(tempDir, "tracked.md")
    await writeFile(filePath, "tracked", "utf8")
    const watcher = createDriveSyncWatcher({
      debounceMs: 1,
      watch: fakeWatch.watch,
      onChanges: (batch) => { changes.push(batch) },
    })
    watcher.reconcile([binding({ localPath: filePath, kind: "file" })])

    await writeFile(filePath, "changed", "utf8")
    fakeWatch.emit(tempDir, "change", "tracked.md")
    await vi.runAllTimersAsync()

    expect(changes).toEqual([[
      expect.objectContaining({
        bindingId: "binding-1",
        relativePath: "",
        kind: "modified",
        localKind: "file",
      }),
    ]])
  })

  it("requeues local changes when flush handling fails", async () => {
    const changes: Array<readonly DriveSyncLocalChange[]> = []
    const errors: unknown[] = []
    const fakeWatch = createFakeWatch()
    let attempts = 0
    const watcher = createDriveSyncWatcher({
      debounceMs: 1,
      watch: fakeWatch.watch,
      onChanges: (batch) => {
        changes.push(batch)
        attempts += 1
        if (attempts === 1) throw new Error("temporary failure")
      },
      onFlushError: (input) => { errors.push(input) },
    })
    watcher.reconcile([binding({ localPath: tempDir })])

    await writeFile(path.join(tempDir, "notes.md"), "hello", "utf8")
    fakeWatch.emit(tempDir, "rename", "notes.md")
    await vi.advanceTimersByTimeAsync(1)

    expect(changes).toHaveLength(1)
    expect(errors).toEqual([expect.objectContaining({
      bindingId: "binding-1",
      changes: [expect.objectContaining({ relativePath: "notes.md" })],
      error: expect.any(Error),
    })])

    await vi.advanceTimersByTimeAsync(1)
    expect(changes).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(1)

    expect(changes).toHaveLength(2)
    expect(changes[1]).toEqual([
      expect.objectContaining({ relativePath: "notes.md", kind: "created" }),
    ])
  })

  it("reports watcher startup failures without emitting root deletes", async () => {
    const changes: Array<readonly DriveSyncLocalChange[]> = []
    const errors: unknown[] = []
    const failingWatch: DriveSyncWatchFactory = () => {
      throw new Error("watch unavailable")
    }
    const watcher = createDriveSyncWatcher({
      debounceMs: 1,
      watch: failingWatch,
      onChanges: (batch) => { changes.push(batch) },
      onError: (input) => { errors.push(input) },
    })

    watcher.reconcile([binding({ localPath: tempDir })])
    await vi.runAllTimersAsync()

    expect(changes).toEqual([])
    expect(errors).toEqual([expect.objectContaining({
      bindingId: "binding-1",
      localPath: tempDir,
      error: expect.any(Error),
    })])
  })

  it("reports watcher error events without emitting root deletes", async () => {
    const changes: Array<readonly DriveSyncLocalChange[]> = []
    const errors: unknown[] = []
    const fakeWatch = createFakeWatch()
    const watcher = createDriveSyncWatcher({
      debounceMs: 1,
      watch: fakeWatch.watch,
      onChanges: (batch) => { changes.push(batch) },
      onError: (input) => { errors.push(input) },
    })

    watcher.reconcile([binding({ localPath: tempDir })])
    fakeWatch.emitError(tempDir, new Error("watcher crashed"))
    await vi.runAllTimersAsync()

    expect(changes).toEqual([])
    expect(errors).toEqual([expect.objectContaining({
      bindingId: "binding-1",
      localPath: tempDir,
      error: expect.any(Error),
    })])
  })
})

function createFakeWatch() {
  const listeners = new Map<string, (eventType: string, filename: string | Buffer | null) => void>()
  const watchers = new Map<string, EventEmitter>()
  const watch: DriveSyncWatchFactory = (rootPath, _options, listener) => {
    listeners.set(rootPath, listener)
    const watcher = new EventEmitter() as unknown as ReturnType<DriveSyncWatchFactory> & { close: () => void }
    watcher.close = vi.fn()
    watchers.set(rootPath, watcher as unknown as EventEmitter)
    return watcher
  }
  return {
    watch,
    emit(rootPath: string, eventType: string, filename: string | Buffer | null) {
      listeners.get(rootPath)?.(eventType, filename)
    },
    emitError(rootPath: string, error: Error) {
      watchers.get(rootPath)?.emit("error", error)
    },
  }
}

function binding(input: { readonly localPath: string; readonly kind?: "file" | "folder" }): DriveSyncBindingEntryV1 {
  return {
    id: "binding-1",
    schemaVersion: 1,
    driveItemId: "drive-item-1",
    driveItemName: "Folder",
    kind: input.kind ?? "folder",
    drivePathHint: "/Folder",
    localPath: input.localPath,
    status: "active",
    remoteCursor: null,
    lastSyncedAt: null,
    lastError: null,
    excludeRules: createDefaultDriveSyncExcludeRules(),
    createdAt: "2026-06-28T00:00:00.000Z",
    updatedAt: "2026-06-28T00:00:00.000Z",
  }
}

function baseline(input: {
  readonly relativePath: string
  readonly localHash: string | null
  readonly localSize?: number | null
  readonly localMtimeMs?: number | null
}): DriveSyncBaselineEntryV1 {
  return {
    id: `binding-1:${input.relativePath}`,
    schemaVersion: 1,
    bindingId: "binding-1",
    relativePath: input.relativePath,
    kind: "file",
    remoteItemId: `remote:${input.relativePath}`,
    remoteVersionId: null,
    remoteEtag: null,
    localSize: input.localSize ?? null,
    localMtimeMs: input.localMtimeMs ?? null,
    localHash: input.localHash,
    lastSyncedAt: "2026-06-28T00:00:00.000Z",
    deletedAt: null,
  }
}
