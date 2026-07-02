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
  readonly skillRepositoryDispatch?: DomainDispatch
  readonly variableDispatch: DomainDispatch
  readonly workflowDispatch: DomainDispatch
}

export function createSynapseActionRouter(deps: SynapseActionRouterDeps): SynapseActionRouter {
  return {
    async dispatch(action, params, context) {
      const domainId = resolveActionDomainId(action)
      const dispatchAction = legacyDispatchAction(action, domainId)
      if (domainId === "app") return deps.appDispatch(dispatchAction, params, context)
      if (domainId === "automation") return deps.automationDispatch(dispatchAction, params, context)
      if (domainId === "content") return deps.contentDispatch(dispatchAction, params, context)
      if (domainId === "database") return deps.databaseDispatch(dispatchAction, params, context)
      if (domainId === "drive") return deps.driveDispatch(dispatchAction, params, context)
      if (domainId === "model_price") return deps.modelPriceDispatch(dispatchAction, params, context)
      if (domainId === "repository") return deps.repositoryDispatch(dispatchAction, params, context)
      if (domainId === "skill_repository") {
        if (!deps.skillRepositoryDispatch) throw new Error("Skill repository dispatcher is not configured")
        return deps.skillRepositoryDispatch(dispatchAction, params, context)
      }
      if (domainId === "variable") return deps.variableDispatch(dispatchAction, params, context)
      if (domainId === "workflow") return deps.workflowDispatch(dispatchAction, params, context)
      throw new Error(`Unknown action: ${action}`)
    },
  }
}

function resolveActionDomainId(action: string): string | null {
  const canonicalDomainId = getActionDomainId(action)
  if (canonicalDomainId) return canonicalDomainId
  return getActionDomainId(primaryActionForLegacy(action))
}

function primaryActionForLegacy(action: string): string {
  if (action.startsWith("automation.")) return action.replace("automation.", "app.automation.")
  if (action.startsWith("content.")) return action.replace("content.", "app.resource_repository.")
  if (action.startsWith("database.")) return action.replace("database.", "app.database.")
  if (action.startsWith("drive.")) return action.replace("drive.", "app.drive.")
  if (action.startsWith("model_price.")) return action.replace("model_price.", "app.model_price.")
  if (action.startsWith("repository.")) return action.replace("repository.", "app.settings.repository.")
  if (action.startsWith("variable.")) return action.replace("variable.", "app.settings.variable.")
  if (action.startsWith("workflow.")) return action.replace("workflow.", "app.workflow.")
  return action
}

function legacyDispatchAction(action: string, domainId: string | null): string {
  if (!action.startsWith("app.")) return action

  switch (domainId) {
    case "automation":
      return action.replace("app.automation.", "automation.")
    case "content":
      return action.replace("app.resource_repository.", "content.")
    case "database":
      return action.replace("app.database.", "database.")
    case "drive":
      return action.replace("app.drive.", "drive.")
    case "model_price":
      return action.replace("app.model_price.", "model_price.")
    case "repository":
      return action.replace("app.settings.repository.", "repository.")
    case "skill_repository":
      return action
    case "variable":
      return action.replace("app.settings.variable.", "variable.")
    case "workflow":
      return action.replace("app.workflow.", "workflow.")
    default:
      return action
  }
}
