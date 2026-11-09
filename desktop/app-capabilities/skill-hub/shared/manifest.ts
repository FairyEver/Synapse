import { z } from "zod"
import { SKILL_HUB_MCP_TOOL_ACTIONS } from "./capability"
import { skillHubAppDefinition } from "./app-definition"

export const HUB_INSTALL_HANDLER = "skill-hub.install"

export function parseSkillHubInstallLink(raw: string): string | null {
  const match = /^synapse:\/\/skill-hub\/install\?skillId=([A-Za-z0-9_-]{1,128})$/u.exec(raw)
  return match?.[0] === raw ? match[1] : null
}

export const skillHubCapabilityManifest = {
  id: "skill-hub",
  app: skillHubAppDefinition,
  deepLinks: [],
  capabilities: SKILL_HUB_MCP_TOOL_ACTIONS,
  protocolRoutes: [{
    hostname: "skill-hub",
    action: "install",
    mainHandlerId: HUB_INSTALL_HANDLER,
    paramsSchema: z.object({ deepLink: z.string().refine((raw) => parseSkillHubInstallLink(raw) !== null) }).strict(),
  }],
} as const
