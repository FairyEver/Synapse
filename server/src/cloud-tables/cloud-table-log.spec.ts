import "reflect-metadata"
import { EventEmitter } from "node:events"
import { Writable } from "node:stream"
import pinoHttp from "pino-http"
import { MODULE_METADATA } from "@nestjs/common/constants"
import { describe, expect, it } from "vitest"
import { AppModule } from "../app.module"

describe("cloud table explicit error log privacy", () => {
  it.each(["/api/console/tables/table/collaborators/search", "/API/OPEN/V1/TABLES/table/logs", "http://localhost/api/open/v1/tables/table/logs"])("omits URL parameters and arbitrary request data for %s", path => {
    const modules = Reflect.getMetadata(MODULE_METADATA.IMPORTS, AppModule) as { providers?: { provide?: unknown; useValue?: any }[] }[]
    const config = modules.flatMap(m => m.providers ?? []).find(p => p.provide === "pino-params")!.useValue.pinoHttp
    const chunks: string[] = []
    const output = new Writable({ write(chunk, _encoding, next) { chunks.push(String(chunk)); next() } })
    const http = pinoHttp({ autoLogging: config.autoLogging, serializers: config.serializers, redact: config.redact }, output)
    const url = `${path}?query=PRIVATE_EMAIL&cursor=PRIVATE_CURSOR`
    const request = Object.assign(new EventEmitter(), { method: "GET", path: path.replace("http://localhost", ""), url, originalUrl: url, headers: { authorization: "Bearer PRIVATE_KEY", "x-test": "PRIVATE_HEADER" }, query: { query: "PRIVATE_EMAIL" }, params: { id: "PRIVATE_PARAM" }, socket: { remoteAddress: "127.0.0.1", remotePort: 1234 } })
    const response = Object.assign(new EventEmitter(), { statusCode: 503, getHeader: () => undefined, getHeaders: () => ({}) })
    http(request as never, response as never)
    const log = (request as unknown as { log: { error(value: unknown, message: string): void } }).log
    log.error({ errorCode: "SERVER_BUSY" }, "Cloud table failed")
    const text = chunks.join("")
    expect(text).toContain("SERVER_BUSY")
    expect(text).not.toContain("PRIVATE_")
    expect(JSON.parse(text).req).toMatchObject({ method: "GET" })
    output.end()
  })
})
