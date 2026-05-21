import { Module } from "@nestjs/common"
import { APP_GUARD } from "@nestjs/core"
import { ScheduleModule } from "@nestjs/schedule"
import { ServeStaticModule } from "@nestjs/serve-static"
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler"
import { LoggerModule } from "nestjs-pino"
import { join } from "node:path"
import { AdminModule } from "./admin/admin.module"
import { AdminAuthModule } from "./admin-auth/admin-auth.module"
import { BackupModule } from "./backup/backup.module"
import { HealthModule } from "./health/health.module"
import { PrismaModule } from "./prisma/prisma.module"

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
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), "admin-dist"),
      serveRoot: "/admin",
      exclude: ["/admin/api/(.*)", "/admin/login", "/admin/logout"],
    }),
    PrismaModule,
    AdminAuthModule,
    AdminModule,
    BackupModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
