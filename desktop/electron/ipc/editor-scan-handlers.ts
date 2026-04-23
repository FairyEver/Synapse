import { scanAll } from "../services/editor-scan-service"
import { SYNAPSE_IPC_CHANNELS } from "./channels"
import { handleValidatedIpc } from "./validated-ipc"

let handlersRegistered = false

function registerEditorScanHandlers() {
  if (handlersRegistered) {
    return
  }

  handleValidatedIpc(
    SYNAPSE_IPC_CHANNELS.editorScan.scanAll,
    async () => scanAll(),
  )

  handlersRegistered = true
}

export { registerEditorScanHandlers }
