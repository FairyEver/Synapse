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
  readonly contentDispatch: DomainDispatch
  readonly databaseDispatch: DomainDispatch
  readonly modelPriceDispatch: DomainDispatch
  readonly schedulerDispatch: DomainDispatch
  readonly workflowDispatch: DomainDispatch
}

export function createSynapseActionRouter(deps: SynapseActionRouterDeps): SynapseActionRouter {
  return {
    async dispatch(action, params, context) {
      const domainId = getActionDomainId(action)
      if (domainId === "content") return deps.contentDispatch(action, params, context)
      if (domainId === "database") return deps.databaseDispatch(action, params, context)
      if (domainId === "model_price") return deps.modelPriceDispatch(action, params, context)
      if (domainId === "scheduler") return deps.schedulerDispatch(action, params, context)
      if (domainId === "workflow") return deps.workflowDispatch(action, params, context)
      throw new Error(`Unknown action: ${action}`)
    },
  }
}
