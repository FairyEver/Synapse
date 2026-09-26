import { Module, type MiddlewareConsumer, type NestModule } from "@nestjs/common"
import type { NextFunction, Request, Response } from "express"
import { UserAuthModule } from "../../auth/user-auth.module"
import { PrismaModule } from "../../prisma/prisma.module"
import { PortalHeadlessAccessService } from "./access.service"
import { PortalHeadlessController } from "./portal-headless.controller"
import { PORTAL_SDK_LOADER, PortalHeadlessService } from "./portal-headless.service"

@Module({
  imports: [UserAuthModule, PrismaModule],
  controllers: [PortalHeadlessController],
  providers: [PortalHeadlessAccessService, PortalHeadlessService, {
    provide: PORTAL_SDK_LOADER, useValue: () => import("@synapse/portal-headless"),
  }],
})
export class PortalHeadlessModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply((_request: Request, response: Response, next: NextFunction) => {
      response.setHeader("Cache-Control", "no-store")
      next()
    }).forRoutes(PortalHeadlessController)
  }
}
