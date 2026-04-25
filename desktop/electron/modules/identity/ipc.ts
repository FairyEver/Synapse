/**
 * Phase 0.3 — Identity IpcModule.
 * SPEC §6 Step 3.
 *
 * Replaces electron/ipc/identity-handlers.ts with IpcModule.
 */

import { z } from "zod"
import type { IpcModule } from "../../runtime/ipc/types"
import { userIdentityService } from "../../services/user-identity-service"

// Schemas
const localIdentitySchema = z.object({
  userId: z.string(),
  displayName: z.string(),
  avatarPath: z.string().nullable(),
})

const adoptIdentityRequestSchema = z.object({
  repoId: z.string(),
  userId: z.string(),
})

const adoptIdentityResponseSchema = z.object({
  success: z.boolean(),
  userId: z.string(),
})

export const identityIpcModule: IpcModule = {
  id: "identity",
  methods: {
    getLocalState: {
      kind: "invoke",
      channel: "synapse:identity:get-local-state",
      request: z.void(),
      response: localIdentitySchema,
      handler: async (_ctx) => {
        return userIdentityService.loadLocalIdentity()
      },
    },
    adoptExistingUserId: {
      kind: "invoke",
      channel: "synapse:identity:adopt-existing-user-id",
      request: adoptIdentityRequestSchema,
      response: adoptIdentityResponseSchema,
      handler: async (_ctx, request: { repoId: string; userId: string }) => {
        return userIdentityService.adoptExistingUserId(request.userId, request.repoId)
      },
    },
    generateNewId: {
      kind: "invoke",
      channel: "synapse:identity:generate-new-id",
      request: z.void(),
      response: localIdentitySchema,
      handler: async (_ctx) => {
        return userIdentityService.generateNewIdentity()
      },
    },
  },
  events: {},
}
