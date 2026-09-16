import { Body, Controller, Delete, Get, Param, Post, Query, Req, UseGuards } from "@nestjs/common"
import { Throttle } from "@nestjs/throttler"
import type { Request } from "express"
import { z } from "zod"
import { isMobileIntent, type MobileIntent, type MobileIntentResult } from "@synapse/shared"
import { UserAuthGuard } from "../auth/user-auth.guard"
import { badRequestFromZodError } from "../common/zod-validation"
import { MobileDeviceService } from "./mobile-device.service"
import { MobileLiveRelayService } from "./mobile-live-relay.service"

const clientInstanceIdSchema = z.string().trim().min(1).max(120)

const registerDeviceSchema = z.object({
  clientInstanceId: clientInstanceIdSchema,
  deviceName: z.string().trim().min(1).max(120),
  platform: z.string().trim().min(1).max(80),
  appVersion: z.string().trim().min(1).max(80),
  pushToken: z.string().trim().min(1).max(200),
}).strict()

const intentSchema = z.object({
  clientInstanceId: clientInstanceIdSchema,
  desktopClientInstanceId: clientInstanceIdSchema,
  intent: z.custom<MobileIntent>((value) => isMobileIntent(value), { message: "不是有效的操作。" }),
  /**
   * Notification actions run without a websocket to receive the answer on, so
   * they ask the request to carry it back. In-app calls leave this off and read
   * the result from the live channel instead.
   */
  waitForResult: z.boolean().optional(),
}).strict()

const summaryQuerySchema = z.object({
  desktopClientInstanceId: clientInstanceIdSchema,
})

type AuthedRequest = Request & { readonly user: { readonly id: string } }

/**
 * The phone's HTTP surface.
 *
 * Only two things live here. Device registration, because a push token has to
 * outlive the app not being connected. And an intent fallback, because a
 * notification action can be answered from the lock screen with no socket open.
 * Everything continuous goes over the websocket instead.
 */
@Controller("/api/mobile")
@UseGuards(UserAuthGuard)
export class MobileLiveController {
  constructor(
    private readonly devices: MobileDeviceService,
    private readonly relay: MobileLiveRelayService,
  ) {}

  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @Post("/devices")
  async registerDevice(
    @Req() request: AuthedRequest,
    @Body() body: unknown,
  ): Promise<{ readonly ok: true }> {
    const input = parseBody(registerDeviceSchema, body, "设备注册请求无效。")
    await this.devices.registerPush({
      userId: request.user.id,
      clientInstanceId: input.clientInstanceId,
      token: input.pushToken,
      platform: input.platform,
      deviceName: input.deviceName,
      appVersion: input.appVersion,
    })
    return { ok: true }
  }

  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @Delete("/devices/:clientInstanceId")
  async unregisterDevice(
    @Req() request: AuthedRequest,
    @Param("clientInstanceId") clientInstanceId: string,
  ): Promise<{ readonly removed: number }> {
    return { removed: await this.devices.unregisterPush(request.user.id, clientInstanceId) }
  }

  /** Computers this account can currently reach, for the device picker. */
  @Get("/desktops")
  async listDesktops(@Req() request: AuthedRequest): Promise<{ readonly clientInstanceIds: string[] }> {
    return { clientInstanceIds: this.relay.onlineDesktops(request.user.id) }
  }

  /**
   * The last session list a desktop published. Lets the app render real content
   * on cold start instead of an empty screen while it waits for the next push.
   */
  @Get("/summary")
  async getSummary(
    @Req() request: AuthedRequest,
    @Query() query: unknown,
  ): Promise<{ readonly summary: unknown }> {
    const input = parseBody(summaryQuerySchema, query, "查询参数无效。")
    return { summary: this.relay.cachedSummary(request.user.id, input.desktopClientInstanceId) }
  }

  @Throttle({ default: { ttl: 60_000, limit: 120 } })
  @Post("/terminal/intent")
  async submitIntent(
    @Req() request: AuthedRequest,
    @Body() body: unknown,
  ): Promise<{
    readonly delivered: boolean
    readonly code?: string
    readonly result?: MobileIntentResult
  }> {
    const input = parseBody(intentSchema, body, "终端操作请求无效。")
    const outcome = await this.relay.deliverIntent({
      userId: request.user.id,
      mobileClientInstanceId: input.clientInstanceId,
      desktopClientInstanceId: input.desktopClientInstanceId,
      intent: input.intent,
      waitForResultMs: input.waitForResult ? 8_000 : 0,
    })
    if (outcome.delivery.status !== "sent") {
      return {
        delivered: false,
        code: outcome.delivery.status === "desktop_offline" ? "desktop_offline" : "relay_failed",
      }
    }
    return outcome.result ? { delivered: true, result: outcome.result } : { delivered: true }
  }
}

function parseBody<T extends z.ZodType>(schema: T, body: unknown, message: string): z.infer<T> {
  const parsed = schema.safeParse(body)
  if (!parsed.success) throw badRequestFromZodError(parsed.error, message)
  return parsed.data
}
