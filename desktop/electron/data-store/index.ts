import type { EventBus } from "../runtime/event-bus"
import type { SynapseActionRouter } from "../capabilities/action-router"
import { dataStoreService } from "./service"
import { startHttpServer, stopHttpServer } from "./http-server"
import { startMcpServer, stopMcpServer } from "./mcp-server"
import { registerDataStoreHandlers } from "./ipc-handlers"
import { getCliStatus, installCli } from "./cli-installer"
import { autoRegisterMcp } from "./mcp-installer"
import { setDataStoreChangeListener } from "./dispatcher"
import { createMainLogger } from "../services/log-store"

const logger = createMainLogger("data-store")

async function initDataStore(eventBus: EventBus | undefined, actionRouter: SynapseActionRouter): Promise<void> {
  logger.info("Initializing data store.")

  const { corrupted } = dataStoreService.open()
  if (corrupted) {
    logger.warn("Data store was corrupted and has been recreated.")
  }

  const port = await startHttpServer(actionRouter)
  logger.info("Data store HTTP server ready.", { port })

  let mcpPort = 0
  try {
    mcpPort = await startMcpServer(actionRouter)
    logger.info("MCP HTTP server ready.", { port: mcpPort })
  } catch (error) {
    logger.warn("MCP HTTP server failed to start (non-fatal).", { error })
  }

  registerDataStoreHandlers()

  // Use EventBus if provided, otherwise skip broadcasting (for tests/CLI mode)
  if (eventBus) {
    setDataStoreChangeListener((event) => {
      eventBus.emit({
        domain: "data-store",
        type: "data-store.changed",
        payload: event,
        timestamp: new Date().toISOString(),
      })
    })
  }

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
  setDataStoreChangeListener(null)
  await stopMcpServer()
  await stopHttpServer()
  dataStoreService.close()
  logger.info("Data store shut down.")
}

export { initDataStore, shutdownDataStore }
