import type { SynapseCreateRulePayload } from "@/types/content"

export type CreateRulePayload = SynapseCreateRulePayload

export type RuleCreateFieldName = keyof CreateRulePayload

export type RuleCreateFieldErrors = Partial<Record<RuleCreateFieldName, string>>
