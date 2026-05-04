import "reflect-metadata"
import { NestFactory } from "@nestjs/core"
import cookieParser from "cookie-parser"
import helmet from "helmet"
import { Logger, PinoLogger } from "nestjs-pino"
import { AppModule } from "./app.module"
import { AllExceptionsFilter } from "./common/all-exceptions.filter"
import { loadEnv } from "./config/env"

async function bootstrap(): Promise<void> {
  const env = loadEnv(process.env)
  const app = await NestFactory.create(AppModule, { bufferLogs: true })
  app.useLogger(app.get(Logger))
  app.useGlobalFilters(new AllExceptionsFilter(app.get(PinoLogger)))
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
  await app.listen(env.port)
}

void bootstrap()
