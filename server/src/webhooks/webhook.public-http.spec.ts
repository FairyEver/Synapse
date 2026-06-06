import { Module } from "@nestjs/common"
import { Test } from "@nestjs/testing"
import type { NestExpressApplication } from "@nestjs/platform-express"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AllExceptionsFilter } from "../common/all-exceptions.filter"
import { WebhookPublicController } from "./webhook.controller"
import { WebhookService } from "./webhook.service"

type SupertestChain = {
  readonly set: (name: string, value: string) => SupertestChain
  readonly send: (body: Buffer) => SupertestChain
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
    receivePublicWebhook.mockReset()
    const moduleRef = await Test.createTestingModule({
      imports: [WebhookPublicTestModule],
    }).compile()
    app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false })
    app.useBodyParser("raw", { type: webhookRawBodyType, limit: "256kb" })
    app.useBodyParser("json")
    app.useBodyParser("urlencoded", { extended: true })
    app.useGlobalFilters(new AllExceptionsFilter({ error: vi.fn() } as never))
    await app.init()
  })

  afterEach(async () => {
    await app.close()
  })

  it("returns 413 before receive service for public webhook bodies over 256KB", async () => {
    await request(app.getHttpServer())
      .post("/webhooks/wh_public/whsec_secret")
      .set("content-type", "application/octet-stream")
      .send(Buffer.alloc(256 * 1024 + 1))
      .expect(413)

    expect(receivePublicWebhook).not.toHaveBeenCalled()
  })
})

function webhookRawBodyType(request: { readonly url?: string }): boolean {
  return request.url?.startsWith("/webhooks/") ?? false
}
