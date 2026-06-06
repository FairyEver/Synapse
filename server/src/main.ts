import "reflect-metadata"
import { NestFactory } from "@nestjs/core"
import cookieParser from "cookie-parser"
import express from "express"
import helmet from "helmet"
import { Logger, PinoLogger } from "nestjs-pino"
import { AppModule } from "./app.module"
import { AllExceptionsFilter } from "./common/all-exceptions.filter"
import { loadEnv } from "./config/env"
import { LiveDesktopGateway } from "./live/live-desktop.gateway"

async function bootstrap(): Promise<void> {
  const env = loadEnv(process.env)
  const app = await NestFactory.create(AppModule, { bufferLogs: true, bodyParser: false })
  app.useLogger(app.get(Logger))
  app.useGlobalFilters(new AllExceptionsFilter(await app.resolve(PinoLogger)))
  app.use("/webhooks", express.raw({ type: "*/*", limit: "256kb" }))
  app.use(express.json())
  app.use(express.urlencoded({ extended: true }))
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
