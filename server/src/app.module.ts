import { Module } from "@nestjs/common"
import { ServeStaticModule } from "@nestjs/serve-static"
import { LoggerModule } from "nestjs-pino"
import { join } from "node:path"
import { AdminModule } from "./admin/admin.module"
import { AdminAuthModule } from "./admin-auth/admin-auth.module"
import { LicensesModule } from "./licenses/licenses.module"
import { PrismaModule } from "./prisma/prisma.module"

@Module({
  imports: [
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
  ],
})
export class AppModule {}
