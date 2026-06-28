import { EventEmitter } from "node:events"
import { mkdtemp, rm, unlink, writeFile } from "node:fs/promises"
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
})

function createFakeWatch() {
  const listeners = new Map<string, (eventType: string, filename: string | Buffer | null) => void>()
  const watch: DriveSyncWatchFactory = (rootPath, _options, listener) => {
    listeners.set(rootPath, listener)
    const watcher = new EventEmitter() as unknown as ReturnType<DriveSyncWatchFactory> & { close: () => void }
    watcher.close = vi.fn()
    return watcher
  }
  return {
    watch,
    emit(rootPath: string, eventType: string, filename: string) {
      listeners.get(rootPath)?.(eventType, filename)
    },
  }
}

function binding(input: { readonly localPath: string }): DriveSyncBindingEntryV1 {
  return {
    id: "binding-1",
    schemaVersion: 1,
    driveItemId: "drive-item-1",
    driveItemName: "Folder",
    kind: "folder",
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
    localSize: null,
    localMtimeMs: null,
    localHash: input.localHash,
    lastSyncedAt: "2026-06-28T00:00:00.000Z",
    deletedAt: null,
  }
}
