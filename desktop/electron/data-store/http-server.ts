import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { randomBytes } from "node:crypto"
import { writeFileSync, unlinkSync } from "node:fs"
import path from "node:path"
import { app } from "electron"
import type { DataStoreQueryParams } from "../../src/types/data-store"
import { dataStoreService } from "./service"
import type { DataStoreServerInfo } from "./types"
import { createMainLogger } from "../services/log-store"

const logger = createMainLogger("data-store.http")

let server: Server | null = null
let serverInfo: DataStoreServerInfo | null = null

function getServerInfoPath(): string {
  return path.join(app.getPath("userData"), "data-server.json")
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on("data", (chunk: Buffer) => chunks.push(chunk))
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")))
    req.on("error", reject)
  })
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data)
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) })
  res.end(body)
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization")

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
    const result = dispatch(action as string, params)
    sendJson(res, 200, result)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.warn("API request failed.", { action, error: message })
    sendJson(res, 200, { ok: false, error: message })
  }
}

function assertString(params: Record<string, unknown>, key: string): string {
  const v = params[key]
  if (typeof v !== "string" || !v) throw new Error(`Missing or invalid '${key}': expected non-empty string`)
  return v
}

function assertNumber(params: Record<string, unknown>, key: string): number {
  const v = params[key]
  if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`Missing or invalid '${key}': expected number`)
  return v
}

function assertObject(params: Record<string, unknown>, key: string): Record<string, unknown> {
  const v = params[key]
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error(`Missing or invalid '${key}': expected object`)
  return v as Record<string, unknown>
}

function assertArray(params: Record<string, unknown>, key: string): unknown[] {
  const v = params[key]
  if (!Array.isArray(v)) throw new Error(`Missing or invalid '${key}': expected array`)
  return v
}

function dispatch(action: string, params: Record<string, unknown>): unknown {
  switch (action) {
    case "listTables":
      return { ok: true, data: dataStoreService.listTables() }

    case "createTable":
      dataStoreService.createTable(
        assertString(params, "name"),
        assertArray(params, "columns") as { name: string; type: "TEXT" | "INTEGER" | "REAL" | "BLOB" | "JSON" }[],
        params.description as string | undefined,
      )
      return { ok: true }

    case "dropTable":
      dataStoreService.dropTable(assertString(params, "name"))
      return { ok: true }

    case "describeTable":
      return { ok: true, data: dataStoreService.describeTable(assertString(params, "name")) }

    case "addColumn": {
      const tableName = (params.table ?? params.name) as string | undefined
      if (typeof tableName !== "string" || !tableName) throw new Error("Missing or invalid 'table' (or 'name'): expected non-empty string")
      dataStoreService.addColumn(tableName, assertObject(params, "column") as { name: string; type: "TEXT" | "INTEGER" | "REAL" | "BLOB" | "JSON"; default?: unknown })
      return { ok: true }
    }

    case "insert": {
      const insertResult = dataStoreService.insert(assertString(params, "table"), assertObject(params, "data"))
      return { ok: true, data: insertResult, affected: 1 }
    }

    case "batchInsert": {
      const batchResult = dataStoreService.batchInsert(assertString(params, "table"), assertArray(params, "rows") as Record<string, unknown>[])
      return { ok: true, data: batchResult, affected: batchResult.ids.length }
    }

    case "query": {
      assertString(params, "table")
      const queryResult = dataStoreService.query(params as DataStoreQueryParams)
      return { ok: true, data: queryResult.rows, total: queryResult.total }
    }

    case "update": {
      const updateResult = dataStoreService.update(assertString(params, "table"), assertNumber(params, "id"), assertObject(params, "data"))
      return { ok: true, data: { id: params.id }, affected: updateResult.affected }
    }

    case "delete": {
      const deleteResult = dataStoreService.delete(assertString(params, "table"), assertNumber(params, "id"))
      return { ok: true, data: { id: params.id }, affected: deleteResult.affected }
    }

    case "rawSQL": {
      const rawResult = dataStoreService.rawSQL(assertString(params, "sql"), params.params as unknown[] | undefined)
      if (rawResult.rows) {
        return { ok: true, data: { rows: rawResult.rows } }
      }
      return { ok: true, data: { changes: rawResult.changes, lastInsertRowid: rawResult.lastInsertRowid } }
    }

    default:
      throw new Error(`Unknown action: ${action}`)
  }
}

function startHttpServer(): Promise<number> {
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
        writeFileSync(getServerInfoPath(), JSON.stringify(serverInfo, null, 2))
      } catch (error) {
        logger.error("Failed to write server info file.", { error })
        s.close()
        reject(new Error("Failed to write data-server.json: CLI/MCP will not be able to connect"))
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
    } catch { /* ignore */ }

    serverInfo = null

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
