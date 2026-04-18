import { SYNAPSE_IPC_CHANNELS } from "./channels"
import { handleValidatedIpc } from "./validated-ipc"
import { userIdentityService } from "../services/user-identity-service"

let handlersRegistered = false

function registerIdentityHandlers() {
  if (handlersRegistered) {
    return
  }

  handleValidatedIpc(SYNAPSE_IPC_CHANNELS.identity.getState, async () => {
    return userIdentityService.loadState()
  })

  handleValidatedIpc(
    SYNAPSE_IPC_CHANNELS.identity.updateDisplayName,
    async (_event, displayName: string) => userIdentityService.updateDisplayName(displayName),
  )

  handleValidatedIpc(
    SYNAPSE_IPC_CHANNELS.identity.replaceUserId,
    async (_event, userId: string) => userIdentityService.replaceUserId(userId),
  )

  handleValidatedIpc(SYNAPSE_IPC_CHANNELS.identity.generateNewId, async () => {
    return userIdentityService.generateNewIdentity()
  })

  handlersRegistered = true
}

export { registerIdentityHandlers }
