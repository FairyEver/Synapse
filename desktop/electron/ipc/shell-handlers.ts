import { shell } from "electron"
import { SYNAPSE_IPC_CHANNELS } from "./channels"
import { onValidatedIpc } from "./validated-ipc"

let handlersRegistered = false

function registerShellHandlers() {
  if (handlersRegistered) {
    return
  }

  onValidatedIpc(
    SYNAPSE_IPC_CHANNELS.shell.showItemInFolder,
    async (_event, filePath: string) => {
      shell.showItemInFolder(filePath)
    },
  )

  handlersRegistered = true
}

export { registerShellHandlers }
