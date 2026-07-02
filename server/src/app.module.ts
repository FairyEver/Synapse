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
import { ContentStoreModule } from "./content-store/content-store.module"
import { DashboardModule } from "./dashboard/dashboard.module"
import { DriveModule } from "./drive/drive.module"
import { HealthModule } from "./health/health.module"
import { InvitationsModule } from "./invitations/invitations.module"
import { LiveModule } from "./live/live.module"
import { PrismaModule } from "./prisma/prisma.module"
import { SkillRepositoryModule } from "./skill-repository/skill-repository.module"
import { TeamsModule } from "./teams/teams.module"
import { AuditLogInterceptor } from "./common/audit-log.interceptor"
import { sanitizeWebhookLogRequest } from "./webhooks/webhook-sanitize"
import { WebhookModule } from "./webhooks/webhook.module"

type RequestLogObject = {
  readonly url?: unknown
} & Record<string, unknown>

@Module({
  imports: [
    ThrottlerModule.forRoot([{ name: "default", ttl: 60000, limit: 60 }]),
    ScheduleModule.forRoot(),
    LoggerModule.forRoot({
      pinoHttp: {
        autoLogging: true,
        redact: ["req.headers.cookie", "req.headers.authorization"],
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
    InvitationsModule,
    UserAuthModule,
    LiveModule,
    TeamsModule,
    WebhookModule,
    AdminAuthModule,
    DashboardModule,
    AgentPersonasModule,
    ContentStoreModule,
    SkillRepositoryModule,
    DriveModule,
    AdminModule,
    BackupModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditLogInterceptor },
  ],
})
export class AppModule {}
