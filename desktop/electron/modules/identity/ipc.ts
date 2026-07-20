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
  schemaVersion: z.literal(2),
  userId: z.string(),
  generatedAt: z.string(),
})

const localIdentityStateSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ready"),
    identity: localIdentitySchema,
  }),
  z.object({
    status: z.literal("needs-recovery"),
    invalidUserId: z.string().nullable(),
  }),
])

const adoptIdentityRequestSchema = z.object({
  repoId: z.string(),
  userId: z.string(),
})

export const identityIpcModule: IpcModule = {
  id: "identity",
  methods: {
    getLocalState: {
      kind: "invoke",
      operationId: "app.identity.operation.get_local_state",
      request: z.void(),
      response: localIdentityStateSchema,
      handler: async (_ctx) => {
        return userIdentityService.loadLocalIdentity()
      },
    },
    adoptExistingUserId: {
      kind: "invoke",
      operationId: "app.identity.operation.adopt_existing_user_id",
      request: adoptIdentityRequestSchema,
      response: localIdentityStateSchema,
      handler: async (_ctx, request: { repoId: string; userId: string }) => {
        return userIdentityService.adoptExistingUserId(request.userId, request.repoId)
      },
    },
    generateNewId: {
      kind: "invoke",
      operationId: "app.identity.operation.generate_new_id",
      request: z.void(),
      response: localIdentityStateSchema,
      handler: async (_ctx) => {
        return userIdentityService.generateNewIdentity()
      },
    },
  },
  events: {},
}
