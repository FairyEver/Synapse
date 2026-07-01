import { z } from "zod"

export const agentPersonaModelTierSchema = z.enum(["default", "haiku", "sonnet", "opus"])

export const agentPersonaProviderModelSchema = z.object({
  providerId: z.string().min(1),
  modelTier: agentPersonaModelTierSchema,
})

export const agentPersonaToolPolicySchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("all") }),
  z.object({ mode: z.literal("disabled") }),
  z.object({
    mode: z.literal("allowlist"),
    allowedTools: z.array(z.string().min(1)).default([]),
  }),
])

export const agentPersonaSourceSchema = z.enum(["builtin", "user"])
export const agentPersonaDesktopListStatusSchema = z.enum([
  "unauthenticated",
  "online",
  "offline-cache",
  "offline-empty",
])

export const agentPersonaSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.literal(1),
  name: z.string().min(1),
  description: z.string().min(1),
  systemPrompt: z.string().min(1),
  providerModel: agentPersonaProviderModelSchema.nullable(),
  toolPolicy: agentPersonaToolPolicySchema.nullable().optional(),
  source: agentPersonaSourceSchema,
  readonly: z.boolean().optional(),
  version: z.number().int().positive().optional(),
  createdAt: z.string().min(1).optional(),
  updatedAt: z.string().min(1).optional(),
})

export const agentPersonaCreateInputSchema = z.object({
  name: z.string(),
  description: z.string(),
  systemPrompt: z.string(),
  providerModel: agentPersonaProviderModelSchema.nullable().optional(),
  toolPolicy: agentPersonaToolPolicySchema.nullable().optional(),
})

export const agentPersonaUpdateInputSchema = agentPersonaCreateInputSchema.extend({
  id: z.string().min(1),
})

export const agentPersonaBuiltinModelUpdateInputSchema = z.object({
  id: z.string().min(1),
  providerModel: agentPersonaProviderModelSchema.nullable(),
  toolPolicy: agentPersonaToolPolicySchema.nullable().optional(),
})

export const agentPersonaIdInputSchema = z.object({
  id: z.string().min(1),
})

export const agentPersonaChangedEventSchema = z.object({
  result: z.object({
    status: agentPersonaDesktopListStatusSchema,
    items: z.array(agentPersonaSchema),
    syncedAt: z.string().min(1).optional(),
  }).optional(),
  items: z.array(agentPersonaSchema),
})

export const agentPersonaListResultSchema = z.object({
  status: agentPersonaDesktopListStatusSchema,
  items: z.array(agentPersonaSchema),
  syncedAt: z.string().min(1).optional(),
})

export type AgentPersonaModelTier = z.infer<typeof agentPersonaModelTierSchema>
export type AgentPersonaProviderModel = z.infer<typeof agentPersonaProviderModelSchema>
export type AgentPersonaToolPolicy = z.infer<typeof agentPersonaToolPolicySchema>
export type AgentPersona = z.infer<typeof agentPersonaSchema>
export type AgentPersonaListResult = z.infer<typeof agentPersonaListResultSchema>
export type AgentPersonaBuiltinModelUpdateInput = z.infer<typeof agentPersonaBuiltinModelUpdateInputSchema>
export type AgentPersonaCreateInput = z.infer<typeof agentPersonaCreateInputSchema>
export type AgentPersonaUpdateInput = z.infer<typeof agentPersonaUpdateInputSchema>
export type AgentPersonaIdInput = z.infer<typeof agentPersonaIdInputSchema>
export type AgentPersonaChangedEvent = z.infer<typeof agentPersonaChangedEventSchema>
