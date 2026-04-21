import { detectClis } from "../services/cli/cli-detect-service"
import { SYNAPSE_IPC_CHANNELS } from "./channels"
import { handleValidatedIpc } from "./validated-ipc"

let handlersRegistered = false

function registerCliHandlers() {
  if (handlersRegistered) {
    return
  }

  handleValidatedIpc(
    SYNAPSE_IPC_CHANNELS.cli.detect,
    async () => detectClis(),
  )

  handlersRegistered = true
}

export { registerCliHandlers }
