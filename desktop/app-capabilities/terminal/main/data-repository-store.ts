import { createHash, randomUUID } from "node:crypto"

import type { TerminalBlockManifestEntry, TerminalDeleteIntentEntry } from "../../../electron/runtime/data-repo/schemas"
import type {
  TerminalCommandRecord,
  TerminalGroupRecord,
  TerminalIdempotencyRecord,
  TerminalSessionRecord,
  TerminalWorkspaceRecord,
} from "../shared/contract-schema"
import {
  terminalOutputChunkSchema,
  terminalSessionSchema,
  type TerminalEnvironment,
  type TerminalGroup,
  type TerminalGroupCommand,
  type TerminalSession,
} from "../shared/schema"
import type { TerminalWorkspace } from "../shared/workspace"
import type { TerminalEncryptedBlockStore } from "./encrypted-block-store"
import type { TerminalRepository } from "./repository"
import {
  terminalStoreStateSchema,
  type TerminalRuntimeStoreUpdate,
  type TerminalStore,
  type TerminalStoreState,
} from "./store"

type PersistenceLogger = {
  warn(message: string, meta?: Record<string, unknown>): void
}

const TERMINAL_OUTPUT_BLOCK_MAX_BYTES = 64 * 1024

export function createTerminalDataRepositoryStore(options: {
  readonly repository: TerminalRepository
  readonly blocks: TerminalEncryptedBlockStore
  readonly logger?: PersistenceLogger
}): TerminalStore {
  let initialized = false
  let outputManifestsBySession: Map<string, Map<number, TerminalBlockManifestEntry>> | undefined
  let checkpointManifestsBySession: Map<string, TerminalBlockManifestEntry> | undefined
  let persistedFirstOutputSeqBySession: Map<string, number> | undefined

  async function initialize(): Promise<void> {
    if (initialized) return
    await options.blocks.initialize()
    initialized = true
  }

  async function loadState(): Promise<TerminalStoreState> {
    await initialize()
    await recoverPendingDeletes()
    const snapshot = await options.repository.loadSnapshot()
    rememberBlockManifests(snapshot.blocks)
    const retainedBlockIds = new Set(snapshot.blocks.map((item) => item.blockId))
    for (const blockId of await options.blocks.listBlockIds()) {
      if (!retainedBlockIds.has(blockId)) await options.blocks.deleteBlock(blockId)
    }
    const commandBodies = await safeList(options.repository.commandBodies, options.logger)
    const globalLaunchBody = await safeGetSingleton(options.repository.globalLaunchBodies, options.logger)
    const toolbarActions = await safeGetSingleton(options.repository.toolbarActions, options.logger)
    const groupLaunchBodies = await safeList(options.repository.groupLaunchBodies, options.logger)
    const launchBodies = await safeList(options.repository.launchBodies, options.logger)
    const commandBodyById = new Map(commandBodies.map((item) => [item.commandId, item]))
    const groupEnvironmentById = new Map(groupLaunchBodies.map((item) => [item.groupId, item.environment]))
    const sessionEnvironmentById = new Map(launchBodies.map((item) => [item.sessionId, item.environment]))
    const commandsByGroup = new Map<string, TerminalGroupCommand[]>()
    for (const command of snapshot.commands) {
      const body = commandBodyById.get(command.commandId)
      if (body === undefined) continue
      const environment = combineStoredEnvironment(body.environment, command.unsetEnvironmentKeys)
      const items = commandsByGroup.get(command.groupId) ?? []
      items.push({
        id: command.commandId,
        name: command.name,
        command: body.body,
        createdAt: command.createdAt,
        updatedAt: command.updatedAt,
        commandRevision: command.commandRevision,
        ...((command.defaultCwd || command.shell || Object.keys(environment).length) ? {
          launch: {
            ...(command.defaultCwd ? { defaultCwd: command.defaultCwd } : {}),
            ...(command.shell ? { shell: command.shell } : {}),
            ...(Object.keys(environment).length ? { environment } : {}),
          },
        } : {}),
      })
      commandsByGroup.set(command.groupId, items)
    }

    const groups: TerminalGroup[] = snapshot.groups.map((group) => {
      const commands = commandsByGroup.get(group.groupId) ?? []
      const environment = combineStoredEnvironment(
        groupEnvironmentById.get(group.groupId),
        group.unsetEnvironmentKeys,
      )
      const settings = {
        ...(group.defaultCwd ? { defaultCwd: group.defaultCwd } : {}),
        ...(group.shell ? { shell: group.shell } : {}),
        ...(Object.keys(environment).length ? { environment } : {}),
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

    const output: TerminalStoreState["output"][number][] = []
    const checkpoints: TerminalStoreState["checkpoints"] = []
    const sessionRanges = new Map(snapshot.sessions.map((session) => [session.sessionId, {
      first: session.firstRetainedOutputSeq,
      next: session.nextOutputSeq,
    }]))
    for (const manifest of [...snapshot.blocks].sort((a, b) => a.firstOutputSeq - b.firstOutputSeq)) {
      try {
        const plaintext = await options.blocks.readBlock({
          blockId: manifest.blockId,
          sessionId: manifest.sessionId,
          type: manifest.type,
          expectedSha256: manifest.sha256,
        })
        const parsed = JSON.parse(plaintext.toString("utf8"))
        if (manifest.type === "output") {
          const chunks = parseOutputBlock(parsed, manifest)
          const retainedRange = sessionRanges.get(manifest.sessionId)
          if (retainedRange) {
            output.push(...chunks.filter((chunk) => (
              chunk.seq >= retainedRange.first && chunk.seq < retainedRange.next
            )))
          }
        } else checkpoints.push(parseCheckpoint(parsed))
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
      globalLaunch: snapshot.globalLaunch ? {
        revision: snapshot.globalLaunch.revision,
        updatedAt: snapshot.globalLaunch.updatedAt,
        settings: {
          ...(snapshot.globalLaunch.defaultCwd ? { defaultCwd: snapshot.globalLaunch.defaultCwd } : {}),
          ...(snapshot.globalLaunch.shell ? { shell: snapshot.globalLaunch.shell } : {}),
          ...(() => {
            const environment = combineStoredEnvironment(
              globalLaunchBody?.environment,
              snapshot.globalLaunch?.unsetEnvironmentKeys,
            )
            return Object.keys(environment).length ? { environment } : {}
          })(),
        },
      } : undefined,
      toolbarActions: toolbarActions?.items ?? [],
      groups,
      workspaces: snapshot.workspaces.map(toServiceWorkspace),
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
      Boolean(group.settings?.commands?.length || hasSetEnvironmentValue(group.settings?.environment)))
      || hasSetEnvironmentValue(state.globalLaunch.settings?.environment)
      || state.toolbarActions.length > 0
      || state.sessions.some((session) => Object.keys(session.launchEnvironment ?? {}).length > 0)
    if (hasSensitiveConfiguration && options.blocks.persistenceProtection !== "available") {
      throw new Error("Terminal persistence protection unavailable for sensitive configuration")
    }
    const deleteIntent = await createDeleteIntent(state)
    await syncGlobalLaunch(state)
    await syncToolbarActions(state)
    await syncGroups(state)
    await syncWorkspaces(state)
    await syncSessions(state)
    await syncOperations(state)
    await syncIdempotency(state)
    await syncOutput(state)
    await syncCheckpoints(state)
    const persistedDomain = await options.repository.domain.getSingleton()
    if (persistedDomain?.terminalDomainRevision !== state.terminalDomainRevision) {
      await options.repository.domain.setSingleton({
        schemaVersion: 2,
        terminalDomainRevision: state.terminalDomainRevision,
        updatedAt: new Date().toISOString(),
      })
    }
    if (deleteIntent) await options.repository.deleteIntents.remove(deleteIntent.id)
  }

  async function saveRuntimeState(source: TerminalRuntimeStoreUpdate): Promise<void> {
    await initialize()
    const updates = source.sessions.map((item) => ({
      session: terminalSessionSchema.parse(item.session),
      output: item.output.map((chunk) => terminalOutputChunkSchema.parse(chunk)),
      firstRetainedOutputSeq: item.firstRetainedOutputSeq,
      ...(item.checkpoint ? { checkpoint: parseCheckpoint(item.checkpoint) } : {}),
    }))
    for (const update of updates) {
      if (!Number.isSafeInteger(update.firstRetainedOutputSeq) || update.firstRetainedOutputSeq < 1) {
        throw new Error("Invalid Terminal retained output sequence")
      }
      if (update.output.some((chunk) => chunk.sessionId !== update.session.id)) {
        throw new Error("Terminal runtime output belongs to another session")
      }
    }
    await syncRuntimeOutput(updates)
    for (const update of updates) {
      const launchBodyRef = Object.keys(update.session.launchEnvironment ?? {}).length
        ? update.session.id
        : undefined
      await options.repository.sessions.upsert(toSessionRecord(
        update.session,
        update.output,
        launchBodyRef,
        update.firstRetainedOutputSeq,
      ))
    }
    for (const update of updates) {
      if (update.checkpoint) await syncCheckpoint(update.checkpoint)
    }
  }

  async function syncGlobalLaunch(state: TerminalStoreState): Promise<void> {
    const settings = state.globalLaunch.settings
    const environment = splitEnvironment(settings?.environment)
    const record = {
      schemaVersion: 1,
      id: "default",
      revision: state.globalLaunch.revision,
      updatedAt: state.globalLaunch.updatedAt,
      defaultCwd: settings?.defaultCwd,
      shell: settings?.shell,
      environmentKeys: Object.keys(environment.values).sort(),
      unsetEnvironmentKeys: environment.unsetKeys,
    } as const
    const existing = await options.repository.globalLaunch.getSingleton()
    if (!sameRecord(existing, record)) await options.repository.globalLaunch.setSingleton(record)
    const existingBody = await options.repository.globalLaunchBodies.getSingleton()
    if (Object.keys(environment.values).length) {
      const body = {
        schemaVersion: 1,
        id: "default",
        environment: environment.values,
        updatedAt: state.globalLaunch.updatedAt,
      } as const
      if (!sameRecord(existingBody, body)) await options.repository.globalLaunchBodies.setSingleton(body)
    } else if (existingBody) {
      if (options.repository.globalLaunchBodies.clearSingleton) {
        await options.repository.globalLaunchBodies.clearSingleton()
      } else {
        await options.repository.globalLaunchBodies.remove("default")
      }
    }
  }

  async function syncToolbarActions(state: TerminalStoreState): Promise<void> {
    const existing = await options.repository.toolbarActions.getSingleton()
    if (state.toolbarActions.length > 0) {
      const updatedAt = state.toolbarActions.reduce(
        (latest, item) => item.updatedAt > latest ? item.updatedAt : latest,
        new Date(0).toISOString(),
      )
      const record = {
        schemaVersion: 1,
        id: "default",
        items: state.toolbarActions,
        updatedAt,
      } as const
      if (!sameRecord(existing, record)) await options.repository.toolbarActions.setSingleton(record)
    } else if (existing && existing.items.length > 0) {
      await options.repository.toolbarActions.setSingleton({
        schemaVersion: 1,
        id: "default",
        items: [],
        updatedAt: new Date().toISOString(),
      })
    }
  }

  async function createDeleteIntent(state: TerminalStoreState): Promise<TerminalDeleteIntentEntry | null> {
    const snapshot = await options.repository.loadSnapshot()
    rememberBlockManifests(snapshot.blocks)
    const wantedGroups = new Set(state.groups.map((group) => group.id))
    const wantedCommands = new Set(state.groups.flatMap((group) => group.settings?.commands?.map((command) => command.id) ?? []))
    const wantedSessions = new Set(state.sessions.map((session) => session.id))
    const wantedWorkspaces = new Set(state.workspaces.map((workspace) => workspace.id))
    const groupIds = snapshot.groups.filter((group) => !wantedGroups.has(group.groupId)).map((group) => group.groupId)
    const commandIds = snapshot.commands.filter((command) => !wantedCommands.has(command.commandId)).map((command) => command.commandId)
    const sessionIds = snapshot.sessions.filter((session) => !wantedSessions.has(session.sessionId)).map((session) => session.sessionId)
    const workspaceIds = snapshot.workspaces
      .filter((workspace) => !wantedWorkspaces.has(workspace.workspaceId))
      .map((workspace) => workspace.workspaceId)
    if (!groupIds.length && !commandIds.length && !sessionIds.length && !workspaceIds.length) return null
    const removedSessions = new Set(sessionIds)
    const intent: TerminalDeleteIntentEntry = {
      schemaVersion: 1,
      id: randomUUID(),
      groupIds,
      commandIds,
      sessionIds,
      workspaceIds,
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
      for (const workspaceId of intent.workspaceIds ?? []) {
        await options.repository.workspaces.remove(workspaceId)
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
    const existingGroupLaunchBodies = await options.repository.groupLaunchBodies.list()
    const existingCommandBodies = await options.repository.commandBodies.list()
    const existingGroupById = new Map(existingGroups.map((group) => [group.groupId, group]))
    const existingCommandById = new Map(existingCommands.map((command) => [command.commandId, command]))
    const existingGroupLaunchBodyById = new Map(existingGroupLaunchBodies.map((body) => [body.groupId, body]))
    const existingCommandBodyById = new Map(existingCommandBodies.map((body) => [body.commandId, body]))
    const wantedGroupIds = new Set(state.groups.map((group) => group.id))
    const wantedCommandIds = new Set<string>()
    for (const group of state.groups) {
      const environment = splitEnvironment(group.settings?.environment)
      const launchBodyRef = Object.keys(environment.values).length ? group.id : undefined
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
        environmentKeys: Object.keys(environment.values).sort(),
        unsetEnvironmentKeys: environment.unsetKeys,
      }
      if (!sameRecord(existingGroupById.get(group.id), record)) {
        await options.repository.groups.upsert(record)
      }
      if (launchBodyRef) {
        const body = {
          schemaVersion: 1,
          id: launchBodyRef,
          groupId: group.id,
          environment: environment.values,
          updatedAt: group.updatedAt,
        } as const
        if (!sameRecord(existingGroupLaunchBodyById.get(group.id), body)) {
          await options.repository.groupLaunchBodies.upsert(body)
        }
      } else if (existingGroupLaunchBodyById.has(group.id)) {
        await options.repository.groupLaunchBodies.remove(group.id)
      }
      for (const command of group.settings?.commands ?? []) {
        wantedCommandIds.add(command.id)
        const commandEnvironment = splitEnvironment(command.launch?.environment)
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
          defaultCwd: command.launch?.defaultCwd,
          shell: command.launch?.shell,
          environmentKeys: Object.keys(commandEnvironment.values).sort(),
          unsetEnvironmentKeys: commandEnvironment.unsetKeys,
        }
        const commandBody = {
          schemaVersion: 1,
          id: command.id,
          commandId: command.id,
          body: command.command,
          ...(Object.keys(commandEnvironment.values).length ? { environment: commandEnvironment.values } : {}),
          updatedAt: command.updatedAt,
        } as const
        if (!sameRecord(existingCommandBodyById.get(command.id), commandBody)) {
          await options.repository.commandBodies.upsert(commandBody)
        }
        if (!sameRecord(existingCommandById.get(command.id), commandRecord)) {
          await options.repository.commands.upsert(commandRecord)
        }
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
    const existingLaunchBodies = await options.repository.launchBodies.list()
    const existingById = new Map(existing.map((session) => [session.sessionId, session]))
    const existingLaunchBodyById = new Map(existingLaunchBodies.map((body) => [body.sessionId, body]))
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
      const record = toSessionRecord(session, output, launchBodyRef)
      if (!sameRecord(existingById.get(session.id), record)) {
        await options.repository.sessions.upsert(record)
      }
      if (launchBodyRef) {
        const body = {
          schemaVersion: 1,
          id: launchBodyRef,
          sessionId: session.id,
          environment,
          createdAt: session.createdAt,
        } as const
        if (!sameRecord(existingLaunchBodyById.get(session.id), body)) {
          await options.repository.launchBodies.upsert(body)
        }
      } else if (existingLaunchBodyById.has(session.id)) {
        await options.repository.launchBodies.remove(session.id)
      }
    }
    for (const session of existing) {
      if (wanted.has(session.sessionId)) continue
      await options.repository.launchBodies.remove(session.sessionId)
      await options.repository.sessions.remove(session.sessionId)
    }
  }

  async function syncWorkspaces(state: TerminalStoreState): Promise<void> {
    const records = state.workspaces.map(toWorkspaceRecord)
    await syncCollection(options.repository.workspaces, records)
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
    await ensureBlockManifestIndex()
    const manifests = [...outputManifestsBySession!.values()].flatMap((items) => [...items.values()])
    const wantedRanges = new Map<string, { first: number; next: number }>()
    const pending: TerminalStoreState["output"] = []
    const persistedRanges = createOutputManifestRanges(outputManifestsBySession!)
    for (const chunk of state.output) {
      const wantedRange = wantedRanges.get(chunk.sessionId)
      wantedRanges.set(chunk.sessionId, wantedRange
        ? { first: Math.min(wantedRange.first, chunk.seq), next: Math.max(wantedRange.next, chunk.seq + 1) }
        : { first: chunk.seq, next: chunk.seq + 1 })
      if (outputSeqIsPersisted(persistedRanges, chunk.sessionId, chunk.seq)) continue
      pending.push(chunk)
    }
    for (const chunks of batchOutputChunks(pending)) await persistOutputChunks(chunks)
    for (const manifest of manifests) {
      const wantedRange = wantedRanges.get(manifest.sessionId)
      if (manifest.type !== "output" || (wantedRange
        && manifest.firstOutputSeq < wantedRange.next
        && manifest.nextOutputSeq > wantedRange.first)) continue
      await removeManifest(manifest)
    }
    persistedFirstOutputSeqBySession = new Map()
    for (const chunk of state.output) {
      const current = persistedFirstOutputSeqBySession.get(chunk.sessionId)
      if (current === undefined || chunk.seq < current) persistedFirstOutputSeqBySession.set(chunk.sessionId, chunk.seq)
    }
  }

  async function syncCheckpoints(state: TerminalStoreState): Promise<void> {
    await ensureBlockManifestIndex()
    const manifests = [...checkpointManifestsBySession!.values()]
    const wanted = new Set(state.checkpoints.map((item) => item.sessionId))
    for (const checkpoint of state.checkpoints) {
      await syncCheckpoint(checkpoint)
    }
    for (const manifest of manifests) {
      if (wanted.has(manifest.sessionId)) continue
      await removeManifest(manifest)
    }
  }

  async function syncRuntimeOutput(updates: TerminalRuntimeStoreUpdate["sessions"]): Promise<void> {
    await ensureBlockManifestIndex()
    for (const update of updates) {
      for (const manifest of outputManifestsBySession!.get(update.session.id)?.values() ?? []) {
        if (manifest.nextOutputSeq <= update.firstRetainedOutputSeq) await removeManifest(manifest)
      }
      persistedFirstOutputSeqBySession!.set(update.session.id, update.firstRetainedOutputSeq)
      const persistedRanges = createOutputManifestRanges(outputManifestsBySession!)
      const pending = update.output.filter((chunk) => (
        !outputSeqIsPersisted(persistedRanges, chunk.sessionId, chunk.seq)
      ))
      for (const chunks of batchOutputChunks(pending)) await persistOutputChunks(chunks)
    }
  }

  async function persistOutputChunks(chunks: TerminalStoreState["output"]): Promise<void> {
    const first = chunks[0]
    const last = chunks.at(-1)
    if (!first || !last) return
    const plaintext = Buffer.from(JSON.stringify(chunks.length === 1
      ? first
      : { schemaVersion: 1, chunks }), "utf8")
    const written = await options.blocks.writeBlock({ sessionId: first.sessionId, type: "output", plaintext })
    if (!written.persisted) return
    const manifest: TerminalBlockManifestEntry = {
      schemaVersion: 1,
      id: written.blockId,
      blockId: written.blockId,
      sessionId: first.sessionId,
      type: "output",
      firstOutputSeq: first.seq,
      nextOutputSeq: last.seq + 1,
      byteLength: written.byteLength,
      sha256: written.sha256,
      createdAt: first.createdAt,
      encryptionSchemaVersion: 1,
    }
    await options.repository.blocks.upsert(manifest)
    rememberManifest(manifest)
  }

  async function syncCheckpoint(checkpoint: TerminalStoreState["checkpoints"][number]): Promise<void> {
    await ensureBlockManifestIndex()
    const plaintext = Buffer.from(JSON.stringify(checkpoint), "utf8")
    const sha256 = createHash("sha256").update(plaintext).digest("hex")
    const existing = checkpointManifestsBySession!.get(checkpoint.sessionId)
    if (existing?.sha256 === sha256) return
    const written = await options.blocks.writeBlock({ sessionId: checkpoint.sessionId, type: "checkpoint", plaintext })
    if (!written.persisted) return
    const manifest: TerminalBlockManifestEntry = {
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
    }
    await options.repository.blocks.upsert(manifest)
    rememberManifest(manifest)
    if (existing) await removeManifest(existing)
  }

  async function ensureBlockManifestIndex(): Promise<void> {
    if (outputManifestsBySession && checkpointManifestsBySession && persistedFirstOutputSeqBySession) return
    rememberBlockManifests(await options.repository.blocks.list())
  }

  function rememberBlockManifests(manifests: readonly TerminalBlockManifestEntry[]): void {
    outputManifestsBySession = new Map()
    checkpointManifestsBySession = new Map()
    persistedFirstOutputSeqBySession = new Map()
    for (const manifest of manifests) rememberManifest(manifest)
  }

  function rememberManifest(manifest: TerminalBlockManifestEntry): void {
    if (manifest.type === "checkpoint") {
      checkpointManifestsBySession!.set(manifest.sessionId, manifest)
      return
    }
    const sessionManifests = outputManifestsBySession!.get(manifest.sessionId) ?? new Map()
    sessionManifests.set(manifest.firstOutputSeq, manifest)
    outputManifestsBySession!.set(manifest.sessionId, sessionManifests)
    const currentFirst = persistedFirstOutputSeqBySession!.get(manifest.sessionId)
    if (currentFirst === undefined || manifest.firstOutputSeq < currentFirst) {
      persistedFirstOutputSeqBySession!.set(manifest.sessionId, manifest.firstOutputSeq)
    }
  }

  async function removeManifest(manifest: TerminalBlockManifestEntry): Promise<void> {
    await options.blocks.deleteBlock(manifest.blockId)
    await options.repository.blocks.remove(manifest.id)
    if (manifest.type === "checkpoint") {
      if (checkpointManifestsBySession!.get(manifest.sessionId)?.id === manifest.id) {
        checkpointManifestsBySession!.delete(manifest.sessionId)
      }
      return
    }
    outputManifestsBySession!.get(manifest.sessionId)?.delete(manifest.firstOutputSeq)
  }

  return {
    loadState,
    saveState,
    saveRuntimeState,
    get persistenceProtection() { return options.blocks.persistenceProtection },
  }
}

function parseOutputBlock(
  value: unknown,
  manifest: TerminalBlockManifestEntry,
): TerminalStoreState["output"] {
  const legacy = terminalOutputChunkSchema.safeParse(value)
  const chunks = legacy.success
    ? [legacy.data]
    : terminalOutputChunkSchema.array().min(1).parse(
        value && typeof value === "object" && "schemaVersion" in value && value.schemaVersion === 1
          && "chunks" in value
          ? value.chunks
          : undefined,
      )
  const first = chunks[0]!
  const last = chunks.at(-1)!
  if (first.sessionId !== manifest.sessionId
    || first.seq !== manifest.firstOutputSeq
    || last.seq + 1 !== manifest.nextOutputSeq
    || chunks.some((chunk, index) => (
      chunk.sessionId !== manifest.sessionId
      || (index > 0 && chunk.seq !== chunks[index - 1]!.seq + 1)
    ))) {
    throw new Error("Terminal output block manifest range does not match its contents")
  }
  return chunks
}

function batchOutputChunks(chunks: TerminalStoreState["output"]): TerminalStoreState["output"][] {
  const batches: TerminalStoreState["output"][] = []
  let current: TerminalStoreState["output"] = []
  let currentBytes = 0
  for (const chunk of chunks) {
    const chunkBytes = Buffer.byteLength(JSON.stringify(chunk), "utf8")
    const previous = current.at(-1)
    const startsNewBatch = previous !== undefined && (
      previous.sessionId !== chunk.sessionId
      || previous.seq + 1 !== chunk.seq
      || currentBytes + chunkBytes > TERMINAL_OUTPUT_BLOCK_MAX_BYTES
    )
    if (startsNewBatch) {
      batches.push(current)
      current = []
      currentBytes = 0
    }
    current.push(chunk)
    currentBytes += chunkBytes
  }
  if (current.length > 0) batches.push(current)
  return batches
}

function createOutputManifestRanges(
  manifestsBySession: Map<string, Map<number, TerminalBlockManifestEntry>>,
): Map<string, TerminalBlockManifestEntry[]> {
  return new Map([...manifestsBySession].map(([sessionId, manifests]) => [
    sessionId,
    [...manifests.values()].sort((left, right) => left.firstOutputSeq - right.firstOutputSeq),
  ]))
}

function outputSeqIsPersisted(
  rangesBySession: Map<string, TerminalBlockManifestEntry[]>,
  sessionId: string,
  seq: number,
): boolean {
  const ranges = rangesBySession.get(sessionId)
  if (!ranges) return false
  let low = 0
  let high = ranges.length - 1
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const manifest = ranges[middle]!
    if (seq < manifest.firstOutputSeq) high = middle - 1
    else if (seq >= manifest.nextOutputSeq) low = middle + 1
    else return true
  }
  return false
}

function toServiceWorkspace(record: TerminalWorkspaceRecord): TerminalWorkspace {
  return {
    id: record.workspaceId,
    groupId: record.groupId,
    title: record.title,
    layout: record.layout,
    layoutRevision: record.layoutRevision,
    closingPaneIds: record.closingPaneIds,
    closing: record.closing,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

function toWorkspaceRecord(workspace: TerminalWorkspace): TerminalWorkspaceRecord {
  return {
    schemaVersion: 1,
    id: workspace.id,
    workspaceId: workspace.id,
    groupId: workspace.groupId,
    title: workspace.title,
    layout: workspace.layout,
    layoutRevision: workspace.layoutRevision,
    closingPaneIds: workspace.closingPaneIds,
    closing: workspace.closing,
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
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
    globalLaunchRevisionApplied: session.globalLaunchRevisionApplied,
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
  retainedFirstOutputSeq?: number,
): TerminalSessionRecord {
  const firstRetainedOutputSeq = retainedFirstOutputSeq ?? (output.length
    ? Math.min(...output.map((chunk) => chunk.seq))
    : session.lastOutputSeq + 1)
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
    globalLaunchRevisionApplied: session.globalLaunchRevisionApplied,
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
  const existingById = new Map(existing.map((item) => [item.id, item]))
  const wanted = new Set(records.map((item) => item.id))
  for (const record of records) {
    if (!sameRecord(existingById.get(record.id), record)) await namespace.upsert(record)
  }
  for (const record of existing) if (!wanted.has(record.id)) await namespace.remove(record.id)
}

function sameRecord(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
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

async function safeGetSingleton<T>(
  namespace: { getSingleton(): Promise<T | null> },
  logger?: PersistenceLogger,
): Promise<T | null> {
  try {
    return await namespace.getSingleton()
  } catch (error) {
    logger?.warn("Terminal encrypted metadata is unavailable.", { error })
    return null
  }
}

function splitEnvironment(environment: Readonly<TerminalEnvironment> | undefined): {
  values: Record<string, string>
  unsetKeys: string[]
} {
  const values: Record<string, string> = {}
  const unsetKeys: string[] = []
  for (const [key, value] of Object.entries(environment ?? {})) {
    if (value === null) unsetKeys.push(key)
    else values[key] = value
  }
  return { values, unsetKeys: unsetKeys.sort() }
}

function combineStoredEnvironment(
  values: Readonly<Record<string, string>> | undefined,
  unsetKeys: readonly string[] | undefined,
): TerminalEnvironment {
  const environment: TerminalEnvironment = { ...(values ?? {}) }
  for (const key of unsetKeys ?? []) environment[key] = null
  return environment
}

function hasSetEnvironmentValue(environment: Readonly<TerminalEnvironment> | undefined): boolean {
  return Object.values(environment ?? {}).some((value) => value !== null)
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
