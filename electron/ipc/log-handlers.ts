import { BrowserWindow } from "electron"
import type { SynapseLogListQuery, SynapseRendererLogPayload } from "../../src/types/log"
import { SYNAPSE_IPC_CHANNELS } from "./channels"
import { handleValidatedIpc, isTrustedRendererContents, onValidatedIpc } from "./validated-ipc"
import { createMainLogger, logStore } from "../services/log-store"

let handlersRegistered = false
const logger = createMainLogger("ipc.log")

function registerLogHandlers() {
  if (handlersRegistered) {
    return
  }

  handleValidatedIpc(SYNAPSE_IPC_CHANNELS.log.summary, async () => logStore.getSummary())
  handleValidatedIpc(
    SYNAPSE_IPC_CHANNELS.log.list,
    async (_event, query: SynapseLogListQuery) => logStore.list(query),
  )
  onValidatedIpc(
    SYNAPSE_IPC_CHANNELS.log.write,
    async (_event, payload: SynapseRendererLogPayload) => {
      logStore.write({
        source: "renderer",
        level: payload.level,
        category: payload.category,
        message: payload.message,
        details: payload.details,
      })
    },
  )
  handleValidatedIpc(SYNAPSE_IPC_CHANNELS.log.export, async () => {
    logger.info("Exporting log file to Downloads.")
    const result = await logStore.exportToDownloads()
    logger.info("Log file exported.", result)

    return result
  })

  logStore.onAppended((event) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed() && isTrustedRendererContents(window.webContents)) {
        window.webContents.send(SYNAPSE_IPC_CHANNELS.log.appended, event)
      }
    }
  })

  handlersRegistered = true
}

export { registerLogHandlers }
