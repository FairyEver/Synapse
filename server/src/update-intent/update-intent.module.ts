import { type MiddlewareConsumer, Module, type NestModule } from "@nestjs/common"
import { JwtModule } from "@nestjs/jwt"
import type { NextFunction, Request, Response } from "express"
import { createUpdateIntentConfig, updateIntentConfigToken } from "./update-intent.config"
import { UpdateIntentController } from "./update-intent.controller"
import { UpdateIntentService } from "./update-intent.service"

@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => {
        const config = createUpdateIntentConfig()
        return {
          secret: config.secret,
        }
      },
    }),
  ],
  controllers: [UpdateIntentController],
  providers: [
    {
      provide: updateIntentConfigToken,
      useFactory: createUpdateIntentConfig,
    },
    UpdateIntentService,
  ],
})
export class UpdateIntentModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(setNoStore).forRoutes(UpdateIntentController)
  }
}

function setNoStore(_request: Request, response: Response, next: NextFunction): void {
  response.setHeader("Cache-Control", "no-store")
  next()
}
