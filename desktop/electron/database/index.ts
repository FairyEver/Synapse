import type { EventBus } from "../runtime/event-bus"
import type { SynapseActionRouter } from "../capabilities/action-router"
import type { AuditSink, PermissionGuard } from "../runtime/security"
import { databaseService } from "./service"
import { startHttpServer, stopHttpServer } from "./http-server"
import { startMcpServer, stopMcpServer } from "./mcp-server"
import { registerDatabaseHandlers, setSecurity } from "./ipc-handlers"
import { getCliStatus, installCli } from "./cli-installer"
import { autoRegisterMcp } from "./mcp-installer"
import { setDatabaseChangeListener } from "./dispatcher"
import { createMainLogger } from "../services/log-store"

const logger = createMainLogger("database")

async function initDatabase(
  eventBus: EventBus | undefined,
  actionRouter: SynapseActionRouter,
  security?: { permissionGuard: PermissionGuard; auditSink: AuditSink },
): Promise<void> {
  logger.info("Initializing database.")

  const { corrupted } = databaseService.open()
  if (corrupted) {
    logger.warn("Database was corrupted and has been recreated.")
  }

  const port = await startHttpServer(actionRouter)
  logger.info("Database HTTP server ready.", { port })

  let mcpPort = 0
  try {
    mcpPort = await startMcpServer(actionRouter)
    logger.info("MCP HTTP server ready.", { port: mcpPort })
  } catch (error) {
    logger.warn("MCP HTTP server failed to start (non-fatal).", { error })
  }

  setSecurity(security?.permissionGuard, security?.auditSink)
  registerDatabaseHandlers()

  // Use EventBus if provided, otherwise skip broadcasting (for tests/CLI mode)
  if (eventBus) {
    setDatabaseChangeListener((event) => {
      eventBus.emit({
        domain: "database",
        type: "database.changed",
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

  logger.info("Database initialized.")
}

async function shutdownDatabase(): Promise<void> {
  logger.info("Shutting down database.")
  setDatabaseChangeListener(null)
  await stopMcpServer()
  await stopHttpServer()
  databaseService.close()
  logger.info("Database shut down.")
}

export { initDatabase, shutdownDatabase }
