import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req, Res, UseFilters, UseGuards } from "@nestjs/common"
import { SkipThrottle } from "@nestjs/throttler"
import type { Response } from "express"
import { OpenApiExceptionFilter } from "../open-api/open-api-exception.filter"
import { openApiRequestId, type OpenApiRequest } from "../open-api/open-api.types"
import { ChannelGuard, isChannelOpenPath, type ChannelRequest } from "./channel-http"
import { ChannelService } from "./channel.service"

@Controller(["/api/open/v1/channels", "/api/console/channels"])
@SkipThrottle()
@UseGuards(ChannelGuard)
@UseFilters(OpenApiExceptionFilter)
export class ChannelController {
  constructor(private readonly channels: ChannelService) {}

  private prepareResponse(req: ChannelRequest, res: Response): void {
    res.setHeader("X-Request-Id", openApiRequestId(req as OpenApiRequest))
    res.setHeader("Cache-Control", "no-store")
  }

  @Get("publish-preflight")
  publishPreflight(@Req() req: ChannelRequest, @Res({ passthrough: true }) res: Response) {
    this.prepareResponse(req, res)
    return this.channels.getPublishPreflight(req.channelActor)
  }

  @Get()
  list(@Req() req: ChannelRequest, @Res({ passthrough: true }) res: Response) {
    this.prepareResponse(req, res)
    return this.channels.listChannels(req.channelActor)
  }

  @Post()
  create(@Req() req: ChannelRequest, @Res({ passthrough: true }) res: Response, @Body() body: unknown) {
    this.prepareResponse(req, res)
    return this.channels.createChannel(req.channelActor, body)
  }

  @Get(":channelId")
  get(@Req() req: ChannelRequest, @Res({ passthrough: true }) res: Response, @Param("channelId") channelId: string) {
    this.prepareResponse(req, res)
    return this.channels.getChannel(req.channelActor, channelId)
  }

  @Patch(":channelId")
  update(
    @Req() req: ChannelRequest,
    @Res({ passthrough: true }) res: Response,
    @Param("channelId") channelId: string,
    @Body() body: unknown,
  ) {
    this.prepareResponse(req, res)
    return this.channels.updateChannel(req.channelActor, channelId, body)
  }

  @Delete(":channelId")
  delete(@Req() req: ChannelRequest, @Res({ passthrough: true }) res: Response, @Param("channelId") channelId: string) {
    this.prepareResponse(req, res)
    return this.channels.deleteChannel(req.channelActor, channelId)
  }

  @Get(":channelId/tokens")
  listTokens(@Req() req: ChannelRequest, @Res({ passthrough: true }) res: Response, @Param("channelId") channelId: string) {
    this.prepareResponse(req, res)
    return this.channels.listTokens(req.channelActor, channelId)
  }

  @Post(":channelId/tokens")
  createToken(
    @Req() req: ChannelRequest,
    @Res({ passthrough: true }) res: Response,
    @Param("channelId") channelId: string,
    @Body() body: unknown,
  ) {
    this.prepareResponse(req, res)
    return this.channels.createToken(req.channelActor, channelId, body)
  }

  @Delete(":channelId/tokens/:tokenId")
  revokeToken(
    @Req() req: ChannelRequest,
    @Res({ passthrough: true }) res: Response,
    @Param("channelId") channelId: string,
    @Param("tokenId") tokenId: string,
  ) {
    this.prepareResponse(req, res)
    return this.channels.revokeToken(req.channelActor, channelId, tokenId)
  }

  @Post(":channelId/debug-ticket")
  @HttpCode(200)
  debugTicket(@Req() req: ChannelRequest, @Res({ passthrough: true }) res: Response, @Param("channelId") channelId: string) {
    this.prepareResponse(req, res)
    return this.channels.issueDebugTicket(req.channelActor, channelId)
  }

  @Post(":channelId/events")
  @HttpCode(200)
  publishEvent(
    @Req() req: ChannelRequest,
    @Res({ passthrough: true }) res: Response,
    @Param("channelId") channelId: string,
    @Body() body: unknown,
  ) {
    this.prepareResponse(req, res)
    const enforceHttpRateLimit = isChannelOpenPath(req.path ?? req.originalUrl ?? "")
    return this.channels.publishEvent(req.channelActor, channelId, body, {
      enforceHttpRateLimit,
      onRateLimited: (retryAfterSec) => {
        res.setHeader("Retry-After", String(retryAfterSec))
      },
    })
  }

  @Get(":channelId/presence")
  presence(@Req() req: ChannelRequest, @Res({ passthrough: true }) res: Response, @Param("channelId") channelId: string) {
    this.prepareResponse(req, res)
    return this.channels.getPresence(req.channelActor, channelId)
  }

  @Get(":channelId/retained")
  retained(@Req() req: ChannelRequest, @Res({ passthrough: true }) res: Response, @Param("channelId") channelId: string) {
    this.prepareResponse(req, res)
    return this.channels.listRetained(req.channelActor, channelId)
  }

  @Get(":channelId/state")
  state(@Req() req: ChannelRequest, @Res({ passthrough: true }) res: Response, @Param("channelId") channelId: string) {
    this.prepareResponse(req, res)
    return this.channels.getConsoleState(req.channelActor, channelId)
  }

  @Delete(":channelId/retained/:event")
  clearRetained(
    @Req() req: ChannelRequest,
    @Res({ passthrough: true }) res: Response,
    @Param("channelId") channelId: string,
    @Param("event") event: string,
  ) {
    this.prepareResponse(req, res)
    return this.channels.clearRetained(req.channelActor, channelId, event)
  }
}
