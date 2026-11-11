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
import { TunnelBroker } from "./tunnel-broker"
import { TunnelGateway } from "./tunnel-gateway"
import { UserAuthService } from "../auth/user-auth.service"
import { TunnelIngress } from "./tunnel-ingress"
@Module({ imports: [UserAuthModule, PrismaModule], controllers: [TunnelController], providers: [TunnelRepository,
  { provide: TunnelService, inject: [TunnelRepository], useFactory: (repository: TunnelRepository) => {
    const env = loadEnv(process.env)
    return new TunnelService(repository, { enabled: env.tunnelEnabled, publicDomain: env.tunnelPublicDomain ?? "tunnel.invalid", mappingsPerUser: TUNNEL_LIMITS.mappingsPerUser })
  } },
  { provide: TunnelDeviceService, inject: [TunnelRepository], useFactory: (repository: TunnelRepository) => new TunnelDeviceService(repository) },
  { provide: TunnelBroker, inject: [TunnelService], useFactory: (service: TunnelService) => new TunnelBroker(service) },
  { provide: TunnelGateway, inject: [TunnelService, TunnelDeviceService, TunnelBroker, UserAuthService], useFactory: (service: TunnelService, devices: TunnelDeviceService, broker: TunnelBroker, auth: UserAuthService) => new TunnelGateway({ service, devices, broker, verifyToken: token => auth.verifyAccessToken(token) }) },
  { provide: TunnelIngress, inject: [TunnelService, TunnelBroker], useFactory: (service: TunnelService, broker: TunnelBroker) => new TunnelIngress(service, broker) },
], exports: [TunnelService, TunnelDeviceService, TunnelBroker, TunnelGateway, TunnelIngress] })
export class TunnelModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply((_req: Request, res: Response, next: NextFunction) => { res.setHeader("Cache-Control", "private, no-store"); next() }).forRoutes(TunnelController)
  }
}
