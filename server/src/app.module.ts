import { Module } from "@nestjs/common"
import { APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core"
import { ScheduleModule } from "@nestjs/schedule"
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler"
import { LoggerModule } from "nestjs-pino"
import { join } from "node:path"
import { AdminModule } from "./admin/admin.module"
import { AdminAuthModule } from "./admin-auth/admin-auth.module"
import { UserAuthModule } from "./auth/user-auth.module"
import { BackupModule } from "./backup/backup.module"
import { DashboardModule } from "./dashboard/dashboard.module"
import { HealthModule } from "./health/health.module"
import { InvitationsModule } from "./invitations/invitations.module"
import { LiveModule } from "./live/live.module"
import { PermissionsModule } from "./permissions/permissions.module"
import { PrismaModule } from "./prisma/prisma.module"
import { TeamsModule } from "./teams/teams.module"
import { AuditLogInterceptor } from "./common/audit-log.interceptor"

@Module({
  imports: [
    ThrottlerModule.forRoot([{ name: "default", ttl: 60000, limit: 60 }]),
    ScheduleModule.forRoot(),
    LoggerModule.forRoot({
      pinoHttp: {
        autoLogging: true,
        redact: ["req.headers.cookie", "req.headers.authorization"],
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
    PermissionsModule,
    InvitationsModule,
    UserAuthModule,
    LiveModule,
    TeamsModule,
    AdminAuthModule,
    DashboardModule,
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
