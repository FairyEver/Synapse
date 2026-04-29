import { Body, Controller, Get, Post } from "@nestjs/common"
import { z } from "zod"
import { LicensesService } from "./licenses.service"

const deviceSchema = z.object({
  deviceId: z.string().min(1),
  name: z.string().min(1),
  platform: z.string().min(1),
  appVersion: z.string().min(1),
})

const redeemSchema = z.object({
  email: z.string().email(),
  activationCode: z.string().min(1),
  device: deviceSchema,
})

const renewSchema = z.object({
  leaseToken: z.string().min(1),
  device: deviceSchema,
})

@Controller("/v1")
export class LicensesController {
  constructor(private readonly licenses: LicensesService) {}

  @Get("/license/config")
  getConfig() {
    return this.licenses.getPublicConfig()
  }

  @Post("/activations/redeem")
  redeem(@Body() body: unknown) {
    return this.licenses.redeem(redeemSchema.parse(body))
  }

  @Post("/licenses/renew")
  renew(@Body() body: unknown) {
    return this.licenses.renew(renewSchema.parse(body))
  }
}
