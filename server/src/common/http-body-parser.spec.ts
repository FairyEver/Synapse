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

@Controller()
class BodyParserTestController {
  @Post("/json")
  receiveJson(@Body() body: { readonly value?: string }) {
    return { size: body.value?.length ?? 0 }
  }
}

@Module({ controllers: [BodyParserTestController] })
class BodyParserTestModule {}

describe("HTTP body parser configuration", () => {
  let app: NestExpressApplication

  beforeEach(async () => {
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
})
