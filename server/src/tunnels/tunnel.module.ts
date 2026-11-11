import { MiddlewareConsumer, Module, type NestModule } from "@nestjs/common"
import type { NextFunction, Request, Response } from "express"
import { UserAuthModule } from "../auth/user-auth.module"
import { PrismaModule } from "../prisma/prisma.module"
import { loadEnv } from "../config/env"
import { TunnelBudget } from "./tunnel-budget"
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
    return new TunnelService(repository, { enabled: env.tunnelEnabled, publicDomain: env.tunnelPublicDomain ?? "tunnel.invalid", mappingsPerUser: env.tunnelMaxMappingsPerUser })
  } },
  { provide: TunnelDeviceService, inject: [TunnelRepository], useFactory: (repository: TunnelRepository) => new TunnelDeviceService(repository) },
  { provide: TunnelBroker, inject: [TunnelService], useFactory: (service: TunnelService) => { const env = loadEnv(process.env); return new TunnelBroker(service, { budget: new TunnelBudget({ mapping: env.tunnelMaxStreamsPerMapping, user: env.tunnelMaxStreamsPerUser, global: env.tunnelMaxStreamsGlobal }) }) } },
  { provide: TunnelGateway, inject: [TunnelService, TunnelDeviceService, TunnelBroker, UserAuthService], useFactory: (service: TunnelService, devices: TunnelDeviceService, broker: TunnelBroker, auth: UserAuthService) => new TunnelGateway({ service, devices, broker, bufferedBytes: loadEnv(process.env).tunnelMaxBufferedBytesGlobal, verifyToken: token => auth.verifyAccessToken(token) }) },
  { provide: TunnelIngress, inject: [TunnelService, TunnelBroker], useFactory: (service: TunnelService, broker: TunnelBroker) => new TunnelIngress(service, broker) },
], exports: [TunnelService, TunnelDeviceService, TunnelBroker, TunnelGateway, TunnelIngress] })
export class TunnelModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply((_req: Request, res: Response, next: NextFunction) => { res.setHeader("Cache-Control", "private, no-store"); next() }).forRoutes(TunnelController)
  }
}
