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
  readonly assertFileAccess?: (params: Record<string, unknown>) => Promise<void>
  readonly appDispatch: DomainDispatch
  readonly automationDispatch: DomainDispatch
  readonly contentDispatch: DomainDispatch
  readonly databaseDispatch: DomainDispatch
  readonly driveDispatch: DomainDispatch
  readonly mailDispatch?: DomainDispatch
  readonly mailInternalDispatch: DomainDispatch
  readonly todosDispatch?: DomainDispatch
  readonly wecomDispatch?: DomainDispatch
  readonly modelPriceDispatch: DomainDispatch
  readonly repositoryDispatch: DomainDispatch
  readonly skillRepositoryDispatch?: DomainDispatch
  readonly workflowDispatch: DomainDispatch
}

export function createSynapseActionRouter(deps: SynapseActionRouterDeps): SynapseActionRouter {
  return {
    async dispatch(action, params, context) {
      try { await deps.assertFileAccess?.(params) } catch {
        return { ok: false, code: "PERMISSION_DENIED", error: "Synapse 私有存储不允许直接访问，请使用当前登录用户的邮箱工具。" }
      }
      const domainId = resolveActionDomainId(action)
      if (domainId === "app") return deps.appDispatch(action, params, context)
      if (domainId === "automation") return deps.automationDispatch(action, params, context)
      if (domainId === "content") return deps.contentDispatch(action, params, context)
      if (domainId === "database") return deps.databaseDispatch(action, params, context)
      if (domainId === "drive") return deps.driveDispatch(action, params, context)
      if (domainId === "mail") { if (!deps.mailDispatch) throw new Error("Mail dispatcher is not configured"); return deps.mailDispatch(action, params, context) }
      if (domainId === "mail_internal") return deps.mailInternalDispatch(action, params, context)
      if (domainId === "todos") {
        if (!deps.todosDispatch) throw new Error("Todo dispatcher is not configured")
        return deps.todosDispatch(action, params, context)
      }
      if (domainId === "wecom") {
        if (!deps.wecomDispatch) throw new Error("WeCom dispatcher is not configured")
        return deps.wecomDispatch(action, params, context)
      }
      if (domainId === "model_price") return deps.modelPriceDispatch(action, params, context)
      if (domainId === "repository") return deps.repositoryDispatch(action, params, context)
      if (domainId === "skill_repository") {
        if (!deps.skillRepositoryDispatch) throw new Error("Skill repository dispatcher is not configured")
        return deps.skillRepositoryDispatch(action, params, context)
      }
      if (domainId === "workflow") return deps.workflowDispatch(action, params, context)
      throw new Error(`Unknown action: ${action}`)
    },
  }
}

function resolveActionDomainId(action: string): string | null {
  return getActionDomainId(action)
}
