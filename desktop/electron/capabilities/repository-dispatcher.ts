import type { SynapseConfig, SynapseRepositoryConfig } from "../../src/types/config"
import type { DispatchContext, DispatchResult } from "../../synapse-capabilities/shared/types"

type RepositoryCapabilityDispatcherDeps = {
  readonly loadConfig: () => Promise<SynapseConfig>
}

type RepositorySummary = {
  readonly uuid: string
  readonly name: string
  readonly localPath: string
  readonly isActive: boolean
  readonly variableCount: number
}

export function createRepositoryCapabilityDispatcher(deps: RepositoryCapabilityDispatcherDeps) {
  return {
    async dispatch(
      action: string,
      _params: Record<string, unknown>,
      _context: DispatchContext,
    ): Promise<DispatchResult> {
      switch (action) {
        case "repository.item.list": {
          const config = await deps.loadConfig()
          const repositories = config.repositories.map((repository) =>
            toRepositorySummary(repository, config.activeRepoUuid),
          )
          return {
            ok: true,
            data: {
              activeRepositoryUuid: config.activeRepoUuid,
              repositories,
            },
            total: repositories.length,
          }
        }
        default:
          throw new Error(`Unknown repository action: ${action}`)
      }
    },
  }
}

function toRepositorySummary(
  repository: SynapseRepositoryConfig,
  activeRepositoryUuid: string | null,
): RepositorySummary {
  return {
    uuid: repository.uuid,
    name: repository.name,
    localPath: repository.localPath,
    isActive: repository.uuid === activeRepositoryUuid,
    variableCount: repository.variables?.length ?? 0,
  }
}
