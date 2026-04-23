import { dataStoreService } from "./service"
import { startHttpServer, stopHttpServer } from "./http-server"
import { startMcpServer, stopMcpServer, getMcpServerPort } from "./mcp-server"
import { registerDataStoreHandlers } from "./ipc-handlers"
import { getCliStatus, installCli } from "./cli-installer"
import { autoRegisterMcp } from "./mcp-installer"
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

  let mcpPort = 0
  try {
    mcpPort = await startMcpServer()
    logger.info("MCP HTTP server ready.", { port: mcpPort })
  } catch (error) {
    logger.warn("MCP HTTP server failed to start (non-fatal).", { error })
  }

  registerDataStoreHandlers()

  if (!(await getCliStatus()).installed) {
    try {
      await installCli()
    } catch (error) {
      logger.warn("Auto CLI install failed (non-fatal).", { error })
    }
  }

  if (mcpPort > 0) {
    try {
      autoRegisterMcp(mcpPort)
    } catch (error) {
      logger.warn("MCP auto-registration failed (non-fatal).", { error })
    }
  }

  logger.info("Data store initialized.")
}

async function shutdownDataStore(): Promise<void> {
  logger.info("Shutting down data store.")
  await stopMcpServer()
  await stopHttpServer()
  dataStoreService.close()
  logger.info("Data store shut down.")
}

export { initDataStore, shutdownDataStore }
