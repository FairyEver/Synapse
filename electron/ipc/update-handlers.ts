import { createMainLogger } from "../services/log-store"
import { updateService } from "../services/update-service"
import { SYNAPSE_IPC_CHANNELS } from "./channels"
import { handleValidatedIpc } from "./validated-ipc"

let handlersRegistered = false
const logger = createMainLogger("ipc.update")

function registerUpdateHandlers(): void {
  if (handlersRegistered) {
    return
  }

  handleValidatedIpc(SYNAPSE_IPC_CHANNELS.update.getState, async () => {
    logger.debug("Handling update.getState request.")
    return updateService.getState()
  })

  handleValidatedIpc(SYNAPSE_IPC_CHANNELS.update.checkForUpdates, async () => {
    logger.info("Handling update.checkForUpdates request.")
    return updateService.checkForUpdates()
  })

  handleValidatedIpc(SYNAPSE_IPC_CHANNELS.update.cancelDownload, async () => {
    logger.info("Handling update.cancelDownload request.")
    await updateService.cancelDownload()
  })

  handleValidatedIpc(SYNAPSE_IPC_CHANNELS.update.installUpdate, async () => {
    logger.info("Handling update.installUpdate request.")
    await updateService.installUpdate()
  })

  handlersRegistered = true
}

export { registerUpdateHandlers }
