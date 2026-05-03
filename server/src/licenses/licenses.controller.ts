import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  InternalServerErrorException,
  Post,
  Req,
} from "@nestjs/common"
import { z } from "zod"
import { ActivationError } from "./license.types"
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
  async redeem(
    @Body() body: unknown,
    @Req() request: { readonly ip?: string; readonly headers?: Record<string, unknown> },
  ) {
    try {
      return await this.licenses.redeem({
        ...redeemSchema.parse(body),
        ipAddress: request.ip ?? "",
        userAgent: readUserAgent(request.headers?.["user-agent"]),
      })
    } catch (error) {
      throw mapLicenseError(error)
    }
  }

  @Post("/licenses/renew")
  async renew(@Body() body: unknown) {
    try {
      return await this.licenses.renew(renewSchema.parse(body))
    } catch (error) {
      throw mapLicenseError(error)
    }
  }

  @Post("/licenses/validate")
  async validate(@Body() body: unknown) {
    try {
      return await this.licenses.validate(renewSchema.parse(body))
    } catch (error) {
      throw mapLicenseError(error)
    }
  }
}

function mapLicenseError(error: unknown): Error {
  if (error instanceof z.ZodError) {
    return new BadRequestException("授权请求无效。")
  }
  if (error instanceof ActivationError) {
    const body = { code: error.code, message: error.message }
    if (error.code === "ACTIVATION_BOUND_CONFLICT" || error.code === "ACTIVATION_DEVICE_LIMIT") {
      return new ConflictException(body)
    }
    if (error.code === "ACTIVATION_RISK_LOCKED") {
      return new ForbiddenException(body)
    }
    return new BadRequestException(body)
  }
  if (!(error instanceof Error)) {
    return new InternalServerErrorException("授权请求失败。")
  }

  if (error.message === "激活码已绑定其他账号。" || error.message === "设备数量已达上限。") {
    return new ConflictException(error.message)
  }

  if (
    error.message === "账号已停用。"
    || error.message === "授权不可用。"
    || error.message === "设备已停用。"
    || error.message === "当前设备与授权不匹配。"
  ) {
    return new ForbiddenException(error.message)
  }

  if (error.message === "激活码无效。" || error.message === "授权签名无效。") {
    return new BadRequestException(error.message)
  }

  return new InternalServerErrorException("授权请求失败。")
}

function readUserAgent(value: unknown): string {
  if (Array.isArray(value)) return value.join(" ")
  return typeof value === "string" ? value : ""
}
