import { Body, Controller, Module, Post } from "@nestjs/common"
import { Test } from "@nestjs/testing"
import type { NestExpressApplication } from "@nestjs/platform-express"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { registerHttpBodyParsers } from "./http-body-parser"

type SupertestChain = {
  readonly set: (name: string, value: string) => SupertestChain
  readonly send: (body: unknown) => SupertestChain
  readonly expect: (status: number) => Promise<{ readonly body: unknown }>
}

const request = require("supertest") as (server: unknown) => { readonly post: (path: string) => SupertestChain }

let authLoginCalls = 0

@Controller()
class BodyParserTestController {
  @Post("/json")
  receiveJson(@Body() body: { readonly value?: string }) {
    return { size: body.value?.length ?? 0 }
  }

  @Post("/api/auth/login")
  receiveAuthLogin(@Body() body: { readonly value?: string }) {
    authLoginCalls++
    return { size: body.value?.length ?? 0 }
  }

  @Post("/api/content-store/drafts")
  receiveContentStoreDraft(@Body() body: { readonly value?: string }) {
    return { size: body.value?.length ?? 0 }
  }

  @Post("/api/skill-repositories/import")
  receiveSkillRepositoryImport(@Body() body: { readonly value?: string }) {
    return { size: body.value?.length ?? 0 }
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

  it("keeps large JSON enabled for content store draft uploads", async () => {
    const value = "x".repeat(2 * 1024 * 1024)

    const response = await request(app.getHttpServer())
      .post("/api/content-store/drafts")
      .set("content-type", "application/json")
      .send({ value })
      .expect(201)

    expect(response.body).toEqual({ size: value.length })
  })

  it("keeps large JSON enabled for Skill Repository imports", async () => {
    const value = "x".repeat(2 * 1024 * 1024)

    const response = await request(app.getHttpServer())
      .post("/api/skill-repositories/import")
      .set("content-type", "application/json")
      .send({ value })
      .expect(201)

    expect(response.body).toEqual({ size: value.length })
  })
})
