import {
  skillHubListInputSchema, skillHubMcpCreateInputSchema, skillHubMcpDeleteInputSchema,
  skillHubMcpDownloadInputSchema, skillHubMcpGetInputSchema, skillHubMcpPrepareInputSchema,
  skillHubMcpPublishInputSchema, skillHubMcpUpdateInputSchema, skillHubReceiptInputSchema, skillHubTeamQuerySchema,
} from "@synapse/shared/skill-hub-contracts"

export const skillHubActionSchemas = {
  "app.skill_hub.skill.list": skillHubListInputSchema,
  "app.skill_hub.skill.get": skillHubMcpGetInputSchema,
  "app.skill_hub.team.list": skillHubTeamQuerySchema,
  "app.skill_hub.package.download": skillHubMcpDownloadInputSchema,
  "app.skill_hub.package.prepare": skillHubMcpPrepareInputSchema,
  "app.skill_hub.skill.create": skillHubMcpCreateInputSchema,
  "app.skill_hub.version.create": skillHubMcpPublishInputSchema,
  "app.skill_hub.skill.update": skillHubMcpUpdateInputSchema,
  "app.skill_hub.skill.delete": skillHubMcpDeleteInputSchema,
  "app.skill_hub.receipt.get": skillHubReceiptInputSchema,
} as const

export type SkillHubAction = keyof typeof skillHubActionSchemas

export function isSkillHubAction(action: string): action is SkillHubAction {
  return Object.hasOwn(skillHubActionSchemas, action)
}
