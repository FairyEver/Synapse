import { SYNAPSE_IPC_CHANNELS } from "./channels"
import { handleValidatedIpc } from "./validated-ipc"
import { configStore } from "../services/config-store"
import { contentIndexService } from "../services/content-index-service"
import { userIdentityService } from "../services/user-identity-service"
import { userProfileService } from "../services/user-profile-service"

let handlersRegistered = false

function registerUserProfileHandlers() {
  if (handlersRegistered) {
    return
  }

  handleValidatedIpc(
    SYNAPSE_IPC_CHANNELS.userProfile.getRepoState,
    async (_event, args: { repoId: string }) => {
      const localIdentityState = await userIdentityService.loadLocalIdentity()

      if (localIdentityState.status !== "ready") {
        throw new Error("身份 ID 无法读取，请先在设置页恢复身份。")
      }

      return userProfileService.loadRepoProfileState(args.repoId, localIdentityState.identity.userId)
    },
  )

  handleValidatedIpc(
    SYNAPSE_IPC_CHANNELS.userProfile.listRepoProfiles,
    async (_event, args: { repoId: string }) => {
      return userProfileService.listRepoProfiles(args.repoId)
    },
  )

  handleValidatedIpc(
    SYNAPSE_IPC_CHANNELS.userProfile.updateDisplayName,
    async (_event, args: { repoId: string; displayName: string }) => {
      const localIdentityState = await userIdentityService.loadLocalIdentity()

      if (localIdentityState.status !== "ready") {
        throw new Error("身份 ID 无法读取，请先在设置页恢复身份。")
      }

      const nextProfile = await userProfileService.updateDisplayName(
        args.repoId,
        localIdentityState.identity.userId,
        args.displayName,
      )
      const config = await configStore.load()
      const repository = config.repositories.find((item) => item.uuid === args.repoId)

      if (repository) {
        await contentIndexService.syncIndex(repository)
      }

      return nextProfile
    },
  )

  handlersRegistered = true
}

export { registerUserProfileHandlers }
