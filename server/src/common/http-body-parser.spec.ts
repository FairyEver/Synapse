import { Body, Controller, Module, Patch, Post, Req } from "@nestjs/common"
import type { Request } from "express"
import { Test } from "@nestjs/testing"
import type { NestExpressApplication } from "@nestjs/platform-express"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { registerHttpBodyParsers } from "./http-body-parser"
import { gzipSync } from "node:zlib"

type SupertestChain = {
  readonly set: (name: string, value: string) => SupertestChain
  readonly send: (body: unknown) => SupertestChain
  readonly expect: (status: number) => Promise<{ readonly body: unknown }>
}

const request = require("supertest") as (server: unknown) => {
  readonly patch: (path: string) => SupertestChain
  readonly post: (path: string) => SupertestChain
}

let authLoginCalls = 0

@Controller()
class BodyParserTestController {
  @Post("/webhooks/:token")
  receiveWebhook(@Body() body: Buffer) {
    return { base64: Buffer.isBuffer(body) ? body.toString("base64") : null }
  }
  @Post("/json")
  receiveJson(@Body() body: { readonly value?: string }) {
    return { size: body.value?.length ?? 0 }
  }

  @Post("/api/auth/login")
  receiveAuthLogin(@Body() body: { readonly value?: string }) {
    authLoginCalls++
    return { size: body.value?.length ?? 0 }
  }

  @Post("/api/skill-hub/uploads")
  async receiveHubUpload(@Req() request: Request) {
    let size = 0
    for await (const chunk of request) size += chunk.length
    return { parsed: request.body !== undefined, size }
  }

  @Post("/api/skill-repositories/import")
  receiveSkillRepositoryImport(@Body() body: { readonly value?: string }) {
    return { size: body.value?.length ?? 0 }
  }

  @Patch("/api/drive/browser/owner/items/:itemId/content")
  receiveDriveText(@Body() body: { readonly text?: string }) {
    return { size: body.text?.length ?? 0 }
  }

  @Patch("/api/drive/browser/shares/:shareId/content")
  receiveSharedRootText(@Body() body: { readonly text?: string }) {
    return { size: body.text?.length ?? 0 }
  }

  @Patch("/api/drive/browser/shares/:shareId/items/:itemId/content")
  receiveSharedItemText(@Body() body: { readonly text?: string }) {
    return { size: body.text?.length ?? 0 }
  }
}

@Module({ controllers: [BodyParserTestController] })
class BodyParserTestModule {}

describe("HTTP body parser configuration", () => {
  let app: NestExpressApplication

  beforeEach(async () => {
    authLoginCalls = 0
    const moduleRef = await Test.createTestingModule({
      imports: [BodyParserTestModule],
    }).compile()
    app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false })
    registerHttpBodyParsers(app)
    await app.init()
  })

  afterEach(async () => {
    await app.close()
  })

  it.each(["/webhooks/example", "/WEBHOOKS/example"])("preserves compressed request bytes on %s", async (path) => {
    const bytes = gzipSync(Buffer.from('{ "token": "private", "n":9007199254740993 }'))
    const result = await request(app.getHttpServer()).post(path)
      .set("content-type", "application/octet-stream").set("content-encoding", "gzip")
      .send(bytes).expect(201)
    expect(result.body).toEqual({ base64: bytes.toString("base64") })
  })

  it("keeps malformed JSON byte-for-byte instead of parsing it", async () => {
    const raw = '{ "unfinished": '
    const result = await request(app.getHttpServer()).post("/webhooks/example")
      .set("content-type", "application/json").send(raw).expect(201)
    expect(result.body).toEqual({ base64: Buffer.from(raw).toString("base64") })
  })

  it("accepts exactly 256 KiB and rejects larger raw bodies", async () => {
    const bytes = Buffer.alloc(256 * 1024, 255)
    await request(app.getHttpServer()).post("/webhooks/example")
      .set("content-type", "application/octet-stream").send(bytes).expect(201)
    await request(app.getHttpServer()).post("/webhooks/example")
      .set("content-type", "application/octet-stream").send(Buffer.concat([bytes, Buffer.from([0])])).expect(413)
  })

  it("accepts JSON payloads above the Express default 100KB limit", async () => {
    const value = "x".repeat(160 * 1024)
    const response = await request(app.getHttpServer())
      .post("/json")
      .set("content-type", "application/json")
      .send({ value })
      .expect(201)

    expect(response.body).toEqual({ size: value.length })
  })

  it("rejects large public auth JSON before controller handling", async () => {
    const value = "x".repeat(2 * 1024 * 1024)

    await request(app.getHttpServer())
      .post("/api/auth/login")
      .set("content-type", "application/json")
      .send({ value })
      .expect(413)

    expect(authLoginCalls).toBe(0)
  })

  it("leaves Hub upload bodies unread for authentication and route-local limits", async () => {
    const raw = JSON.stringify({ value: "x".repeat(2 * 1024 * 1024) })
    const response = await request(app.getHttpServer())
      .post("/API/SKILL-HUB/UPLOADS/")
      .set("content-type", "application/json")
      .send(raw)
      .expect(201)
    expect(response.body).toEqual({ parsed: false, size: Buffer.byteLength(raw) })
  })

  it.each([
    "/api/drive/browser/owner/items/item-1/content",
    "/api/drive/browser/shares/share-1/content",
    "/api/drive/browser/shares/share-1/items/item-1/content",
  ])("accepts Drive text edits above the general JSON body limit on %s", async (path) => {
    const value = "x".repeat(2 * 1024 * 1024)

    const response = await request(app.getHttpServer())
      .patch(path)
      .set("content-type", "application/json")
      .send({ text: value })
      .expect(200)

    expect(response.body).toEqual({ size: value.length })
  })
})
