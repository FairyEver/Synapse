import { MiddlewareConsumer, Module, type NestModule } from "@nestjs/common"
import type { NextFunction, Request, Response } from "express"
import { UserAuthModule } from "../auth/user-auth.module"
import { PrismaModule } from "../prisma/prisma.module"
import { loadEnv } from "../config/env"
import { TUNNEL_LIMITS } from "@synapse/shared/tunnel-contracts"
import { TunnelController } from "./tunnel.controller"
import { TunnelRepository } from "./tunnel.repository"
import { TunnelService } from "./tunnel.service"
import { TunnelDeviceService } from "./tunnel-device.service"
@Module({ imports: [UserAuthModule, PrismaModule], controllers: [TunnelController], providers: [TunnelRepository,
  { provide: TunnelService, inject: [TunnelRepository], useFactory: (repository: TunnelRepository) => {
    const env = loadEnv(process.env)
    return new TunnelService(repository, { enabled: env.tunnelEnabled, publicDomain: env.tunnelPublicDomain ?? "tunnel.invalid", mappingsPerUser: TUNNEL_LIMITS.mappingsPerUser })
  } },
  { provide: TunnelDeviceService, inject: [TunnelRepository], useFactory: (repository: TunnelRepository) => new TunnelDeviceService(repository) },
], exports: [TunnelService, TunnelDeviceService] })
export class TunnelModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply((_req: Request, res: Response, next: NextFunction) => { res.setHeader("Cache-Control", "private, no-store"); next() }).forRoutes(TunnelController)
  }
}
