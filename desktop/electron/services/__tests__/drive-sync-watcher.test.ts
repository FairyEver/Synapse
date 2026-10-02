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

  it("requests a folder rescan when a watcher event has no filename", async () => {
    const changes: Array<readonly DriveSyncLocalChange[]> = []
    const onRescanRequested = vi.fn()
    const fakeWatch = createFakeWatch()
    const watcher = createDriveSyncWatcher({
      debounceMs: 1,
      watch: fakeWatch.watch,
      onChanges: (batch) => { changes.push(batch) },
      onRescanRequested,
    })
    watcher.reconcile([binding({ localPath: tempDir })])

    fakeWatch.emit(tempDir, "change", null)
    await vi.runAllTimersAsync()

    expect(changes).toEqual([])
    expect(onRescanRequested).toHaveBeenCalledWith("binding-1")
  })

  it("requests a single-file rescan when a watcher event has no filename", async () => {
    const changes: Array<readonly DriveSyncLocalChange[]> = []
    const onRescanRequested = vi.fn()
    const fakeWatch = createFakeWatch()
    const filePath = path.join(tempDir, "tracked.md")
    await writeFile(filePath, "tracked", "utf8")
    const watcher = createDriveSyncWatcher({
      debounceMs: 1,
      watch: fakeWatch.watch,
      onChanges: (batch) => { changes.push(batch) },
      onRescanRequested,
    })
    watcher.reconcile([binding({ localPath: filePath, kind: "file" })])

    fakeWatch.emit(tempDir, "change", null)
    await vi.runAllTimersAsync()

    expect(changes).toEqual([])
    expect(onRescanRequested).toHaveBeenCalledWith("binding-1")
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

  it("drops pending local changes when a binding stops", async () => {
    const changes: Array<readonly DriveSyncLocalChange[]> = []
    const fakeWatch = createFakeWatch()
    const watcher = createDriveSyncWatcher({
      debounceMs: 10,
      watch: fakeWatch.watch,
      onChanges: (batch) => { changes.push(batch) },
    })
    watcher.reconcile([binding({ localPath: tempDir })])

    await writeFile(path.join(tempDir, "queued.md"), "queued", "utf8")
    fakeWatch.emit(tempDir, "rename", "queued.md")
    watcher.reconcile([])
    await vi.runAllTimersAsync()

    expect(changes).toEqual([])
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

  it("reports path inspection errors and keeps processing later events without emitting deletes", async () => {
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
    await writeFile(path.join(tempDir, "not-a-directory"), "file", "utf8")

    expect(() => fakeWatch.emit(tempDir, "rename", "not-a-directory/child.md")).not.toThrow()
    await vi.runAllTimersAsync()
    expect(changes).toEqual([])
    expect(errors).toEqual([expect.objectContaining({
      bindingId: "binding-1",
      localPath: tempDir,
      error: expect.objectContaining({ code: "ENOTDIR" }),
    })])

    await writeFile(path.join(tempDir, "notes.md"), "hello", "utf8")
    fakeWatch.emit(tempDir, "change", "notes.md")
    await vi.runAllTimersAsync()
    expect(changes).toEqual([[
      expect.objectContaining({ relativePath: "notes.md", kind: "modified", localKind: "file" }),
    ]])
    watcher.stop()
  })

  it.each(["modified", "deleted"] as const)("keeps a newer %s event when an older batch fails", async (kind) => {
    const firstFlush = deferredFlush()
    const onChanges = vi.fn<(changes: readonly DriveSyncLocalChange[]) => Promise<void>>()
      .mockReturnValueOnce(firstFlush.promise)
      .mockResolvedValue(undefined)
    const fakeWatch = createFakeWatch()
    const watcher = createDriveSyncWatcher({ debounceMs: 1, watch: fakeWatch.watch, onChanges })
    watcher.reconcile([binding({ localPath: tempDir })])
    const filePath = path.join(tempDir, "notes.md")
    await writeFile(filePath, "first", "utf8")
    fakeWatch.emit(tempDir, "rename", "notes.md")
    await vi.advanceTimersByTimeAsync(1)

    if (kind === "deleted") await unlink(filePath)
    else await writeFile(filePath, "newer", "utf8")
    fakeWatch.emit(tempDir, kind === "deleted" ? "rename" : "change", "notes.md")
    firstFlush.reject(new Error("older batch failed"))
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(2)

    expect(onChanges).toHaveBeenCalledTimes(2)
    expect(onChanges.mock.calls[1]![0]).toEqual([
      expect.objectContaining({ relativePath: "notes.md", kind, localKind: kind === "deleted" ? "missing" : "file" }),
    ])
    watcher.stop()
  })

  it.each(["resolve", "reject"] as const)("serializes slow flushes and processes newer events after the first batch %ss", async (outcome) => {
    const firstFlush = deferredFlush()
    const onChanges = vi.fn<(changes: readonly DriveSyncLocalChange[]) => Promise<void>>()
      .mockReturnValueOnce(firstFlush.promise)
      .mockResolvedValue(undefined)
    const fakeWatch = createFakeWatch()
    const watcher = createDriveSyncWatcher({ debounceMs: 1, watch: fakeWatch.watch, onChanges })
    watcher.reconcile([binding({ localPath: tempDir })])
    await writeFile(path.join(tempDir, "notes.md"), "first", "utf8")
    fakeWatch.emit(tempDir, "rename", "notes.md")
    await vi.advanceTimersByTimeAsync(1)

    await writeFile(path.join(tempDir, "notes.md"), "newer", "utf8")
    fakeWatch.emit(tempDir, "change", "notes.md")
    await writeFile(path.join(tempDir, "another.md"), "new", "utf8")
    fakeWatch.emit(tempDir, "rename", "another.md")
    await vi.advanceTimersByTimeAsync(10)
    expect(onChanges).toHaveBeenCalledTimes(1)

    if (outcome === "resolve") firstFlush.resolve()
    else firstFlush.reject(new Error("older batch failed"))
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(outcome === "resolve" ? 1 : 2)
    expect(onChanges).toHaveBeenCalledTimes(2)
    expect(onChanges.mock.calls[1]![0]).toEqual([
      expect.objectContaining({ relativePath: "another.md", kind: "created" }),
      expect.objectContaining({ relativePath: "notes.md", kind: "modified" }),
    ])
    watcher.stop()
  })

  it.each(["resolve", "reject"] as const)("drops a stopped binding's in-flight batch when it %ss", async (outcome) => {
    const firstFlush = deferredFlush()
    const onChanges = vi.fn<(changes: readonly DriveSyncLocalChange[]) => Promise<void>>()
      .mockReturnValueOnce(firstFlush.promise)
      .mockResolvedValue(undefined)
    const onFlushError = vi.fn()
    const fakeWatch = createFakeWatch()
    const watcher = createDriveSyncWatcher({ debounceMs: 1, watch: fakeWatch.watch, onChanges, onFlushError })
    watcher.reconcile([binding({ localPath: tempDir })])
    await writeFile(path.join(tempDir, "notes.md"), "first", "utf8")
    fakeWatch.emit(tempDir, "rename", "notes.md")
    await vi.advanceTimersByTimeAsync(1)
    watcher.reconcile([])

    if (outcome === "resolve") firstFlush.resolve()
    else firstFlush.reject(new Error("stopped batch failed"))
    await vi.advanceTimersByTimeAsync(0)

    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(10)
    expect(onChanges).toHaveBeenCalledTimes(1)
    expect(onFlushError).not.toHaveBeenCalled()
  })

  it.each(["resolve", "reject"] as const)("preserves a rebuilt binding's retry when its previous flush %ss late", async (outcome) => {
    const previousFlush = deferredFlush()
    const onChanges = vi.fn<(changes: readonly DriveSyncLocalChange[]) => Promise<void>>()
      .mockReturnValueOnce(previousFlush.promise)
      .mockRejectedValueOnce(new Error("new binding batch failed"))
      .mockResolvedValue(undefined)
    const onFlushError = vi.fn()
    const fakeWatch = createFakeWatch()
    const watcher = createDriveSyncWatcher({ debounceMs: 1, watch: fakeWatch.watch, onChanges, onFlushError })
    const original = binding({ localPath: tempDir })
    watcher.reconcile([original])
    await writeFile(path.join(tempDir, "old.md"), "old", "utf8")
    fakeWatch.emit(tempDir, "rename", "old.md")
    await vi.advanceTimersByTimeAsync(1)

    watcher.reconcile([{ ...original, updatedAt: "2026-06-28T00:00:01.000Z" }])
    await writeFile(path.join(tempDir, "fresh.md"), "fresh", "utf8")
    fakeWatch.emit(tempDir, "rename", "fresh.md")
    await vi.advanceTimersByTimeAsync(1)
    expect(onChanges).toHaveBeenCalledTimes(2)

    if (outcome === "resolve") previousFlush.resolve()
    else previousFlush.reject(new Error("previous binding batch failed"))
    await vi.advanceTimersByTimeAsync(0)
    await writeFile(path.join(tempDir, "later.md"), "later", "utf8")
    fakeWatch.emit(tempDir, "rename", "later.md")

    await vi.advanceTimersByTimeAsync(1)
    expect(onChanges).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(onChanges).toHaveBeenCalledTimes(3)
    expect(onChanges.mock.calls[2]![0].map((change) => change.relativePath)).toEqual(["fresh.md", "later.md"])
    expect(onFlushError).toHaveBeenCalledTimes(1)
    watcher.stop()
  })

  it("does not schedule a retry after stopping while the async error hook is pending", async () => {
    const reporting = deferredFlush()
    const onChanges = vi.fn().mockRejectedValue(new Error("batch failed"))
    const onFlushError = vi.fn().mockReturnValue(reporting.promise)
    const fakeWatch = createFakeWatch()
    const watcher = createDriveSyncWatcher({ debounceMs: 1, watch: fakeWatch.watch, onChanges, onFlushError })
    watcher.reconcile([binding({ localPath: tempDir })])
    await writeFile(path.join(tempDir, "notes.md"), "first", "utf8")
    fakeWatch.emit(tempDir, "rename", "notes.md")
    await vi.advanceTimersByTimeAsync(1)
    expect(onFlushError).toHaveBeenCalledTimes(1)
    watcher.stop()

    reporting.resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(vi.getTimerCount()).toBe(0)
    expect(onChanges).toHaveBeenCalledTimes(1)
  })

  it("keeps newer events queued while the async flush error hook is pending", async () => {
    const reporting = deferredFlush()
    const onChanges = vi.fn<(changes: readonly DriveSyncLocalChange[]) => Promise<void>>()
      .mockRejectedValueOnce(new Error("first batch failed"))
      .mockResolvedValue(undefined)
    const onFlushError = vi.fn().mockReturnValue(reporting.promise)
    const fakeWatch = createFakeWatch()
    const watcher = createDriveSyncWatcher({ debounceMs: 1, watch: fakeWatch.watch, onChanges, onFlushError })
    watcher.reconcile([binding({ localPath: tempDir })])
    await writeFile(path.join(tempDir, "notes.md"), "first", "utf8")
    fakeWatch.emit(tempDir, "rename", "notes.md")
    await vi.advanceTimersByTimeAsync(1)
    expect(onFlushError).toHaveBeenCalledTimes(1)

    await writeFile(path.join(tempDir, "notes.md"), "newer", "utf8")
    fakeWatch.emit(tempDir, "change", "notes.md")
    await writeFile(path.join(tempDir, "another.md"), "new", "utf8")
    fakeWatch.emit(tempDir, "rename", "another.md")
    await vi.advanceTimersByTimeAsync(10)
    expect(onChanges).toHaveBeenCalledTimes(1)

    reporting.resolve()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(2)
    expect(onChanges).toHaveBeenCalledTimes(2)
    expect(onChanges.mock.calls[1]![0]).toEqual([
      expect.objectContaining({ relativePath: "another.md", kind: "created" }),
      expect.objectContaining({ relativePath: "notes.md", kind: "modified" }),
    ])
    watcher.stop()
  })

  it("preserves a rebuilt binding's backoff after the previous async error hook completes", async () => {
    const reporting = deferredFlush()
    const onChanges = vi.fn<(changes: readonly DriveSyncLocalChange[]) => Promise<void>>()
      .mockRejectedValueOnce(new Error("previous batch failed"))
      .mockRejectedValueOnce(new Error("new binding batch failed"))
      .mockResolvedValue(undefined)
    const onFlushError = vi.fn().mockReturnValueOnce(reporting.promise).mockResolvedValue(undefined)
    const fakeWatch = createFakeWatch()
    const watcher = createDriveSyncWatcher({ debounceMs: 1, watch: fakeWatch.watch, onChanges, onFlushError })
    const original = binding({ localPath: tempDir })
    watcher.reconcile([original])
    await writeFile(path.join(tempDir, "old.md"), "old", "utf8")
    fakeWatch.emit(tempDir, "rename", "old.md")
    await vi.advanceTimersByTimeAsync(1)

    watcher.reconcile([{ ...original, updatedAt: "2026-06-28T00:00:01.000Z" }])
    await writeFile(path.join(tempDir, "fresh.md"), "fresh", "utf8")
    fakeWatch.emit(tempDir, "rename", "fresh.md")
    await vi.advanceTimersByTimeAsync(1)
    expect(onChanges).toHaveBeenCalledTimes(2)
    expect(onFlushError).toHaveBeenCalledTimes(2)

    reporting.resolve()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(onChanges).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(onChanges).toHaveBeenCalledTimes(3)
    expect(onChanges.mock.calls[2]![0].map((change) => change.relativePath)).toEqual(["fresh.md"])
    watcher.stop()
  })
})

function deferredFlush() {
  let resolve!: () => void
  let reject!: (error: unknown) => void
  const promise = new Promise<void>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

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
