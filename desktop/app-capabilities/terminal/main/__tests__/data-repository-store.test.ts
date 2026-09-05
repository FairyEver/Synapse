import { randomUUID } from "node:crypto"
import { mkdtempSync, readFileSync, readdirSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"

import { createFileBackedDataRepository } from "../../../../electron/runtime/data-repo"
import { createTerminalDataRepositoryStore } from "../data-repository-store"
import { createTerminalEncryptedBlockStore } from "../encrypted-block-store"
import { createTerminalRepository } from "../repository"

describe("Terminal DataRepository store", () => {
  it("round-trips structural data while encrypting command and output bodies", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "synapse-terminal-data-repo-"))
    const groupId = randomUUID()
    const commandId = randomUUID()
    const toolbarActionId = randomUUID()
    const sessionId = randomUUID()
    const workspaceId = randomUUID()
    const paneId = randomUUID()
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
      toolbarActions: [{
        id: toolbarActionId,
        label: "Private deploy",
        content: "deploy --token private-toolbar-token",
        pressEnter: true,
        createdAt: timestamp(),
        updatedAt: timestamp(),
        actionRevision: 1,
      }],
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
      workspaces: [{
        id: workspaceId,
        groupId,
        title: "Shell workspace",
        layout: { type: "leaf", paneId, sessionId },
        layoutRevision: 1,
        closingPaneIds: [],
        closing: false,
        createdAt: timestamp(),
        updatedAt: timestamp(),
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
    expect(loaded.toolbarActions).toEqual([expect.objectContaining({
      id: toolbarActionId,
      label: "Private deploy",
      content: "deploy --token private-toolbar-token",
      pressEnter: true,
    })])
    expect(loaded.groups[0]?.settings?.environment).toEqual({ GROUP_SECRET: "group-private", GROUP_UNSET: null })
    expect(loaded.groups[0]?.settings?.commands?.[0]?.command).toBe("printf private")
    expect(loaded.groups[0]?.settings?.commands?.[0]?.launch).toEqual({
      defaultCwd: "/tmp",
      environment: { COMMAND_SECRET: "command-private", COMMAND_UNSET: null },
    })
    expect(loaded.workspaces).toEqual([expect.objectContaining({
      id: workspaceId,
      layout: { type: "leaf", paneId, sessionId },
    })])
    expect(loaded.output[0]?.data).toBe("private-output")
    expect(loaded.checkpoints[0]?.serialized).toBe("private-checkpoint")
    const persisted = readAllFiles(root).join("\n")
    expect(persisted).not.toContain("printf private")
    expect(persisted).not.toContain("private-output")
    expect(persisted).not.toContain("private-checkpoint")
    expect(persisted).not.toContain("global-private")
    expect(persisted).not.toContain("group-private")
    expect(persisted).not.toContain("command-private")
    expect(persisted).not.toContain("Private deploy")
    expect(persisted).not.toContain("private-toolbar-token")
  })

  it("rejects sensitive configuration before writing when safe storage is unavailable", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "synapse-terminal-unprotected-"))
    const safeStorage = unavailableSafeStorage()
    const repository = createTerminalRepository(createFileBackedDataRepository({ rootDir: path.join(root, "data-v1"), safeStorage }))
    const store = createTerminalDataRepositoryStore({ repository, blocks: createTerminalEncryptedBlockStore({ baseDir: path.join(root, "terminal"), safeStorage }) })
    const groupId = randomUUID()
    await expect(store.saveState({
      terminalDomainRevision: 1,
      toolbarActions: [{
        id: randomUUID(),
        label: "Secret action",
        content: "echo secret",
        pressEnter: true,
        createdAt: timestamp(),
        updatedAt: timestamp(),
        actionRevision: 1,
      }],
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

  it("persists runtime output incrementally without rescanning block manifests", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "synapse-terminal-runtime-save-"))
    const safeStorage = reversibleSafeStorage()
    const repository = createTerminalRepository(createFileBackedDataRepository({ rootDir: path.join(root, "data-v1"), safeStorage }))
    const store = createTerminalDataRepositoryStore({
      repository,
      blocks: createTerminalEncryptedBlockStore({ baseDir: path.join(root, "terminal"), safeStorage }),
    })
    const groupId = randomUUID()
    const sessionId = randomUUID()
    const session = terminalSession(groupId, sessionId)
    await store.saveState({
      terminalDomainRevision: 1,
      groups: [{
        id: groupId, name: "Main", createdAt: timestamp(), updatedAt: timestamp(), sortOrder: 0,
        groupRevision: 1, launchRevision: 1, membershipRevision: 1, commandCollectionRevision: 1,
      }],
      sessions: [{ ...session, lastOutputSeq: 1 }],
      output: [{ sessionId, seq: 1, data: "one", createdAt: timestamp(), source: "pty" }],
      operations: [], idempotency: [], checkpoints: [],
    })
    await store.loadState()
    const listBlocks = vi.spyOn(repository.blocks, "list")

    await store.saveRuntimeState!({
      sessions: [{
        session: { ...session, lastOutputSeq: 2, stateRevision: 3 },
        output: [{ sessionId, seq: 2, data: "two", createdAt: timestamp(), source: "pty" }],
        firstRetainedOutputSeq: 1,
      }],
    })

    expect(listBlocks).not.toHaveBeenCalled()
    const loaded = await store.loadState()
    expect(loaded.output.map((chunk) => [chunk.seq, chunk.data])).toEqual([[1, "one"], [2, "two"]])
    expect(loaded.sessions[0]).toMatchObject({ id: sessionId, lastOutputSeq: 2, stateRevision: 3 })
  })

  it("packs small runtime chunks into bounded blocks and filters an evicted block prefix", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "synapse-terminal-output-batches-"))
    const safeStorage = reversibleSafeStorage()
    const repository = createTerminalRepository(createFileBackedDataRepository({ rootDir: path.join(root, "data-v1"), safeStorage }))
    const store = createTerminalDataRepositoryStore({
      repository,
      blocks: createTerminalEncryptedBlockStore({ baseDir: path.join(root, "terminal"), safeStorage }),
    })
    const groupId = randomUUID()
    const sessionId = randomUUID()
    const session = terminalSession(groupId, sessionId)
    await store.saveState({
      terminalDomainRevision: 1,
      groups: [{
        id: groupId, name: "Main", createdAt: timestamp(), updatedAt: timestamp(), sortOrder: 0,
        groupRevision: 1, launchRevision: 1, membershipRevision: 1, commandCollectionRevision: 1,
      }],
      sessions: [session], output: [], operations: [], idempotency: [], checkpoints: [],
    })
    const output = Array.from({ length: 100 }, (_, index) => ({
      sessionId,
      seq: index + 1,
      data: `line-${index}\n`,
      createdAt: timestamp(),
      source: "pty" as const,
    }))

    await store.saveRuntimeState!({
      sessions: [{
        session: { ...session, lastOutputSeq: 100, stateRevision: 101 },
        output,
        firstRetainedOutputSeq: 1,
      }],
    })

    expect((await repository.blocks.list()).filter((block) => block.type === "output")).toHaveLength(1)
    expect((await store.loadState()).output.map((chunk) => chunk.seq)).toEqual(output.map((chunk) => chunk.seq))

    await store.saveRuntimeState!({
      sessions: [{
        session: { ...session, lastOutputSeq: 100, stateRevision: 102, discardedOutputChunks: 49 },
        output: [],
        firstRetainedOutputSeq: 50,
      }],
    })
    expect((await store.loadState()).output.map((chunk) => chunk.seq)).toEqual(
      Array.from({ length: 51 }, (_, index) => index + 50),
    )

    await store.saveRuntimeState!({
      sessions: [{
        session: { ...session, lastOutputSeq: 100, stateRevision: 103, discardedOutputChunks: 100 },
        output: [],
        firstRetainedOutputSeq: 101,
      }],
    })
    expect((await repository.blocks.list()).filter((block) => block.type === "output")).toHaveLength(0)
  })

  it("writes only records changed by a structural workspace save", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "synapse-terminal-delta-save-"))
    const safeStorage = reversibleSafeStorage()
    const repository = createTerminalRepository(createFileBackedDataRepository({ rootDir: path.join(root, "data-v1"), safeStorage }))
    const store = createTerminalDataRepositoryStore({
      repository,
      blocks: createTerminalEncryptedBlockStore({ baseDir: path.join(root, "terminal"), safeStorage }),
    })
    const groupId = randomUUID()
    const sessionId = randomUUID()
    const workspaceId = randomUUID()
    const paneId = randomUUID()
    const operationId = randomUUID()
    const commandId = randomUUID()
    const state: Parameters<typeof store.saveState>[0] = {
      globalLaunch: { revision: 1, updatedAt: timestamp() },
      terminalDomainRevision: 1,
      groups: [{
        id: groupId, name: "Main", createdAt: timestamp(), updatedAt: timestamp(), sortOrder: 0,
        groupRevision: 1, launchRevision: 1, membershipRevision: 1, commandCollectionRevision: 1,
        settings: {
          environment: { GROUP_SECRET: "group-private" },
          commands: [{
            id: commandId,
            name: "Build",
            command: "pnpm build",
            createdAt: timestamp(),
            updatedAt: timestamp(),
            commandRevision: 1,
          }],
        },
      }],
      workspaces: [{
        id: workspaceId,
        groupId,
        title: "Shell workspace",
        layout: { type: "leaf", paneId, sessionId },
        layoutRevision: 1,
        closingPaneIds: [],
        closing: false,
        createdAt: timestamp(),
        updatedAt: timestamp(),
      }],
      sessions: [{ ...terminalSession(groupId, sessionId), launchEnvironment: { SESSION_SECRET: "session-private" } }],
      output: [],
      operations: [{
        schemaVersion: 2,
        id: operationId,
        operationId,
        kind: "stop",
        resourceType: "session",
        resourceId: sessionId,
        status: "completed",
        createdAt: timestamp(),
        updatedAt: timestamp(),
        requestedBy: "user",
      }],
      idempotency: [],
      checkpoints: [],
    }
    await store.saveState(state)
    const globalLaunchUpsert = vi.spyOn(repository.globalLaunch, "setSingleton")
    const groupUpsert = vi.spyOn(repository.groups, "upsert")
    const groupLaunchUpsert = vi.spyOn(repository.groupLaunchBodies, "upsert")
    const groupLaunchRemove = vi.spyOn(repository.groupLaunchBodies, "remove")
    const commandUpsert = vi.spyOn(repository.commands, "upsert")
    const commandBodyUpsert = vi.spyOn(repository.commandBodies, "upsert")
    const sessionUpsert = vi.spyOn(repository.sessions, "upsert")
    const launchBodyUpsert = vi.spyOn(repository.launchBodies, "upsert")
    const launchBodyRemove = vi.spyOn(repository.launchBodies, "remove")
    const operationUpsert = vi.spyOn(repository.operations, "upsert")
    const workspaceUpsert = vi.spyOn(repository.workspaces, "upsert")

    await store.saveState({
      ...state,
      terminalDomainRevision: 2,
      workspaces: [{
        ...state.workspaces![0]!,
        title: "Renamed workspace",
        layoutRevision: 2,
      }],
    })

    expect(globalLaunchUpsert).not.toHaveBeenCalled()
    expect(groupUpsert).not.toHaveBeenCalled()
    expect(groupLaunchUpsert).not.toHaveBeenCalled()
    expect(groupLaunchRemove).not.toHaveBeenCalled()
    expect(commandUpsert).not.toHaveBeenCalled()
    expect(commandBodyUpsert).not.toHaveBeenCalled()
    expect(sessionUpsert).not.toHaveBeenCalled()
    expect(launchBodyUpsert).not.toHaveBeenCalled()
    expect(launchBodyRemove).not.toHaveBeenCalled()
    expect(operationUpsert).not.toHaveBeenCalled()
    expect(workspaceUpsert).toHaveBeenCalledTimes(1)
  })
})

function terminalSession(groupId: string, sessionId: string) {
  return {
    id: sessionId, groupId, title: "Shell", cwd: "/tmp", shell: "/bin/sh", status: "running" as const,
    createdAt: timestamp(), updatedAt: timestamp(), startedAt: timestamp(), cols: 80, rows: 24,
    lastOutputSeq: 0, metadataRevision: 1, stateRevision: 2, inputRevision: 0, sizeRevision: 1,
    creationSource: "ui" as const, endTimeUnknown: false, inputHistoryBeforeBaselineUnknown: false,
    launchRevisionApplied: 1, discardedOutputBytes: 0, discardedOutputChunks: 0,
    attention: {
      state: "unknown" as const, kind: "unknown" as const, reason: "output_changed" as const,
      confidence: 0, detectedAt: timestamp(), throughOutputSeq: 0, sizeRevision: 1,
      detectorId: "passive-terminal-v1" as const, detectorVersion: "1.0.0" as const,
    },
  }
}

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
