import { z } from "zod"

export const HUB_INSTALLER_VIEW = "skill-installer"
export const HUB_INSTALL_REQUEST_PARAM = "skillHubInstallOpenRequest"
export const HUB_INSTALL_SOURCE_PREFIX = "skill-hub-install:"
export const HUB_SOURCE_IDENTITY_PREFIX = "skill-hub:"
export const isHubSourceIdentity = (value: string) => /^skill-hub:[a-f0-9]{64}:[A-Za-z0-9_-]{1,128}$/u.test(value) && value === value.trim()

export const hubInstallSkillIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u).refine((v) => v === v.trim())
export const hubInstallOpenRequestSchema = z.object({
  requestId: z.string().uuid(),
  skillId: hubInstallSkillIdSchema,
}).strict()
export type HubInstallOpenRequest = z.infer<typeof hubInstallOpenRequestSchema>
