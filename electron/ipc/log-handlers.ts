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

  handleValidatedIpc(SYNAPSE_IPC_CHANNELS.log.export, async () => {
    logger.info("Exporting all log files.")
    const result = await logStore.exportAllLogs()
    logger.info("Log files exported.", result)

    return result
  })

  handlersRegistered = true
}

export { registerLogHandlers }
