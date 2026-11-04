import { randomUUID } from "node:crypto"
import { HUB_INSTALL_HANDLER, parseSkillHubInstallLink } from "../../app-capabilities/skill-hub/shared/manifest"
import type { HubInstallOpenRequest } from "../../app-capabilities/skill-hub/shared/install-source"

export function createSkillHubProtocolHandlers(open: (request: HubInstallOpenRequest) => Promise<void>) {
  return {
    async [HUB_INSTALL_HANDLER](params: Record<string, unknown>) {
      const skillId = typeof params.deepLink === "string" ? parseSkillHubInstallLink(params.deepLink) : null
      if (!skillId) throw new Error("Skill Hub 安装链接无效。")
      await open({ requestId: randomUUID(), skillId })
    },
  }
}
