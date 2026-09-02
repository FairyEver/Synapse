import { z } from "zod"

export const connectorStatusSchema = z.enum(["available", "connecting", "connected", "error"])
export const connectorItemSchema = z.object({
  id: z.string().min(1),
  providerKey: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  endpoint: z.string().url(),
  authType: z.enum(["none", "oauth2"]),
  status: connectorStatusSchema,
  accountLabel: z.string().optional(),
  lastConnectedAt: z.string().optional(),
  errorMessage: z.string().optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
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
