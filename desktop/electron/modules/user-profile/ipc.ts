/**
 * Phase 0.3 — User Profile IpcModule.
 * SPEC §6 Step 3.
 *
 * Replaces electron/ipc/user-profile-handlers.ts with IpcModule.
 */

import { z } from "zod"
import type { IpcModule } from "../../runtime/ipc/types"
import { configStore } from "../../services/config-store"
import { contentIndexService } from "../../services/content-index-service"
import { userIdentityService } from "../../services/user-identity-service"
import { userProfileService } from "../../services/user-profile-service"

// Schemas
const repoProfileStateSchema = z.object({
  userId: z.string(),
  displayName: z.string(),
  avatarPath: z.string().nullable(),
})

const listRepoProfilesResponseSchema = z.array(
  z.object({
    userId: z.string(),
    displayName: z.string(),
    avatarPath: z.string().nullable(),
  }),
)

const updateDisplayNameRequestSchema = z.object({
  repoId: z.string(),
  displayName: z.string(),
})

export const userProfileIpcModule: IpcModule = {
  id: "user-profile",
  methods: {
    getRepoState: {
      kind: "invoke",
      channel: "synapse:user-profile:get-repo-state",
      request: z.object({ repoId: z.string() }),
      response: repoProfileStateSchema,
      handler: async (_ctx, request: { repoId: string }) => {
        const localIdentityState = await userIdentityService.loadLocalIdentity()

        if (localIdentityState.status !== "ready") {
          throw new Error("身份 ID 无法读取，请先在设置页恢复身份。")
        }

        return userProfileService.loadRepoProfileState(request.repoId, localIdentityState.identity.userId)
      },
    },
    listRepoProfiles: {
      kind: "invoke",
      channel: "synapse:user-profile:list-repo-profiles",
      request: z.object({ repoId: z.string() }),
      response: listRepoProfilesResponseSchema,
      handler: async (_ctx, request: { repoId: string }) => {
        return userProfileService.listRepoProfiles(request.repoId)
      },
    },
    updateDisplayName: {
      kind: "invoke",
      channel: "synapse:user-profile:update-display-name",
      request: updateDisplayNameRequestSchema,
      response: repoProfileStateSchema,
      handler: async (_ctx, request: { repoId: string; displayName: string }) => {
        const localIdentityState = await userIdentityService.loadLocalIdentity()

        if (localIdentityState.status !== "ready") {
          throw new Error("身份 ID 无法读取，请先在设置页恢复身份。")
        }

        const nextProfile = await userProfileService.updateDisplayName(
          request.repoId,
          localIdentityState.identity.userId,
          request.displayName,
        )
        const config = await configStore.load()
        const repository = config.repositories.find((item: { uuid: string }) => item.uuid === request.repoId)

        if (repository) {
          await contentIndexService.syncIndex(repository)
        }

        return nextProfile
      },
    },
  },
  events: {},
}
