export type CreateRulePayload = {
  title: string
  description: string
  category: string
  icon: string
  iconBg: string
  content: string
}

export type RuleCreateFieldName = keyof CreateRulePayload

export type RuleCreateFieldErrors = Partial<Record<RuleCreateFieldName, string>>
