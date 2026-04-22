import { dataStoreService } from "./service"
import { startHttpServer, stopHttpServer } from "./http-server"
import { registerDataStoreHandlers } from "./ipc-handlers"
import { getCliStatus, installCli } from "./cli-installer"
import { createMainLogger } from "../services/log-store"

const logger = createMainLogger("data-store")

async function initDataStore(): Promise<void> {
  logger.info("Initializing data store.")

  const { corrupted } = dataStoreService.open()
  if (corrupted) {
    logger.warn("Data store was corrupted and has been recreated.")
  }

  const port = await startHttpServer()
  logger.info("Data store HTTP server ready.", { port })

  registerDataStoreHandlers()

  if (!getCliStatus().installed) {
    try {
      await installCli()
    } catch (error) {
      logger.warn("Auto CLI install failed (non-fatal).", { error })
    }
  }

  logger.info("Data store initialized.")
}

async function shutdownDataStore(): Promise<void> {
  logger.info("Shutting down data store.")
  await stopHttpServer()
  dataStoreService.close()
  logger.info("Data store shut down.")
}

export { initDataStore, shutdownDataStore }
