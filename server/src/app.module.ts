import { Module } from "@nestjs/common"
import { APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core"
import { ScheduleModule } from "@nestjs/schedule"
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler"
import { LoggerModule } from "nestjs-pino"
import { join } from "node:path"
import { AdminModule } from "./admin/admin.module"
import { AdminAuthModule } from "./admin-auth/admin-auth.module"
import { AgentPersonasModule } from "./agent-personas/agent-personas.module"
import { UserAuthModule } from "./auth/user-auth.module"
import { BackupModule } from "./backup/backup.module"
import { DashboardModule } from "./dashboard/dashboard.module"
import { DriveModule } from "./drive/drive.module"
import { HealthModule } from "./health/health.module"
import { LiveModule } from "./live/live.module"
import { PrismaModule } from "./prisma/prisma.module"
import { ProblemFeedbackModule } from "./problem-feedback/problem-feedback.module"
import { SkillRepositoryModule } from "./skill-repository/skill-repository.module"
import { AuditLogInterceptor } from "./common/audit-log.interceptor"
import { sanitizeWebhookLogRequest } from "./webhooks/webhook-sanitize"
import { WebhookModule } from "./webhooks/webhook.module"
import { UpdateIntentModule } from "./update-intent/update-intent.module"
import { DEFAULT_API_RATE_LIMIT_PER_MINUTE, RATE_LIMIT_TTL_MS } from "./common/rate-limits"

type RequestLogObject = {
  readonly method?: unknown
  readonly originalUrl?: unknown
  readonly url?: unknown
} & Record<string, unknown>

@Module({
  imports: [
    ThrottlerModule.forRoot([{ name: "default", ttl: RATE_LIMIT_TTL_MS, limit: DEFAULT_API_RATE_LIMIT_PER_MINUTE }]),
    ScheduleModule.forRoot(),
    LoggerModule.forRoot({
      pinoHttp: {
        autoLogging: {
          ignore(request) {
            const candidate = request as typeof request & { readonly originalUrl?: unknown }
            const url = typeof candidate.originalUrl === "string"
              ? candidate.originalUrl
              : typeof candidate.url === "string" ? candidate.url : ""
            return url.split("?")[0] === "/api/problem-feedback"
          },
        },
        redact: ["req.headers.cookie", "req.headers.authorization", "req.body.accessSecret"],
        serializers: {
          req(request: RequestLogObject) {
            return sanitizeWebhookLogRequest(request)
          },
        },
        transport: {
          targets: [
            ...(process.env.NODE_ENV !== "production"
              ? [{ target: "pino-pretty", level: "info" as const, options: { colorize: true } }]
              : []),
            {
              target: "pino-roll",
              level: "debug" as const,
              options: {
                file: join(process.cwd(), "logs", "server"),
                frequency: "daily",
                size: "50m",
                extension: ".log",
                limit: { count: 30 },
                mkdir: true,
              },
            },
          ],
        },
      },
    }),
    PrismaModule,
    UserAuthModule,
    LiveModule,
    WebhookModule,
    AdminAuthModule,
    DashboardModule,
    AgentPersonasModule,
    SkillRepositoryModule,
    DriveModule,
    AdminModule,
    BackupModule,
    ProblemFeedbackModule,
    UpdateIntentModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditLogInterceptor },
  ],
})
export class AppModule {}
