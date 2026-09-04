import type { DataNamespace, DataRepository } from "../../../electron/runtime/data-repo"
import type { TerminalBlockManifestEntry, TerminalDeleteIntentEntry } from "../../../electron/runtime/data-repo/schemas"
import type {
  TerminalCommandBodyRecord,
  TerminalCommandRecord,
  TerminalDomainState,
  TerminalGroupRecord,
  TerminalGroupLaunchBodyRecord,
  TerminalGlobalLaunchBodyRecord,
  TerminalGlobalLaunchRecord,
  TerminalIdempotencyRecord,
  TerminalLaunchBodyRecord,
  TerminalOperation,
  TerminalSessionRecord,
  TerminalWorkspaceRecord,
} from "../shared/contract-schema"

export type TerminalRepositorySnapshot = {
  readonly globalLaunch: TerminalGlobalLaunchRecord | null
  readonly groups: TerminalGroupRecord[]
  readonly workspaces: TerminalWorkspaceRecord[]
  readonly commands: TerminalCommandRecord[]
  readonly sessions: TerminalSessionRecord[]
  readonly operations: TerminalOperation[]
  readonly idempotency: TerminalIdempotencyRecord[]
  readonly blocks: TerminalBlockManifestEntry[]
  readonly deleteIntents: TerminalDeleteIntentEntry[]
  readonly domain: TerminalDomainState
}

export type TerminalRepository = ReturnType<typeof createTerminalRepository>

export function createTerminalRepository(dataRepository: DataRepository) {
  const groups = dataRepository.namespace<TerminalGroupRecord>("app.terminal.groups")
  const workspaces = dataRepository.namespace<TerminalWorkspaceRecord>("app.terminal.workspaces")
  const globalLaunch = dataRepository.namespace<TerminalGlobalLaunchRecord>("app.terminal.global-launch")
  const globalLaunchBodies = dataRepository.namespace<TerminalGlobalLaunchBodyRecord>("app.terminal.global-launch-bodies")
  const commands = dataRepository.namespace<TerminalCommandRecord>("app.terminal.commands")
  const groupLaunchBodies = dataRepository.namespace<TerminalGroupLaunchBodyRecord>("app.terminal.group-launch-bodies")
  const commandBodies = dataRepository.namespace<TerminalCommandBodyRecord>("app.terminal.command-bodies")
  const sessions = dataRepository.namespace<TerminalSessionRecord>("app.terminal.sessions")
  const launchBodies = dataRepository.namespace<TerminalLaunchBodyRecord>("app.terminal.launch-bodies")
  const operations = dataRepository.namespace<TerminalOperation>("app.terminal.operations")
  const idempotency = dataRepository.namespace<TerminalIdempotencyRecord>("app.terminal.idempotency")
  const blocks = dataRepository.namespace<TerminalBlockManifestEntry>("app.terminal.blocks")
  const deleteIntents = dataRepository.namespace<TerminalDeleteIntentEntry>("app.terminal.delete-intents")
  const domain = dataRepository.namespace<TerminalDomainState>("app.terminal.domain-state")

  async function loadSnapshot(): Promise<TerminalRepositorySnapshot> {
    const [
      groupItems,
      workspaceItems,
      globalLaunchItem,
      commandItems,
      sessionItems,
      operationItems,
      idempotencyItems,
      blockItems,
      deleteIntentItems,
      domainState,
    ] = await Promise.all([
      groups.list(),
      workspaces.list(),
      globalLaunch.getSingleton(),
      commands.list(),
      sessions.list(),
      operations.list(),
      idempotency.list(),
      blocks.list(),
      deleteIntents.list(),
      domain.getSingleton(),
    ])
    return {
      globalLaunch: globalLaunchItem,
      groups: groupItems,
      workspaces: workspaceItems,
      commands: commandItems,
      sessions: sessionItems,
      operations: operationItems,
      idempotency: idempotencyItems,
      blocks: blockItems,
      deleteIntents: deleteIntentItems,
      domain: domainState ?? {
        schemaVersion: 2,
        terminalDomainRevision: 0,
        updatedAt: new Date(0).toISOString(),
      },
    }
  }

  return {
    loadSnapshot,
    groups,
    workspaces,
    globalLaunch,
    globalLaunchBodies,
    commands,
    groupLaunchBodies,
    commandBodies,
    sessions,
    launchBodies,
    operations,
    idempotency,
    blocks,
    deleteIntents,
    domain,
  } satisfies {
    loadSnapshot(): Promise<TerminalRepositorySnapshot>
    groups: DataNamespace<TerminalGroupRecord>
    workspaces: DataNamespace<TerminalWorkspaceRecord>
    globalLaunch: DataNamespace<TerminalGlobalLaunchRecord>
    globalLaunchBodies: DataNamespace<TerminalGlobalLaunchBodyRecord>
    commands: DataNamespace<TerminalCommandRecord>
    groupLaunchBodies: DataNamespace<TerminalGroupLaunchBodyRecord>
    commandBodies: DataNamespace<TerminalCommandBodyRecord>
    sessions: DataNamespace<TerminalSessionRecord>
    launchBodies: DataNamespace<TerminalLaunchBodyRecord>
    operations: DataNamespace<TerminalOperation>
    idempotency: DataNamespace<TerminalIdempotencyRecord>
    blocks: DataNamespace<TerminalBlockManifestEntry>
    deleteIntents: DataNamespace<TerminalDeleteIntentEntry>
    domain: DataNamespace<TerminalDomainState>
  }
}
