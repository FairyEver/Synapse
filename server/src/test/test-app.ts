import { type INestApplication } from "@nestjs/common"
import { Test } from "@nestjs/testing"
import type { NestExpressApplication } from "@nestjs/platform-express"
import cookieParser from "cookie-parser"
import { PinoLogger } from "nestjs-pino"
import { AppModule } from "../app.module"
import { AllExceptionsFilter } from "../common/all-exceptions.filter"

export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile()

  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false })
  app.useBodyParser("raw", { type: webhookRawBodyType, limit: "256kb" })
  app.useBodyParser("json")
  app.useBodyParser("urlencoded", { extended: true })
  app.use(cookieParser())
  app.useGlobalFilters(new AllExceptionsFilter(app.get(PinoLogger)))
  await app.init()
  return app
}

function webhookRawBodyType(request: { readonly url?: string }): boolean {
  return request.url?.startsWith("/webhooks/") ?? false
}
