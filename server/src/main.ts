import "reflect-metadata"
import { cloudTableCors, registerCloudTableIngress, registerCloudTableBodyErrors } from "./cloud-tables/cloud-table-http"
import { channelCors, registerChannelBodyErrors, registerChannelIngress } from "./channels/channel-http"
import { ChannelGateway } from "./channels/channel.gateway"
import { NestFactory } from "@nestjs/core"
import type { NestExpressApplication } from "@nestjs/platform-express"
import cookieParser from "cookie-parser"
import { Logger, PinoLogger } from "nestjs-pino"
import { AppModule } from "./app.module"
import { AllExceptionsFilter } from "./common/all-exceptions.filter"
import { registerHttpBodyParsers } from "./common/http-body-parser"
import { registerHttpShutdownDeadline } from "./common/http-shutdown-deadline"
import { createHttpSecurityMiddleware } from "./common/http-security"
import { loadEnv } from "./config/env"
import { LiveDesktopGateway } from "./live/live-desktop.gateway"
import { DriveCollaborationGateway } from "./drive/drive-collaboration.gateway"
import { MobileLiveGateway } from "./mobile-live/mobile-live.gateway"
import { registerLiveShutdownSignalHandlers } from "./live/live-shutdown-signals"
import { isProblemFeedbackPublicPath } from "./problem-feedback/problem-feedback-http"

async function bootstrap(): Promise<void> {
  const env = loadEnv(process.env)
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true, bodyParser: false })
  app.set("trust proxy", env.trustProxy)
  app.useLogger(app.get(Logger))
  app.useGlobalFilters(new AllExceptionsFilter(await app.resolve(PinoLogger)))
  registerCloudTableIngress(app)
  registerChannelIngress(app)
  registerHttpBodyParsers(app)
  registerCloudTableBodyErrors(app)
  registerChannelBodyErrors(app)
  app.use(cookieParser())
  app.use(createHttpSecurityMiddleware(process.env.NODE_ENV === "production"))
  app.enableCors((request, callback) => {
    const requestUrl = request.originalUrl ?? request.url ?? ""
    callback(null, cloudTableCors(requestUrl) ?? channelCors(requestUrl) ?? (isProblemFeedbackPublicPath(requestUrl)
      ? { origin: false, preflightContinue: true }
      : {
          origin: process.env.NODE_ENV === "production" ? false : true,
          credentials: true,
        }))
  })
  app.enableShutdownHooks()
  const liveDesktopGateway = app.get(LiveDesktopGateway)
  registerLiveShutdownSignalHandlers(liveDesktopGateway)
  liveDesktopGateway.attach(app.getHttpServer())
  app.get(DriveCollaborationGateway).attach(app.getHttpServer())
  app.get(ChannelGateway).attach(app.getHttpServer())
  // Phones connect over their own path; the three gateways share one upgrade
  // event and each claims its own pathname.
  if (env.mobileLiveEnabled) {
    app.get(MobileLiveGateway).attach(app.getHttpServer())
  }
  await app.listen(env.port)
  registerHttpShutdownDeadline(app.getHttpServer())
}

void bootstrap()
