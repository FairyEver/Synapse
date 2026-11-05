import { Module } from "@nestjs/common"
import { Test } from "@nestjs/testing"
import type { NestExpressApplication } from "@nestjs/platform-express"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AllExceptionsFilter } from "../common/all-exceptions.filter"
import { registerHttpBodyParsers } from "../common/http-body-parser"
import { WebhookPublicController } from "./webhook.controller"
import { WebhookService } from "./webhook.service"

type SupertestChain = {
  readonly set: (name: string, value: string) => SupertestChain
  readonly send: (body: Buffer | string) => SupertestChain
  readonly expect: (status: number) => Promise<unknown>
}

const request = require("supertest") as (server: unknown) => { readonly post: (path: string) => SupertestChain }
const receivePublicWebhook = vi.fn()

@Module({
  controllers: [WebhookPublicController],
  providers: [{
    provide: WebhookService,
    useValue: { receivePublicWebhook },
  }],
})
class WebhookPublicTestModule {}

describe("WebhookPublicController HTTP route", () => {
  let app: NestExpressApplication

  beforeEach(async () => {
    vi.stubEnv("APP_PUBLIC_URL", "https://synapse.test")
    receivePublicWebhook.mockReset()
    const moduleRef = await Test.createTestingModule({
      imports: [WebhookPublicTestModule],
    }).compile()
    app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false })
    registerHttpBodyParsers(app)
    app.useGlobalFilters(new AllExceptionsFilter({ error: vi.fn() } as never))
    await app.init()
  })

  afterEach(async () => {
    await app.close()
    vi.unstubAllEnvs()
  })

  it("accepts a single token without a public ID in the URL", async () => {
    receivePublicWebhook.mockResolvedValue({ response: { ok: true } })
    await request(app.getHttpServer())
      .post("/webhooks/whsec_secret")
      .set("content-type", "application/json")
      .send('{"ok":true}')
      .expect(202)
    expect(receivePublicWebhook).toHaveBeenCalledWith(expect.objectContaining({
      secret: "whsec_secret",
      body: Buffer.from('{"ok":true}'),
    }))
    expect(receivePublicWebhook.mock.calls[0]?.[0]).not.toHaveProperty("publicId")
  })

  it("does not accept legacy two-part webhook URLs", async () => {
    await request(app.getHttpServer())
      .post("/webhooks/wh_public/whsec_secret")
      .set("content-type", "application/json")
      .send(Buffer.from("{}"))
      .expect(404)
    expect(receivePublicWebhook).not.toHaveBeenCalled()
  })

  it("preserves special query keys through the real HTTP parser", async () => {
    receivePublicWebhook.mockResolvedValue({ response: { ok: true } })
    await request(app.getHttpServer())
      .post("/webhooks/whsec_secret?__proto__=visible&constructor=one&constructor=two&toString=string")
      .set("content-type", "application/json")
      .send("{}")
      .expect(202)
    const query = receivePublicWebhook.mock.calls[0]?.[0].query
    expect(JSON.parse(JSON.stringify(query))).toEqual(JSON.parse('{"__proto__":"visible","constructor":["one","two"],"toString":"string"}'))
  })

  it("returns 413 before receive service for public webhook bodies over 256KB", async () => {
    await request(app.getHttpServer())
      .post("/webhooks/whsec_secret")
      .set("content-type", "application/octet-stream")
      .send(Buffer.alloc(256 * 1024 + 1))
      .expect(413)

    expect(receivePublicWebhook).not.toHaveBeenCalled()
  })
})
