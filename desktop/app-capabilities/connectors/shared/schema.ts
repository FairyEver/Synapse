import { z } from "zod"

export const connectorProbeStatusSchema = z.enum(["idle", "checking", "ready", "error"])
export const connectorItemSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  documentationUrl: z.string().url().optional(),
  enabled: z.boolean(),
  probeStatus: connectorProbeStatusSchema,
  errorMessage: z.string().optional(),
})
export const connectorCredentialSchema = z.object({
  id: z.string().min(1),
  accessToken: z.string().min(1),
  refreshToken: z.string().optional(),
  expiresAt: z.number().optional(),
  tokenType: z.string().optional(),
  scope: z.string().optional(),
  updatedAt: z.string().min(1),
})
export const connectorListResultSchema = z.object({ items: z.array(connectorItemSchema) })
export const connectorIdInputSchema = z.object({ id: z.string().min(1) })
export const connectorChangedEventSchema = connectorListResultSchema

export type ConnectorItem = z.infer<typeof connectorItemSchema>
export type ConnectorCredential = z.infer<typeof connectorCredentialSchema>
export type ConnectorListResult = z.infer<typeof connectorListResultSchema>
export type ConnectorIdInput = z.infer<typeof connectorIdInputSchema>
