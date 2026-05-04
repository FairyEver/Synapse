import { Module } from "@nestjs/common"
import { APP_GUARD } from "@nestjs/core"
import { ScheduleModule } from "@nestjs/schedule"
import { ServeStaticModule } from "@nestjs/serve-static"
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler"
import { LoggerModule } from "nestjs-pino"
import { join } from "node:path"
import { AdminModule } from "./admin/admin.module"
import { AdminAuthModule } from "./admin-auth/admin-auth.module"
import { CleanupService } from "./common/cleanup.service"
import { HealthModule } from "./health/health.module"
import { LicensesModule } from "./licenses/licenses.module"
import { PrismaModule } from "./prisma/prisma.module"

@Module({
  imports: [
    ThrottlerModule.forRoot([{ name: "default", ttl: 60000, limit: 60 }]),
    ScheduleModule.forRoot(),
    LoggerModule.forRoot({
      pinoHttp: {
        autoLogging: true,
        redact: ["req.headers.cookie", "req.headers.authorization"],
        transport:
          process.env.NODE_ENV !== "production"
            ? { target: "pino-pretty", options: { colorize: true } }
            : undefined,
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
    LicensesModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    CleanupService,
  ],
})
export class AppModule {}
