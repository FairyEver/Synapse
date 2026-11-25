import "reflect-metadata"
import { existsSync } from "node:fs"
import { resolve } from "node:path"
import express from "express"
import { cloudTableCors, registerCloudTableIngress, registerCloudTableBodyErrors } from "./cloud-tables/cloud-table-http"
import { channelCors, registerChannelBodyErrors, registerChannelIngress } from "./channels/channel-http"
import { ChannelGateway } from "./channels/channel.gateway"
import { stateSyncCors, registerStateSyncBodyErrors, registerStateSyncIngress } from "./state-sync/state-sync-http"
import { StateSyncGateway } from "./state-sync/state-sync.gateway"
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
  registerStateSyncIngress(app)
  registerHttpBodyParsers(app)
  registerCloudTableBodyErrors(app)
  registerChannelBodyErrors(app)
  registerStateSyncBodyErrors(app)
  app.use(cookieParser())
  app.use(createHttpSecurityMiddleware(process.env.NODE_ENV === "production"))
  if (process.env.NODE_ENV !== "production") {
    const candidateSdkDirs = [
      resolve(__dirname, "..", "..", "sdk", "dist"),
      resolve(process.cwd(), "..", "sdk", "dist"),
      resolve(process.cwd(), "sdk", "dist"),
    ]
    const sdkDistDir = candidateSdkDirs.find((dir) => existsSync(dir)) ?? candidateSdkDirs[0]!
    app.use(
      "/sdk",
      express.static(sdkDistDir, {
        setHeaders: (res) => {
          res.setHeader("Access-Control-Allow-Origin", "*")
          res.setHeader("Cross-Origin-Resource-Policy", "cross-origin")
          res.setHeader("X-Content-Type-Options", "nosniff")
        },
      }),
    )
  }
  app.enableCors((request, callback) => {
    const requestUrl = request.originalUrl ?? request.url ?? ""
    callback(null, cloudTableCors(requestUrl) ?? channelCors(requestUrl) ?? stateSyncCors(requestUrl) ?? (isProblemFeedbackPublicPath(requestUrl)
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
  app.get(StateSyncGateway).attach(app.getHttpServer())
  // Phones connect over their own path; the gateways share one upgrade
  // event and each claims its own pathname.
  if (env.mobileLiveEnabled) {
    app.get(MobileLiveGateway).attach(app.getHttpServer())
  }
  await app.listen(env.port)
  registerHttpShutdownDeadline(app.getHttpServer())
}

void bootstrap()
