import "reflect-metadata"
import { NestFactory } from "@nestjs/core"
import type { NestExpressApplication } from "@nestjs/platform-express"
import cookieParser from "cookie-parser"
import helmet from "helmet"
import { Logger, PinoLogger } from "nestjs-pino"
import { AppModule } from "./app.module"
import { AllExceptionsFilter } from "./common/all-exceptions.filter"
import { registerHttpBodyParsers } from "./common/http-body-parser"
import { loadEnv } from "./config/env"
import { LiveDesktopGateway } from "./live/live-desktop.gateway"
import { DriveCollaborationGateway } from "./drive/drive-collaboration.gateway"
import { registerLiveShutdownSignalHandlers } from "./live/live-shutdown-signals"
import { isProblemFeedbackPublicPath } from "./problem-feedback/problem-feedback-http"

async function bootstrap(): Promise<void> {
  const env = loadEnv(process.env)
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true, bodyParser: false })
  app.set("trust proxy", env.trustProxy)
  app.useLogger(app.get(Logger))
  app.useGlobalFilters(new AllExceptionsFilter(await app.resolve(PinoLogger)))
  registerHttpBodyParsers(app)
  app.use(cookieParser())
  app.use(
    helmet({
      contentSecurityPolicy: process.env.NODE_ENV === "production",
    }),
  )
  app.enableCors((request, callback) => {
    callback(null, isProblemFeedbackPublicPath(request.originalUrl ?? request.url ?? "")
      ? { origin: false, preflightContinue: true }
      : {
          origin: process.env.NODE_ENV === "production" ? false : true,
          credentials: true,
        })
  })
  app.enableShutdownHooks()
  const liveDesktopGateway = app.get(LiveDesktopGateway)
  registerLiveShutdownSignalHandlers(liveDesktopGateway)
  liveDesktopGateway.attach(app.getHttpServer())
  app.get(DriveCollaborationGateway).attach(app.getHttpServer())
  await app.listen(env.port)
}

void bootstrap()
