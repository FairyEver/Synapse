import { scanAll, readItemContent, listSkillFiles } from "../services/editor-scan-service"
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

  handleValidatedIpc(
    SYNAPSE_IPC_CHANNELS.editorScan.readItemContent,
    async (_event, filePath: string) => readItemContent(filePath),
  )

  handleValidatedIpc(
    SYNAPSE_IPC_CHANNELS.editorScan.listSkillFiles,
    async (_event, dirPath: string) => listSkillFiles(dirPath),
  )

  handlersRegistered = true
}

export { registerEditorScanHandlers }
