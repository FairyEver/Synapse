import "reflect-metadata"
import { NestFactory } from "@nestjs/core"
import cookieParser from "cookie-parser"
import { Logger } from "nestjs-pino"
import { AppModule } from "./app.module"
import { loadEnv } from "./config/env"

async function bootstrap(): Promise<void> {
  const env = loadEnv(process.env)
  const app = await NestFactory.create(AppModule, { bufferLogs: true })
  app.useLogger(app.get(Logger))
  app.use(cookieParser())
  app.enableShutdownHooks()
  await app.listen(env.port)
}

void bootstrap()
