import { createHash, randomUUID } from "node:crypto"

import type { TerminalBlockManifestEntry, TerminalDeleteIntentEntry } from "../../../electron/runtime/data-repo/schemas"
import type {
  TerminalCommandRecord,
  TerminalGroupRecord,
  TerminalIdempotencyRecord,
  TerminalSessionRecord,
} from "../shared/contract-schema"
import { terminalOutputChunkSchema, type TerminalGroup, type TerminalGroupCommand, type TerminalSession } from "../shared/schema"
import type { TerminalEncryptedBlockStore } from "./encrypted-block-store"
import type { TerminalRepository } from "./repository"
import { terminalStoreStateSchema, type TerminalStore, type TerminalStoreState } from "./store"

type PersistenceLogger = {
  warn(message: string, meta?: Record<string, unknown>): void
}

export function createTerminalDataRepositoryStore(options: {
  readonly repository: TerminalRepository
  readonly blocks: TerminalEncryptedBlockStore
  readonly logger?: PersistenceLogger
}): TerminalStore {
  let initialized = false

  async function initialize(): Promise<void> {
    if (initialized) return
    await options.blocks.initialize()
    initialized = true
  }

  async function loadState(): Promise<TerminalStoreState> {
    await initialize()
    await recoverPendingDeletes()
    const snapshot = await options.repository.loadSnapshot()
    const retainedBlockIds = new Set(snapshot.blocks.map((item) => item.blockId))
    for (const blockId of await options.blocks.listBlockIds()) {
      if (!retainedBlockIds.has(blockId)) await options.blocks.deleteBlock(blockId)
    }
    const commandBodies = await safeList(options.repository.commandBodies, options.logger)
    const groupLaunchBodies = await safeList(options.repository.groupLaunchBodies, options.logger)
    const launchBodies = await safeList(options.repository.launchBodies, options.logger)
    const commandBodyById = new Map(commandBodies.map((item) => [item.commandId, item.body]))
    const groupEnvironmentById = new Map(groupLaunchBodies.map((item) => [item.groupId, item.environment]))
    const sessionEnvironmentById = new Map(launchBodies.map((item) => [item.sessionId, item.environment]))
    const commandsByGroup = new Map<string, TerminalGroupCommand[]>()
    for (const command of snapshot.commands) {
      const body = commandBodyById.get(command.commandId)
      if (body === undefined) continue
      const items = commandsByGroup.get(command.groupId) ?? []
      items.push({
        id: command.commandId,
        name: command.name,
        command: body,
        createdAt: command.createdAt,
        updatedAt: command.updatedAt,
        commandRevision: command.commandRevision,
      })
      commandsByGroup.set(command.groupId, items)
    }

    const groups: TerminalGroup[] = snapshot.groups.map((group) => {
      const commands = commandsByGroup.get(group.groupId) ?? []
      const environment = groupEnvironmentById.get(group.groupId)
      const settings = {
        ...(group.defaultCwd ? { defaultCwd: group.defaultCwd } : {}),
        ...(group.shell ? { shell: group.shell } : {}),
        ...(environment && Object.keys(environment).length ? { environment } : {}),
        ...(commands.length ? { commands } : {}),
      }
      return {
        id: group.groupId,
        name: group.name,
        createdAt: group.createdAt,
        updatedAt: group.updatedAt,
        sortOrder: group.sortOrder,
        groupRevision: group.groupRevision,
        launchRevision: group.launchRevision,
        membershipRevision: group.membershipRevision,
        commandCollectionRevision: group.commandCollectionRevision,
        ...(Object.keys(settings).length ? { settings } : {}),
      }
    })

    const output = []
    const checkpoints: TerminalStoreState["checkpoints"] = []
    for (const manifest of [...snapshot.blocks].sort((a, b) => a.firstOutputSeq - b.firstOutputSeq)) {
      try {
        const plaintext = await options.blocks.readBlock({
          blockId: manifest.blockId,
          sessionId: manifest.sessionId,
          type: manifest.type,
          expectedSha256: manifest.sha256,
        })
        const parsed = JSON.parse(plaintext.toString("utf8"))
        if (manifest.type === "output") output.push(terminalOutputChunkSchema.parse(parsed))
        else checkpoints.push(parseCheckpoint(parsed))
      } catch (error) {
        options.logger?.warn("Terminal output block is unavailable or corrupt.", {
          sessionId: manifest.sessionId,
          blockId: manifest.blockId,
          error,
        })
      }
    }

    const firstRetainedBySession = new Map<string, number>()
    for (const chunk of output) {
      const current = firstRetainedBySession.get(chunk.sessionId)
      if (current === undefined || chunk.seq < current) firstRetainedBySession.set(chunk.sessionId, chunk.seq)
    }
    const sessions: TerminalSession[] = snapshot.sessions.map((session) => toServiceSession(
      session,
      firstRetainedBySession.get(session.sessionId),
      sessionEnvironmentById.get(session.sessionId),
    ))

    return terminalStoreStateSchema.parse({
      groups,
      sessions,
      output,
      terminalDomainRevision: snapshot.domain.terminalDomainRevision,
      operations: snapshot.operations,
      idempotency: snapshot.idempotency.map((entry) => ({
        scope: `${entry.clientId}:${entry.capabilityId}:${entry.idempotencyKey}`,
        clientId: entry.clientId,
        capability: entry.capabilityId,
        idempotencyKey: entry.idempotencyKey,
        digest: entry.requestDigest,
        expiresAtMs: Date.parse(entry.expiresAt),
        result: entry.result.value,
      })),
      checkpoints,
    })
  }

  async function saveState(source: Parameters<TerminalStore["saveState"]>[0]): Promise<void> {
    await initialize()
    const state = terminalStoreStateSchema.parse(source)
    const hasSensitiveConfiguration = state.groups.some((group) =>
      Boolean(group.settings?.commands?.length || Object.keys(group.settings?.environment ?? {}).length))
      || state.sessions.some((session) => Object.keys(session.launchEnvironment ?? {}).length > 0)
    if (hasSensitiveConfiguration && options.blocks.persistenceProtection !== "available") {
      throw new Error("Terminal persistence protection unavailable for sensitive configuration")
    }
    const deleteIntent = await createDeleteIntent(state)
    await syncGroups(state)
    await syncSessions(state)
    await syncOperations(state)
    await syncIdempotency(state)
    await syncOutput(state)
    await syncCheckpoints(state)
    await options.repository.domain.setSingleton({
      schemaVersion: 2,
      terminalDomainRevision: state.terminalDomainRevision,
      updatedAt: new Date().toISOString(),
    })
    if (deleteIntent) await options.repository.deleteIntents.remove(deleteIntent.id)
  }

  async function createDeleteIntent(state: TerminalStoreState): Promise<TerminalDeleteIntentEntry | null> {
    const snapshot = await options.repository.loadSnapshot()
    const wantedGroups = new Set(state.groups.map((group) => group.id))
    const wantedCommands = new Set(state.groups.flatMap((group) => group.settings?.commands?.map((command) => command.id) ?? []))
    const wantedSessions = new Set(state.sessions.map((session) => session.id))
    const groupIds = snapshot.groups.filter((group) => !wantedGroups.has(group.groupId)).map((group) => group.groupId)
    const commandIds = snapshot.commands.filter((command) => !wantedCommands.has(command.commandId)).map((command) => command.commandId)
    const sessionIds = snapshot.sessions.filter((session) => !wantedSessions.has(session.sessionId)).map((session) => session.sessionId)
    if (!groupIds.length && !commandIds.length && !sessionIds.length) return null
    const removedSessions = new Set(sessionIds)
    const intent: TerminalDeleteIntentEntry = {
      schemaVersion: 1,
      id: randomUUID(),
      groupIds,
      commandIds,
      sessionIds,
      blockIds: snapshot.blocks.filter((block) => removedSessions.has(block.sessionId)).map((block) => block.blockId),
      createdAt: new Date().toISOString(),
    }
    await options.repository.deleteIntents.upsert(intent)
    return intent
  }

  async function recoverPendingDeletes(): Promise<void> {
    for (const intent of await options.repository.deleteIntents.list()) {
      for (const blockId of intent.blockIds) {
        await options.blocks.deleteBlock(blockId)
        await options.repository.blocks.remove(blockId)
      }
      for (const sessionId of intent.sessionIds) {
        await options.repository.launchBodies.remove(sessionId)
        await options.repository.sessions.remove(sessionId)
      }
      for (const commandId of intent.commandIds) {
        await options.repository.commandBodies.remove(commandId)
        await options.repository.commands.remove(commandId)
      }
      for (const groupId of intent.groupIds) {
        await options.repository.groupLaunchBodies.remove(groupId)
        await options.repository.groups.remove(groupId)
      }
      await options.repository.deleteIntents.remove(intent.id)
    }
  }

  async function syncGroups(state: TerminalStoreState): Promise<void> {
    const existingGroups = await options.repository.groups.list()
    const existingCommands = await options.repository.commands.list()
    const wantedGroupIds = new Set(state.groups.map((group) => group.id))
    const wantedCommandIds = new Set<string>()
    for (const group of state.groups) {
      const environment = group.settings?.environment ?? {}
      const launchBodyRef = Object.keys(environment).length ? group.id : undefined
      const record: TerminalGroupRecord = {
        schemaVersion: 2,
        id: group.id,
        groupId: group.id,
        name: group.name,
        createdAt: group.createdAt,
        updatedAt: group.updatedAt,
        sortOrder: group.sortOrder,
        groupRevision: group.groupRevision,
        launchRevision: group.launchRevision,
        membershipRevision: group.membershipRevision,
        commandCollectionRevision: group.commandCollectionRevision,
        defaultCwd: group.settings?.defaultCwd,
        shell: group.settings?.shell,
        launchBodyRef,
        environmentKeys: Object.keys(environment).sort(),
      }
      await options.repository.groups.upsert(record)
      if (launchBodyRef) {
        await options.repository.groupLaunchBodies.upsert({
          schemaVersion: 1,
          id: launchBodyRef,
          groupId: group.id,
          environment,
          updatedAt: group.updatedAt,
        })
      } else {
        await options.repository.groupLaunchBodies.remove(group.id)
      }
      for (const command of group.settings?.commands ?? []) {
        wantedCommandIds.add(command.id)
        const commandRecord: TerminalCommandRecord = {
          schemaVersion: 2,
          id: command.id,
          commandId: command.id,
          groupId: group.id,
          name: command.name,
          commandRevision: command.commandRevision,
          createdAt: command.createdAt,
          updatedAt: command.updatedAt,
          source: "user",
          bodyRef: command.id,
          bodyByteLength: Buffer.byteLength(command.command, "utf8"),
          bodyAvailable: true,
        }
        await options.repository.commandBodies.upsert({
          schemaVersion: 1,
          id: command.id,
          commandId: command.id,
          body: command.command,
          updatedAt: command.updatedAt,
        })
        await options.repository.commands.upsert(commandRecord)
      }
    }
    for (const command of existingCommands) {
      if (wantedCommandIds.has(command.commandId)) continue
      await options.repository.commandBodies.remove(command.commandId)
      await options.repository.commands.remove(command.commandId)
    }
    for (const group of existingGroups) {
      if (wantedGroupIds.has(group.groupId)) continue
      await options.repository.groupLaunchBodies.remove(group.groupId)
      await options.repository.groups.remove(group.groupId)
    }
  }

  async function syncSessions(state: TerminalStoreState): Promise<void> {
    const existing = await options.repository.sessions.list()
    const wanted = new Set(state.sessions.map((session) => session.id))
    const outputBySession = new Map<string, typeof state.output>()
    for (const chunk of state.output) {
      const items = outputBySession.get(chunk.sessionId) ?? []
      items.push(chunk)
      outputBySession.set(chunk.sessionId, items)
    }
    for (const session of state.sessions) {
      const output = outputBySession.get(session.id) ?? []
      const environment = session.launchEnvironment ?? {}
      const launchBodyRef = Object.keys(environment).length ? session.id : undefined
      await options.repository.sessions.upsert(toSessionRecord(session, output, launchBodyRef))
      if (launchBodyRef) {
        await options.repository.launchBodies.upsert({
          schemaVersion: 1,
          id: launchBodyRef,
          sessionId: session.id,
          environment,
          createdAt: session.createdAt,
        })
      } else {
        await options.repository.launchBodies.remove(session.id)
      }
    }
    for (const session of existing) {
      if (wanted.has(session.sessionId)) continue
      await options.repository.launchBodies.remove(session.sessionId)
      await options.repository.sessions.remove(session.sessionId)
    }
  }

  async function syncOperations(state: TerminalStoreState): Promise<void> {
    await syncCollection(options.repository.operations, state.operations)
  }

  async function syncIdempotency(state: TerminalStoreState): Promise<void> {
    const records: TerminalIdempotencyRecord[] = state.idempotency.map((entry) => ({
      schemaVersion: 2,
      id: createHash("sha256").update(entry.scope).digest("hex"),
      clientId: entry.clientId,
      capabilityId: entry.capability,
      idempotencyKey: entry.idempotencyKey,
      requestDigest: entry.digest,
      outcome: "stored_result",
      createdAt: new Date(Math.max(0, entry.expiresAtMs - 24 * 60 * 60 * 1_000)).toISOString(),
      expiresAt: new Date(entry.expiresAtMs).toISOString(),
      result: { value: entry.result },
    }))
    await syncCollection(options.repository.idempotency, records)
  }

  async function syncOutput(state: TerminalStoreState): Promise<void> {
    const manifests = await options.repository.blocks.list()
    const byRange = new Map(manifests
      .filter((item) => item.type === "output")
      .map((item) => [`${item.sessionId}:${item.firstOutputSeq}`, item]))
    const wanted = new Set<string>()
    for (const chunk of state.output) {
      const rangeKey = `${chunk.sessionId}:${chunk.seq}`
      wanted.add(rangeKey)
      if (byRange.has(rangeKey)) continue
      const plaintext = Buffer.from(JSON.stringify(chunk), "utf8")
      const written = await options.blocks.writeBlock({ sessionId: chunk.sessionId, type: "output", plaintext })
      if (!written.persisted) continue
      const manifest: TerminalBlockManifestEntry = {
        schemaVersion: 1,
        id: written.blockId,
        blockId: written.blockId,
        sessionId: chunk.sessionId,
        type: "output",
        firstOutputSeq: chunk.seq,
        nextOutputSeq: chunk.seq + 1,
        byteLength: written.byteLength,
        sha256: written.sha256,
        createdAt: chunk.createdAt,
        encryptionSchemaVersion: 1,
      }
      await options.repository.blocks.upsert(manifest)
    }
    for (const manifest of manifests) {
      if (manifest.type !== "output" || wanted.has(`${manifest.sessionId}:${manifest.firstOutputSeq}`)) continue
      await options.blocks.deleteBlock(manifest.blockId)
      await options.repository.blocks.remove(manifest.id)
    }
  }

  async function syncCheckpoints(state: TerminalStoreState): Promise<void> {
    const manifests = (await options.repository.blocks.list()).filter((item) => item.type === "checkpoint")
    const existingBySession = new Map(manifests.map((item) => [item.sessionId, item]))
    const wanted = new Set(state.checkpoints.map((item) => item.sessionId))
    for (const checkpoint of state.checkpoints) {
      const plaintext = Buffer.from(JSON.stringify(checkpoint), "utf8")
      const sha256 = createHash("sha256").update(plaintext).digest("hex")
      const existing = existingBySession.get(checkpoint.sessionId)
      if (existing?.sha256 === sha256) continue
      const written = await options.blocks.writeBlock({ sessionId: checkpoint.sessionId, type: "checkpoint", plaintext })
      if (!written.persisted) continue
      await options.repository.blocks.upsert({
        schemaVersion: 1,
        id: written.blockId,
        blockId: written.blockId,
        sessionId: checkpoint.sessionId,
        type: "checkpoint",
        firstOutputSeq: checkpoint.throughOutputSeq,
        nextOutputSeq: checkpoint.throughOutputSeq + 1,
        byteLength: written.byteLength,
        sha256: written.sha256,
        createdAt: new Date().toISOString(),
        encryptionSchemaVersion: 1,
      })
      if (existing) {
        await options.blocks.deleteBlock(existing.blockId)
        await options.repository.blocks.remove(existing.id)
      }
    }
    for (const manifest of manifests) {
      if (wanted.has(manifest.sessionId)) continue
      await options.blocks.deleteBlock(manifest.blockId)
      await options.repository.blocks.remove(manifest.id)
    }
  }

  return {
    loadState,
    saveState,
    get persistenceProtection() { return options.blocks.persistenceProtection },
  }
}

function toServiceSession(
  session: TerminalSessionRecord,
  firstRetainedSeq: number | undefined,
  launchEnvironment: Record<string, string> | undefined,
): TerminalSession {
  return {
    id: session.sessionId,
    groupId: session.groupId,
    title: session.title,
    cwd: session.cwd,
    shell: session.shell,
    status: session.lifecycle,
    ...(session.endFacts?.exitCode === null ? {} : { exitCode: session.endFacts?.exitCode }),
    ...(session.endFacts?.signal === null ? {} : { signal: session.endFacts?.signal }),
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    startedAt: session.startedAt,
    ...(session.endFacts?.endedAt ? { endedAt: session.endFacts.endedAt } : {}),
    cols: session.cols,
    rows: session.rows,
    lastOutputSeq: session.nextOutputSeq - 1,
    metadataRevision: session.metadataRevision,
    stateRevision: session.stateRevision,
    inputRevision: session.inputRevision,
    sizeRevision: session.sizeRevision,
    attention: session.attention,
    creationSource: session.creationSource,
    createdByClientId: session.createdByClientId,
    endCause: session.endFacts?.cause,
    stopOperationId: session.endFacts?.stopOperationId,
    stopRequestedBy: session.endFacts?.requestedBy,
    stopRequestedAt: session.endFacts?.requestedAt,
    endTimeUnknown: session.endFacts?.endTimeUnknown ?? false,
    inputHistoryBeforeBaselineUnknown: session.inputHistoryBeforeBaselineUnknown,
    launchRevisionApplied: session.launchRevisionApplied,
    commandId: session.commandId,
    commandRevisionApplied: session.commandRevisionApplied,
    commandDeliveryOperationId: session.commandDeliveryOperationId,
    discardedOutputBytes: session.discardedOutputBytes,
    discardedOutputChunks: Math.max(session.discardedOutputChunks, (firstRetainedSeq ?? session.nextOutputSeq) - 1),
    lastEvictedAt: session.lastEvictedAt,
    ...(launchEnvironment ? { launchEnvironment } : {}),
    launchFacts: session.launchFacts,
  }
}

function toSessionRecord(
  session: TerminalSession,
  output: TerminalStoreState["output"],
  launchBodyRef: string | undefined,
): TerminalSessionRecord {
  const firstRetainedOutputSeq = output.length
    ? Math.min(...output.map((chunk) => chunk.seq))
    : session.lastOutputSeq + 1
  const isTerminal = session.status === "ended" || session.status === "failed" || session.status === "lost"
  return {
    schemaVersion: 2,
    id: session.id,
    sessionId: session.id,
    groupId: session.groupId,
    title: session.title,
    cwd: session.cwd,
    shell: session.shell,
    launchBodyRef,
    creationSource: session.creationSource,
    createdByClientId: session.createdByClientId,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    startedAt: session.startedAt,
    lifecycle: session.status,
    ...(isTerminal ? {
      endFacts: {
        cause: session.endCause ?? defaultEndCause(session.status),
        exitCode: session.exitCode ?? null,
        signal: session.signal ?? null,
        endedAt: session.endedAt ?? null,
        endTimeUnknown: session.endTimeUnknown || !session.endedAt,
        ...(session.stopOperationId ? { stopOperationId: session.stopOperationId } : {}),
        ...(session.stopRequestedBy ? { requestedBy: session.stopRequestedBy } : {}),
        ...(session.stopRequestedAt ? { requestedAt: session.stopRequestedAt } : {}),
      },
    } : {}),
    metadataRevision: session.metadataRevision,
    stateRevision: session.stateRevision,
    inputRevision: session.inputRevision,
    inputHistoryBeforeBaselineUnknown: session.inputHistoryBeforeBaselineUnknown,
    sizeRevision: session.sizeRevision,
    cols: session.cols,
    rows: session.rows,
    nextOutputSeq: session.lastOutputSeq + 1,
    firstRetainedOutputSeq,
    discardedOutputBytes: session.discardedOutputBytes,
    discardedOutputChunks: Math.max(session.discardedOutputChunks, firstRetainedOutputSeq - 1),
    lastEvictedAt: session.lastEvictedAt,
    launchRevisionApplied: session.launchRevisionApplied,
    commandId: session.commandId,
    commandRevisionApplied: session.commandRevisionApplied,
    commandDeliveryOperationId: session.commandDeliveryOperationId,
    launchFacts: session.launchFacts ?? {
      shellKind: session.creationSource === "legacy_unknown" ? "legacy_unversioned" : "default",
      cwdKind: session.creationSource === "legacy_unknown" ? "legacy_unversioned" : "default",
      environmentKeys: [],
      overriddenFields: [],
      cols: session.cols,
      rows: session.rows,
      legacyUnversioned: session.creationSource === "legacy_unknown",
    },
    attention: session.attention,
  }
}

function defaultEndCause(lifecycle: TerminalSession["status"]): string {
  if (lifecycle === "failed") return "infrastructure_failure"
  if (lifecycle === "lost") return "runtime_lost"
  return "process_exit"
}

async function syncCollection<T extends { id: string }>(
  namespace: {
    list(): Promise<T[]>
    upsert(item: T): Promise<void>
    remove(id: string): Promise<void>
  },
  records: readonly T[],
): Promise<void> {
  const existing = await namespace.list()
  const wanted = new Set(records.map((item) => item.id))
  for (const record of records) await namespace.upsert(record)
  for (const record of existing) if (!wanted.has(record.id)) await namespace.remove(record.id)
}

async function safeList<T>(
  namespace: { list(): Promise<T[]> },
  logger?: PersistenceLogger,
): Promise<T[]> {
  try {
    return await namespace.list()
  } catch (error) {
    logger?.warn("Terminal encrypted metadata is unavailable.", { error })
    return []
  }
}

function parseCheckpoint(value: unknown): TerminalStoreState["checkpoints"][number] {
  if (!value || typeof value !== "object") throw new Error("Invalid Terminal checkpoint")
  const checkpoint = value as Partial<TerminalStoreState["checkpoints"][number]>
  if (typeof checkpoint.sessionId !== "string"
    || typeof checkpoint.throughOutputSeq !== "number"
    || typeof checkpoint.sizeRevision !== "number"
    || checkpoint.emulatorId !== "xterm-headless"
    || checkpoint.emulatorVersion !== "6.0.0"
    || typeof checkpoint.serialized !== "string") {
    throw new Error("Invalid Terminal checkpoint")
  }
  return checkpoint as TerminalStoreState["checkpoints"][number]
}
