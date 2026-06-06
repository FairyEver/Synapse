import "reflect-metadata"
import { NestFactory } from "@nestjs/core"
import type { NestExpressApplication } from "@nestjs/platform-express"
import cookieParser from "cookie-parser"
import helmet from "helmet"
import { Logger, PinoLogger } from "nestjs-pino"
import { AppModule } from "./app.module"
import { AllExceptionsFilter } from "./common/all-exceptions.filter"
import { loadEnv } from "./config/env"
import { LiveDesktopGateway } from "./live/live-desktop.gateway"

async function bootstrap(): Promise<void> {
  const env = loadEnv(process.env)
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true, bodyParser: false })
  app.useLogger(app.get(Logger))
  app.useGlobalFilters(new AllExceptionsFilter(await app.resolve(PinoLogger)))
  app.useBodyParser("raw", { type: webhookRawBodyType, limit: "256kb" })
  app.useBodyParser("json")
  app.useBodyParser("urlencoded", { extended: true })
  app.use(cookieParser())
  app.use(
    helmet({
      contentSecurityPolicy: process.env.NODE_ENV === "production",
    }),
  )
  app.enableCors({
    origin: process.env.NODE_ENV === "production" ? false : true,
    credentials: true,
  })
  app.enableShutdownHooks()
  app.get(LiveDesktopGateway).attach(app.getHttpServer())
  await app.listen(env.port)
}

void bootstrap()

function webhookRawBodyType(request: { readonly url?: string }): boolean {
  return request.url?.startsWith("/webhooks/") ?? false
}
