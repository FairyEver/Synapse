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
  readonly appDispatch: DomainDispatch
  readonly automationDispatch: DomainDispatch
  readonly contentDispatch: DomainDispatch
  readonly databaseDispatch: DomainDispatch
  readonly driveDispatch: DomainDispatch
  readonly modelPriceDispatch: DomainDispatch
  readonly repositoryDispatch: DomainDispatch
  readonly variableDispatch: DomainDispatch
  readonly workflowDispatch: DomainDispatch
}

export function createSynapseActionRouter(deps: SynapseActionRouterDeps): SynapseActionRouter {
  return {
    async dispatch(action, params, context) {
      const domainId = getActionDomainId(action)
      if (domainId === "app") return deps.appDispatch(action, params, context)
      if (domainId === "automation") return deps.automationDispatch(action, params, context)
      if (domainId === "content") return deps.contentDispatch(action, params, context)
      if (domainId === "database") return deps.databaseDispatch(action, params, context)
      if (domainId === "drive") return deps.driveDispatch(action, params, context)
      if (domainId === "model_price") return deps.modelPriceDispatch(action, params, context)
      if (domainId === "repository") return deps.repositoryDispatch(action, params, context)
      if (domainId === "variable") return deps.variableDispatch(action, params, context)
      if (domainId === "workflow") return deps.workflowDispatch(action, params, context)
      throw new Error(`Unknown action: ${action}`)
    },
  }
}
