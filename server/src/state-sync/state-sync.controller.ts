import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req, Res, UseFilters, UseGuards } from "@nestjs/common"
import { SkipThrottle } from "@nestjs/throttler"
import type { Response } from "express"
import { openApiRequestId, type OpenApiRequest } from "../open-api/open-api.types"
import {
  StateSyncExceptionFilter,
  StateSyncGuard,
  isStateSyncOpenPath,
  type StateSyncRequest,
} from "./state-sync-http"
import { StateSyncService } from "./state-sync.service"

@Controller(["/api/open/v1/state-sync", "/api/console/state-sync"])
@SkipThrottle()
@UseGuards(StateSyncGuard)
@UseFilters(StateSyncExceptionFilter)
export class StateSyncController {
  constructor(private readonly stateSync: StateSyncService) {}

  private prepareResponse(req: StateSyncRequest, res: Response): void {
    res.setHeader("X-Request-Id", openApiRequestId(req as OpenApiRequest))
    res.setHeader("Cache-Control", "no-store")
  }

  @Get("preflight")
  preflight(@Req() req: StateSyncRequest, @Res({ passthrough: true }) res: Response) {
    this.prepareResponse(req, res)
    return this.stateSync.getPreflight(req.stateSyncActor)
  }

  @Get("spaces")
  listSpaces(@Req() req: StateSyncRequest, @Res({ passthrough: true }) res: Response) {
    this.prepareResponse(req, res)
    return this.stateSync.listSpaces(req.stateSyncActor)
  }

  @Post("spaces")
  createSpace(@Req() req: StateSyncRequest, @Res({ passthrough: true }) res: Response, @Body() body: unknown) {
    this.prepareResponse(req, res)
    return this.stateSync.createSpace(req.stateSyncActor, body)
  }

  @Get("spaces/:spaceId")
  getSpace(
    @Req() req: StateSyncRequest,
    @Res({ passthrough: true }) res: Response,
    @Param("spaceId") spaceId: string,
  ) {
    this.prepareResponse(req, res)
    return this.stateSync.getSpace(req.stateSyncActor, spaceId)
  }

  @Patch("spaces/:spaceId")
  updateSpace(
    @Req() req: StateSyncRequest,
    @Res({ passthrough: true }) res: Response,
    @Param("spaceId") spaceId: string,
    @Body() body: unknown,
  ) {
    this.prepareResponse(req, res)
    return this.stateSync.updateSpace(req.stateSyncActor, spaceId, body)
  }

  @Delete("spaces/:spaceId")
  deleteSpace(
    @Req() req: StateSyncRequest,
    @Res({ passthrough: true }) res: Response,
    @Param("spaceId") spaceId: string,
  ) {
    this.prepareResponse(req, res)
    return this.stateSync.deleteSpace(req.stateSyncActor, spaceId)
  }

  @Get("spaces/:spaceId/tokens")
  listTokens(
    @Req() req: StateSyncRequest,
    @Res({ passthrough: true }) res: Response,
    @Param("spaceId") spaceId: string,
  ) {
    this.prepareResponse(req, res)
    return this.stateSync.listTokens(req.stateSyncActor, spaceId)
  }

  @Post("spaces/:spaceId/tokens")
  createToken(
    @Req() req: StateSyncRequest,
    @Res({ passthrough: true }) res: Response,
    @Param("spaceId") spaceId: string,
    @Body() body: unknown,
  ) {
    this.prepareResponse(req, res)
    return this.stateSync.createToken(req.stateSyncActor, spaceId, body)
  }

  @Delete("spaces/:spaceId/tokens/:tokenId")
  revokeToken(
    @Req() req: StateSyncRequest,
    @Res({ passthrough: true }) res: Response,
    @Param("spaceId") spaceId: string,
    @Param("tokenId") tokenId: string,
  ) {
    this.prepareResponse(req, res)
    return this.stateSync.revokeToken(req.stateSyncActor, spaceId, tokenId)
  }

  @Get("spaces/:spaceId/docs")
  listDocs(
    @Req() req: StateSyncRequest,
    @Res({ passthrough: true }) res: Response,
    @Param("spaceId") spaceId: string,
    @Query("limit") limit?: string,
    @Query("cursor") cursor?: string,
  ) {
    this.prepareResponse(req, res)
    return this.stateSync.listDocs(req.stateSyncActor, spaceId, { limit, cursor })
  }

  @Post("spaces/:spaceId/docs")
  createDoc(
    @Req() req: StateSyncRequest,
    @Res({ passthrough: true }) res: Response,
    @Param("spaceId") spaceId: string,
    @Body() body: unknown,
  ) {
    this.prepareResponse(req, res)
    const enforceHttpRateLimit = isStateSyncOpenPath(req.path ?? req.originalUrl ?? "")
    return this.stateSync.createDoc(req.stateSyncActor, spaceId, body, {
      enforceHttpRateLimit,
      onRateLimited: (retryAfterSec) => {
        res.setHeader("Retry-After", String(retryAfterSec))
      },
    })
  }

  @Get("spaces/:spaceId/docs/:docId")
  getDoc(
    @Req() req: StateSyncRequest,
    @Res({ passthrough: true }) res: Response,
    @Param("spaceId") spaceId: string,
    @Param("docId") docId: string,
    @Query("path") path?: string,
  ) {
    this.prepareResponse(req, res)
    return this.stateSync.getDoc(req.stateSyncActor, spaceId, docId, path)
  }

  @Patch("spaces/:spaceId/docs/:docId")
  @HttpCode(200)
  mutateDoc(
    @Req() req: StateSyncRequest,
    @Res({ passthrough: true }) res: Response,
    @Param("spaceId") spaceId: string,
    @Param("docId") docId: string,
    @Body() body: unknown,
  ) {
    this.prepareResponse(req, res)
    const enforceHttpRateLimit = isStateSyncOpenPath(req.path ?? req.originalUrl ?? "")
    return this.stateSync.mutateDoc(req.stateSyncActor, spaceId, docId, body, {
      enforceHttpRateLimit,
      onRateLimited: (retryAfterSec) => {
        res.setHeader("Retry-After", String(retryAfterSec))
      },
    })
  }

  @Delete("spaces/:spaceId/docs/:docId")
  deleteDoc(
    @Req() req: StateSyncRequest,
    @Res({ passthrough: true }) res: Response,
    @Param("spaceId") spaceId: string,
    @Param("docId") docId: string,
  ) {
    this.prepareResponse(req, res)
    return this.stateSync.deleteDoc(req.stateSyncActor, spaceId, docId)
  }

  @Get("spaces/:spaceId/docs/:docId/presence")
  presence(
    @Req() req: StateSyncRequest,
    @Res({ passthrough: true }) res: Response,
    @Param("spaceId") spaceId: string,
    @Param("docId") docId: string,
  ) {
    this.prepareResponse(req, res)
    return this.stateSync.getPresence(req.stateSyncActor, spaceId, docId)
  }

  @Post("spaces/:spaceId/docs/:docId/debug-ticket")
  @HttpCode(200)
  debugTicket(
    @Req() req: StateSyncRequest,
    @Res({ passthrough: true }) res: Response,
    @Param("spaceId") spaceId: string,
    @Param("docId") docId: string,
  ) {
    this.prepareResponse(req, res)
    return this.stateSync.issueDebugTicket(req.stateSyncActor, spaceId, docId)
  }
}
