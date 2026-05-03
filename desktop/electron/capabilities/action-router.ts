import { getActionDomainId } from "../../synapse-capabilities/shared/registry"
import type {
  DispatchContext,
  DispatchResult,
} from "../../synapse-capabilities/shared/types"

type DomainDispatch = (
  action: string,
  params: Record<string, unknown>,
  context: DispatchContext,
) => DispatchResult | Promise<DispatchResult>

export type SynapseActionRouter = {
  readonly dispatch: DomainDispatch
}

export type SynapseActionRouterDeps = {
  readonly databaseDispatch: DomainDispatch
  readonly schedulerDispatch: DomainDispatch
}

export function createSynapseActionRouter(deps: SynapseActionRouterDeps): SynapseActionRouter {
  return {
    async dispatch(action, params, context) {
      const domainId = getActionDomainId(action)
      if (domainId === "database") return deps.databaseDispatch(action, params, context)
      if (domainId === "scheduler") return deps.schedulerDispatch(action, params, context)
      throw new Error(`Unknown action: ${action}`)
    },
  }
}
