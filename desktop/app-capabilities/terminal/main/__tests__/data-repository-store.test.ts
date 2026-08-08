import { randomUUID } from "node:crypto"
import { mkdtempSync, readFileSync, readdirSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"

import { createFileBackedDataRepository } from "../../../../electron/runtime/data-repo"
import { createTerminalDataRepositoryStore } from "../data-repository-store"
import { createTerminalEncryptedBlockStore } from "../encrypted-block-store"
import { createTerminalRepository } from "../repository"

describe("Terminal DataRepository store", () => {
  it("round-trips structural data while encrypting command and output bodies", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "synapse-terminal-data-repo-"))
    const groupId = randomUUID()
    const commandId = randomUUID()
    const sessionId = randomUUID()
    const safeStorage = reversibleSafeStorage()
    const repository = createTerminalRepository(createFileBackedDataRepository({
      rootDir: path.join(root, "data-v1"),
      safeStorage,
    }))
    const store = createTerminalDataRepositoryStore({
      repository,
      blocks: createTerminalEncryptedBlockStore({ baseDir: path.join(root, "terminal"), safeStorage }),
    })
    await store.saveState({
      globalLaunch: {
        revision: 2,
        updatedAt: timestamp(),
        settings: { shell: "/bin/zsh", environment: { GLOBAL_SECRET: "global-private", GLOBAL_UNSET: null } },
      },
      terminalDomainRevision: 3,
      groups: [{
        id: groupId, name: "Main", createdAt: timestamp(), updatedAt: timestamp(), sortOrder: 0,
        groupRevision: 1, launchRevision: 1, membershipRevision: 1, commandCollectionRevision: 1,
        settings: {
          environment: { GROUP_SECRET: "group-private", GROUP_UNSET: null },
          commands: [{
            id: commandId,
            name: "secret",
            command: "printf private",
            createdAt: timestamp(),
            updatedAt: timestamp(),
            commandRevision: 1,
            launch: { defaultCwd: "/tmp", environment: { COMMAND_SECRET: "command-private", COMMAND_UNSET: null } },
          }],
        },
      }],
      sessions: [{
        id: sessionId, groupId, title: "Shell", cwd: "/tmp", shell: "/bin/sh", status: "ended",
        exitCode: 0, createdAt: timestamp(), updatedAt: timestamp(), startedAt: timestamp(), endedAt: timestamp(),
        cols: 80, rows: 24, lastOutputSeq: 1, metadataRevision: 1, stateRevision: 2,
        inputRevision: 0, sizeRevision: 1, creationSource: "ui", endCause: "process_exit",
        endTimeUnknown: false, inputHistoryBeforeBaselineUnknown: false, launchRevisionApplied: 1,
        discardedOutputBytes: 0, discardedOutputChunks: 0,
        attention: { state: "unknown", kind: "unknown", reason: "not_running", confidence: 0, detectedAt: timestamp(), throughOutputSeq: 1, sizeRevision: 1, detectorId: "passive-terminal-v1", detectorVersion: "1.0.0" },
      }],
      output: [{ sessionId, seq: 1, data: "private-output", createdAt: timestamp(), source: "pty" }],
      operations: [],
      idempotency: [],
      checkpoints: [{
        sessionId,
        throughOutputSeq: 1,
        sizeRevision: 1,
        emulatorId: "xterm-headless",
        emulatorVersion: "6.0.0",
        serialized: "private-checkpoint",
      }],
    })
    const loaded = await store.loadState()
    expect(loaded.terminalDomainRevision).toBe(3)
    expect(loaded.globalLaunch).toMatchObject({
      revision: 2,
      settings: { environment: { GLOBAL_SECRET: "global-private", GLOBAL_UNSET: null } },
    })
    expect(loaded.groups[0]?.settings?.environment).toEqual({ GROUP_SECRET: "group-private", GROUP_UNSET: null })
    expect(loaded.groups[0]?.settings?.commands?.[0]?.command).toBe("printf private")
    expect(loaded.groups[0]?.settings?.commands?.[0]?.launch).toEqual({
      defaultCwd: "/tmp",
      environment: { COMMAND_SECRET: "command-private", COMMAND_UNSET: null },
    })
    expect(loaded.output[0]?.data).toBe("private-output")
    expect(loaded.checkpoints[0]?.serialized).toBe("private-checkpoint")
    const persisted = readAllFiles(root).join("\n")
    expect(persisted).not.toContain("printf private")
    expect(persisted).not.toContain("private-output")
    expect(persisted).not.toContain("private-checkpoint")
    expect(persisted).not.toContain("global-private")
    expect(persisted).not.toContain("group-private")
    expect(persisted).not.toContain("command-private")
  })

  it("rejects sensitive configuration before writing when safe storage is unavailable", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "synapse-terminal-unprotected-"))
    const safeStorage = unavailableSafeStorage()
    const repository = createTerminalRepository(createFileBackedDataRepository({ rootDir: path.join(root, "data-v1"), safeStorage }))
    const store = createTerminalDataRepositoryStore({ repository, blocks: createTerminalEncryptedBlockStore({ baseDir: path.join(root, "terminal"), safeStorage }) })
    const groupId = randomUUID()
    await expect(store.saveState({
      terminalDomainRevision: 1,
      groups: [{
        id: groupId, name: "Main", createdAt: timestamp(), updatedAt: timestamp(), sortOrder: 0,
        groupRevision: 1, launchRevision: 1, membershipRevision: 1, commandCollectionRevision: 1,
        settings: { environment: { PRIVATE_VALUE: "secret" } },
      }],
      sessions: [], output: [], operations: [], idempotency: [], checkpoints: [],
    })).rejects.toThrow("persistence protection unavailable")
    expect((await repository.groups.list()).length).toBe(0)
  })

  it("finishes a persisted delete intent before exposing a recovered snapshot", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "synapse-terminal-delete-recovery-"))
    const safeStorage = reversibleSafeStorage()
    const repository = createTerminalRepository(createFileBackedDataRepository({ rootDir: path.join(root, "data-v1"), safeStorage }))
    const blocks = createTerminalEncryptedBlockStore({ baseDir: path.join(root, "terminal"), safeStorage })
    const groupId = randomUUID()
    await repository.groups.upsert({
      schemaVersion: 2, id: groupId, groupId, name: "Delete me", createdAt: timestamp(), updatedAt: timestamp(),
      sortOrder: 0, groupRevision: 1, launchRevision: 1, membershipRevision: 1, commandCollectionRevision: 1,
      environmentKeys: [],
    })
    await repository.deleteIntents.upsert({
      schemaVersion: 1, id: randomUUID(), groupIds: [groupId], commandIds: [], sessionIds: [], blockIds: [], createdAt: timestamp(),
    })
    const store = createTerminalDataRepositoryStore({ repository, blocks })
    const recovered = await store.loadState()
    expect(recovered.groups).toEqual([])
    expect(await repository.groups.list()).toEqual([])
    expect(await repository.deleteIntents.list()).toEqual([])
  })
})

function reversibleSafeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value, "utf8").reverse(),
    decryptString: (value: Buffer) => Buffer.from(value).reverse().toString("utf8"),
  }
}

function unavailableSafeStorage() {
  return {
    isEncryptionAvailable: () => false,
    encryptString: () => { throw new Error("unavailable") },
    decryptString: () => { throw new Error("unavailable") },
  }
}

function timestamp(): string {
  return "2026-07-22T00:00:00.000Z"
}

function readAllFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(root, entry.name)
    return entry.isDirectory() ? readAllFiles(target) : [readFileSync(target).toString("utf8")]
  })
}
