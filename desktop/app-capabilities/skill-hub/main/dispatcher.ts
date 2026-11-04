import { skillHubIdSchema } from "@synapse/shared/skill-hub-contracts"
import { SYNAPSE_DESKTOP_DEPLOYMENT_CONFIG } from "../../../electron/generated/deployment-config.generated"
import { mcpClientActorForSource, type DispatchContext, type DispatchResult } from "../../../synapse-capabilities/shared/types"
import { isSkillHubAction, skillHubActionSchemas, type SkillHubAction } from "../shared/schema"
import type { SkillHubCaller } from "./access"
import { SkillHubDesktopError } from "./error"
import type { DesktopSkillHubService } from "./service"

function skillIdFromReference(reference: string): string {
  try {
    const url = new URL(reference)
    const configured = new URL(SYNAPSE_DESKTOP_DEPLOYMENT_CONFIG.publicAppUrl)
    const match = /^\/console\/skill-hub\/([A-Za-z0-9_-]+)\/?$/.exec(url.pathname)
    if (url.origin !== configured.origin || url.username || url.password || !match) throw new Error("Invalid reference")
    return skillHubIdSchema.parse(match[1])
  } catch {
    throw new SkillHubDesktopError("HUB_INVALID_INPUT", "请提供 Skill ID 或当前 Synapse 的 Skill Hub 详情链接。")
  }
}

function execute(service: DesktopSkillHubService, action: SkillHubAction, params: unknown, caller: SkillHubCaller) {
  switch (action) {
    case "app.skill_hub.skill.list": return service.list(skillHubActionSchemas[action].parse(params), caller)
    case "app.skill_hub.skill.get": {
      const input = skillHubActionSchemas[action].parse(params)
      return service.get(input.skillId ?? skillIdFromReference(input.reference!), caller)
    }
    case "app.skill_hub.team.list": return service.teams(skillHubActionSchemas[action].parse(params), caller)
    case "app.skill_hub.package.download": return service.download(skillHubActionSchemas[action].parse(params), caller)
    case "app.skill_hub.package.prepare": return service.prepare(skillHubActionSchemas[action].parse(params), caller)
    case "app.skill_hub.skill.create": return service.create(skillHubActionSchemas[action].parse(params), caller)
    case "app.skill_hub.version.create": return service.publish(skillHubActionSchemas[action].parse(params), caller)
    case "app.skill_hub.skill.update": return service.update(skillHubActionSchemas[action].parse(params), caller)
    case "app.skill_hub.skill.delete": return service.delete(skillHubActionSchemas[action].parse(params), caller)
    case "app.skill_hub.receipt.get": return service.getReceipt(skillHubActionSchemas[action].parse(params), caller)
  }
}

export function createSkillHubCapabilityDispatcher({ service }: { service: DesktopSkillHubService }) {
  return {
    async dispatch(action: string, params: Record<string, unknown>, context: DispatchContext): Promise<DispatchResult> {
      if (!isSkillHubAction(action)) return { ok: false, code: "HUB_UNKNOWN_ACTION", error: "此 Skill Hub 操作不可用。" }
      if (!skillHubActionSchemas[action].safeParse(params).success) {
        return { ok: false, code: "HUB_INVALID_INPUT", error: "Skill Hub 请求参数无效。" }
      }
      const source = context.source ?? "api"
      const actor = context.actor ?? (source === "mcp-http" || source === "mcp-stdio"
        ? mcpClientActorForSource(source)
        : undefined)
      if (!actor) return { ok: false, code: "HUB_CALLER_REQUIRED", error: "无法确认 Skill Hub 调用者。" }
      const caller: SkillHubCaller = { actor, clientId: context.clientId ?? `${source}:${actor.kind}:${actor.id ?? ""}`, signal: context.abortSignal }
      try {
        const value = await execute(service, action, params, caller)
        return { ok: true, data: { externalData: true, value } }
      } catch (error) {
        if (error instanceof SkillHubDesktopError) return { ok: false, code: error.code, error: error.message, data: error.data }
        return { ok: false, code: "HUB_OPERATION_FAILED", error: "Skill Hub 操作未完成。" }
      }
    },
  }
}
