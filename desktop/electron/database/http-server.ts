import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { randomBytes } from "node:crypto"
import { chmodSync, readFileSync, writeFileSync, unlinkSync } from "node:fs"
import path from "node:path"
import { app } from "electron"
import { isProcessAlive } from "../../database/shared/process-liveness"
import type { SynapseActionRouter } from "../capabilities/action-router"
import type { DatabaseServerInfo } from "./types"
import { createMainLogger } from "../services/log-store"

const logger = createMainLogger("database.http")

let server: Server | null = null
let serverInfo: DatabaseServerInfo | null = null
let actionRouter: SynapseActionRouter | null = null

function getServerInfoPath(): string {
  return path.join(app.getPath("userData"), "data-server.json")
}

const MAX_BODY_SIZE = 1024 * 1024

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let settled = false
    const cleanup = () => {
      req.off("data", onData)
      req.off("end", onEnd)
      req.off("error", onError)
      req.off("aborted", onAborted)
    }
    const settle = (callback: () => void) => {
      if (settled) return
      settled = true
      cleanup()
      callback()
    }
    const onData = (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_SIZE) {
        req.destroy()
        settle(() => reject(new Error("Request body too large")))
        return
      }
      chunks.push(chunk)
    }
    const onEnd = () => settle(() => resolve(Buffer.concat(chunks).toString("utf-8")))
    const onError = (error: Error) => settle(() => reject(error))
    const onAborted = () => settle(() => reject(new Error("Request aborted")))

    req.on("data", onData)
    req.on("end", onEnd)
    req.on("error", onError)
    req.on("aborted", onAborted)
  })
}

function applyCorsHeaders(req: IncomingMessage, res: ServerResponse): boolean {
  const origin = req.headers.origin
  if (!origin) {
    return true
  }

  let parsed: URL
  try {
    parsed = new URL(origin)
  } catch {
    sendJson(res, 403, { ok: false, error: "Forbidden origin" })
    return false
  }

  if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") {
    sendJson(res, 403, { ok: false, error: "Forbidden origin" })
    return false
  }

  res.setHeader("Access-Control-Allow-Origin", origin)
  res.setHeader("Vary", "Origin")
  return true
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data)
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) })
  res.end(body)
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization")
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS")
  if (!applyCorsHeaders(req, res)) {
    return
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204)
    res.end()
    return
  }

  if (req.method !== "POST" || req.url !== "/api") {
    sendJson(res, 404, { ok: false, error: "Not found" })
    return
  }

  const authHeader = req.headers.authorization
  if (!serverInfo || authHeader !== `Bearer ${serverInfo.token}`) {
    sendJson(res, 401, { ok: false, error: "Unauthorized" })
    return
  }

  let body: Record<string, unknown>
  try {
    body = JSON.parse(await readBody(req))
  } catch {
    sendJson(res, 400, { ok: false, error: "Invalid JSON" })
    return
  }

  const { action, ...params } = body

  if (typeof action !== "string" || !action) {
    sendJson(res, 400, { ok: false, error: "Missing or invalid 'action' field" })
    return
  }

  try {
    const result = await actionRouterForRequest().dispatch(action, params, { source: "api" })
    sendJson(res, 200, result)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.warn("API request failed.", { action, error: message })
    sendJson(res, 200, { ok: false, error: message })
  }
}

function actionRouterForRequest(): SynapseActionRouter {
  if (!actionRouter) {
    throw new Error("Synapse action router is not initialized")
  }
  return actionRouter
}

function cleanupStaleServerInfo(): void {
  try {
    const raw = readFileSync(getServerInfoPath(), "utf-8")
    const info = JSON.parse(raw) as { pid?: number }

    if (typeof info.pid !== "number") {
      return
    }

    if (!isProcessAlive(info.pid)) {
      unlinkSync(getServerInfoPath())
      logger.info("Cleaned up stale data-server.json from a previous crash.", { stalePid: info.pid })
    }
  } catch {
    // file doesn't exist or unreadable — nothing to clean
  }
}

function startHttpServer(router: SynapseActionRouter): Promise<number> {
  actionRouter = router
  cleanupStaleServerInfo()
  return new Promise((resolve, reject) => {
    const s = createServer((req, res) => {
      handleRequest(req, res).catch((error) => {
        logger.error("Unhandled HTTP error.", { error })
        sendJson(res, 500, { ok: false, error: "Internal server error" })
      })
    })

    s.listen(0, "127.0.0.1", () => {
      const address = s.address()
      if (!address || typeof address === "string") {
        reject(new Error("Failed to get server address"))
        return
      }

      const port = address.port
      const token = randomBytes(32).toString("hex")

      serverInfo = {
        port,
        token,
        pid: process.pid,
        startedAt: new Date().toISOString(),
      }

      try {
        const serverInfoPath = getServerInfoPath()
        writeFileSync(serverInfoPath, JSON.stringify(serverInfo, null, 2), { mode: 0o600 })
        chmodSync(serverInfoPath, 0o600)
      } catch (error) {
        logger.error("Failed to write server info file.", { error })
        s.close()
        reject(new Error("Failed to write data-server.json: MCP will not be able to connect"))
        return
      }

      server = s
      logger.info("HTTP server started.", { port })
      resolve(port)
    })

    s.on("error", reject)
  })
}

function stopHttpServer(): Promise<void> {
  return new Promise((resolve) => {
    try {
      unlinkSync(getServerInfoPath())
    } catch (error) { logger.warn("Failed to clean up server info file.", { error }) }

    serverInfo = null
    actionRouter = null

    if (!server) {
      resolve()
      return
    }

    server.close(() => {
      server = null
      logger.info("HTTP server stopped.")
      resolve()
    })
  })
}

function getHttpPort(): number {
  return serverInfo?.port ?? 0
}

export { startHttpServer, stopHttpServer, getHttpPort }
