import { app, BrowserWindow, dialog } from "electron"
import path from "node:path"
import type { SynapseRendererLogPayload } from "../../src/types/log"
import { SYNAPSE_IPC_CHANNELS } from "./channels"
import { handleValidatedIpc, onValidatedIpc } from "./validated-ipc"
import { createMainLogger, logStore } from "../services/log-store"

let handlersRegistered = false
const logger = createMainLogger("ipc.log")

function registerLogHandlers() {
  if (handlersRegistered) {
    return
  }

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

  handleValidatedIpc(SYNAPSE_IPC_CHANNELS.log.export, async (event) => {
    logger.info("Exporting all log files.")

    const ownerWindow = BrowserWindow.fromWebContents(event.sender)
    const defaultName = `synapse-logs-${new Date().toISOString().replace(/[:.]/g, "-")}.zip`
    const dialogResult = ownerWindow
      ? await dialog.showSaveDialog(ownerWindow, {
          defaultPath: path.join(app.getPath("downloads"), defaultName),
          filters: [{ name: "ZIP", extensions: ["zip"] }],
        })
      : await dialog.showSaveDialog({
          defaultPath: path.join(app.getPath("downloads"), defaultName),
          filters: [{ name: "ZIP", extensions: ["zip"] }],
        })

    if (dialogResult.canceled || !dialogResult.filePath) {
      return { fileCount: 0, filePath: "" }
    }

    const result = await logStore.exportAllLogs(dialogResult.filePath)
    logger.info("Log files exported.", result)

    return result
  })

  handleValidatedIpc(SYNAPSE_IPC_CHANNELS.log.clear, async () => {
    logger.warn("Clearing all local log files.")
    const result = await logStore.clearAllLogs()
    logger.info("Local log files cleared.", result)

    return result
  })

  handleValidatedIpc(SYNAPSE_IPC_CHANNELS.log.readAll, async () => {
    logger.info("Reading all log files for clipboard copy.")
    return logStore.readAllLogs()
  })

  handleValidatedIpc(SYNAPSE_IPC_CHANNELS.log.listFiles, async () => {
    return logStore.listLogFilesInfo()
  })

  handleValidatedIpc(
    SYNAPSE_IPC_CHANNELS.log.readFiles,
    async (_event, fileNames: string[]) => {
      return logStore.readLogsByNames(fileNames)
    },
  )

  handlersRegistered = true
}

export { registerLogHandlers }
