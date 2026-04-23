import { SYNAPSE_IPC_CHANNELS } from "./channels"
import { handleValidatedIpc } from "./validated-ipc"
import { userIdentityService } from "../services/user-identity-service"

let handlersRegistered = false

function registerIdentityHandlers() {
  if (handlersRegistered) {
    return
  }

  handleValidatedIpc(SYNAPSE_IPC_CHANNELS.identity.getLocalState, async () => {
    return userIdentityService.loadLocalIdentity()
  })

  handleValidatedIpc(
    SYNAPSE_IPC_CHANNELS.identity.adoptExistingUserId,
    async (_event, args: { repoId: string; userId: string }) =>
      userIdentityService.adoptExistingUserId(args.userId, args.repoId),
  )

  handleValidatedIpc(SYNAPSE_IPC_CHANNELS.identity.generateNewId, async () => {
    return userIdentityService.generateNewIdentity()
  })

  handlersRegistered = true
}

export { registerIdentityHandlers }
