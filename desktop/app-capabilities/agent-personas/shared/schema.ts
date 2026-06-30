import { z } from "zod"

export const agentPersonaModelTierSchema = z.enum(["default", "haiku", "sonnet", "opus"])

export const agentPersonaProviderModelSchema = z.object({
  providerId: z.string().min(1),
  modelTier: agentPersonaModelTierSchema,
})

export const agentPersonaSourceSchema = z.enum(["builtin", "user"])

export const agentPersonaSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.literal(1),
  name: z.string().min(1),
  description: z.string().min(1),
  systemPrompt: z.string().min(1),
  providerModel: agentPersonaProviderModelSchema.nullable(),
  source: agentPersonaSourceSchema,
  readonly: z.boolean().optional(),
  createdAt: z.string().min(1).optional(),
  updatedAt: z.string().min(1).optional(),
})

export const agentPersonaCreateInputSchema = z.object({
  name: z.string(),
  description: z.string(),
  systemPrompt: z.string(),
  providerModel: agentPersonaProviderModelSchema.nullable().optional(),
})

export const agentPersonaUpdateInputSchema = agentPersonaCreateInputSchema.extend({
  id: z.string().min(1),
})

export const agentPersonaBuiltinModelUpdateInputSchema = z.object({
  id: z.string().min(1),
  providerModel: agentPersonaProviderModelSchema.nullable(),
})

export const agentPersonaIdInputSchema = z.object({
  id: z.string().min(1),
})

export const agentPersonaChangedEventSchema = z.object({
  items: z.array(agentPersonaSchema),
})

export type AgentPersonaModelTier = z.infer<typeof agentPersonaModelTierSchema>
export type AgentPersonaProviderModel = z.infer<typeof agentPersonaProviderModelSchema>
export type AgentPersona = z.infer<typeof agentPersonaSchema>
export type AgentPersonaBuiltinModelUpdateInput = z.infer<typeof agentPersonaBuiltinModelUpdateInputSchema>
export type AgentPersonaCreateInput = z.infer<typeof agentPersonaCreateInputSchema>
export type AgentPersonaUpdateInput = z.infer<typeof agentPersonaUpdateInputSchema>
export type AgentPersonaIdInput = z.infer<typeof agentPersonaIdInputSchema>
export type AgentPersonaChangedEvent = z.infer<typeof agentPersonaChangedEventSchema>
