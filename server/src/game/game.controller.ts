import {
  BadRequestException,
  HttpException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common"
import type { Response } from "express"
import { z } from "zod"
import { UserAuthGuard, type AuthenticatedUserRequest } from "../auth/user-auth.guard"
import { GameApiService } from "./game-api.service"
import { PokerActionService } from "./poker/poker-action.service"
import { PokerService } from "./poker/poker.service"
import { PokerEventsService } from "./poker/poker-events.service"
import { GameWebGuard } from "./game-web.guard"
const callSchema = z
  .object({ operation: z.string().max(100), params: z.record(z.string(), z.unknown()).default({}) })
  .strict()
@UseGuards(UserAuthGuard, GameWebGuard)
@Controller("/api/game")
export class GameController {
  constructor(
    private readonly api: GameApiService,
    private readonly actions: PokerActionService,
    private readonly poker: PokerService,
    private readonly events: PokerEventsService = new PokerEventsService(poker),
  ) {}
  @Post("/invoke")
  invoke(
    @Req() req: AuthenticatedUserRequest,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const parsed = callSchema.safeParse(body)
    if (!parsed.success) throw new BadRequestException("游戏请求无效。")
    const abort = new AbortController(),
      cancel = () => abort.abort()
    response.once("close", cancel)
    return this.api
      .run(req.user!.id, parsed.data.operation, parsed.data.params, abort.signal)
      .then((data) => ({ ok: true, data }))
      .catch((error: unknown) => {
        if (error instanceof HttpException && error.getStatus() < 500)
          return { ok: false, failure: error.getResponse() }
        throw error
      })
      .finally(() => response.removeListener("close", cancel))
  }
  @Get("/hall/overview") overview(@Req() r: AuthenticatedUserRequest) {
    return this.api.run(r.user!.id, "app.game.hall.overview", {})
  }
  @Get("/hall/account") account(@Req() r: AuthenticatedUserRequest) {
    return this.api.run(r.user!.id, "app.game.hall.account", {})
  }
  @Get("/hall/sessions") async sessions(@Req() r: AuthenticatedUserRequest) {
    return ((await this.api.run(r.user!.id, "app.game.hall.overview", {})) as { sessions: unknown })
      .sessions
  }
  @Post("/hall/grant") grant(@Req() r: AuthenticatedUserRequest) {
    return this.api.run(r.user!.id, "app.game.hall.account", { claimGrant: true })
  }
  @Get("/poker/lobby") lobby(
    @Req() r: AuthenticatedUserRequest,
    @Query() q: Record<string, string>,
  ) {
    return this.api.run(r.user!.id, "app.game.poker.lobby.list", this.page(q))
  }
  @Post("/poker/rooms") create(@Req() r: AuthenticatedUserRequest, @Body() b: unknown) {
    return this.api.run(r.user!.id, "app.game.poker.room.create", b)
  }
  @Get("/poker/rooms/:code") room(@Req() r: AuthenticatedUserRequest, @Param("code") code: string) {
    return this.api.run(r.user!.id, "app.game.poker.room.get", { roomCode: code })
  }
  @Get("/poker/rooms/:code/state") state(
    @Req() r: AuthenticatedUserRequest,
    @Param("code") code: string,
    @Query("perspective") perspective?: string,
  ) {
    return this.actions.state(
      r.user!.id,
      code,
      perspective === "public" ? "public" : "owner",
      true,
      new Date(),
      "desktop",
    )
  }
  @Post("/poker/rooms/:code/join") join(
    @Req() r: AuthenticatedUserRequest,
    @Param("code") code: string,
    @Body() b: Record<string, unknown>,
  ) {
    return this.api.run(r.user!.id, "app.game.poker.seat.join", this.uiParams(b, "app.game.poker.seat.join", code), undefined, "human")
  }
  @Post("/poker/rooms/:code/ready") ready(@Req() r: AuthenticatedUserRequest, @Param("code") code: string, @Body() b: unknown) {
    return this.api.run(r.user!.id, "app.game.poker.seat.ready", this.uiParams(b, "app.game.poker.seat.ready", code), undefined, "human")
  }
  @Post("/poker/rooms/:code/leave") leave(
    @Req() r: AuthenticatedUserRequest,
    @Param("code") code: string,
    @Body() b: unknown,
  ) {
    return this.api.run(r.user!.id, "app.game.poker.seat.leave", this.uiParams(b, "app.game.poker.seat.leave", code), undefined, "human")
  }
  @Post("/poker/rooms/:code/sit") sit(@Req() r: AuthenticatedUserRequest, @Param("code") code: string, @Body() b: unknown) {
    return this.api.run(r.user!.id, "app.game.poker.seat.sit", this.uiParams(b, "app.game.poker.seat.sit", code), undefined, "human")
  }
  @Post("/poker/rooms/:code/control") control(@Req() r: AuthenticatedUserRequest, @Param("code") code: string, @Body() b: unknown) {
    const parsed = z.object({ roomCode: z.string().regex(/^\d{4,6}$/), controlVersion: z.number().int().nonnegative(), action: z.enum(["takeover", "request_ai", "cancel_ai"]) }).strict().safeParse(this.uiParams(b, "app.game.poker.control.set", code))
    if (!parsed.success) throw new BadRequestException("控制权请求无效。")
    return this.poker.control(r.user!.id, code, parsed.data.action, parsed.data.controlVersion)
  }
  @Get("/poker/rooms/:code/events") tableEvents(@Req() r: AuthenticatedUserRequest, @Param("code") code: string, @Query("cursor") cursor?: string, @Query("limit") limit?: string, @Query("perspective") perspective?: string) {
    if (perspective !== undefined && perspective !== "owner" && perspective !== "public") throw new BadRequestException("观看视角无效。")
    return this.events.events(r.user!.id, code, cursor ?? "", limit === undefined ? 100 : Number(limit), "desktop", perspective ?? "public")
  }
  @Post("/poker/rooms/:code/actions") action(
    @Req() r: AuthenticatedUserRequest,
    @Param("code") code: string,
    @Body() b: Record<string, unknown>,
  ) {
    return this.api.run(r.user!.id, "app.game.poker.action.act", this.uiParams(b, "app.game.poker.action.act", code), undefined, "human")
  }
  @Post("/poker/rooms/:code/close") close(
    @Req() r: AuthenticatedUserRequest,
    @Param("code") code: string,
  ) {
    return this.poker.close(r.user!.id, code)
  }
  @Get("/poker/agents") agents(@Req() r: AuthenticatedUserRequest) {
    return this.api.run(r.user!.id, "app.game.poker.agent.list", {})
  }
  @Put("/poker/agents/:id") agent(
    @Req() r: AuthenticatedUserRequest,
    @Param("id") id: string,
    @Body() b: Record<string, unknown>,
  ) {
    return this.api.run(r.user!.id, "app.game.poker.agent.upsert", { ...b, id })
  }
  @Get("/poker/agents/:id/versions") versions(
    @Req() r: AuthenticatedUserRequest,
    @Param("id") id: string,
  ) {
    return this.api.run(r.user!.id, "app.game.poker.agent.versions", { agentId: id })
  }
  @Get("/poker/history") history(
    @Req() r: AuthenticatedUserRequest,
    @Query() q: Record<string, string>,
  ) {
    return this.api.run(r.user!.id, "app.game.poker.hand.history", this.page(q))
  }
  @Get("/poker/hands/:handNo") detail(
    @Req() r: AuthenticatedUserRequest,
    @Param("handNo") no: string,
    @Query("roomCode") code: string,
  ) {
    return this.api.run(r.user!.id, "app.game.poker.hand.detail", {
      roomCode: code,
      handNo: Number(no),
    })
  }
  private page(q: Record<string, string>) {
    return {
      ...(q.mode === undefined ? {} : { mode: q.mode }),
      ...(q.offset === undefined ? {} : { offset: Number(q.offset) }),
      ...(q.limit === undefined ? {} : { limit: Number(q.limit) }),
    }
  }
  private uiParams(body: unknown, operation: string, code: string): Record<string, unknown> {
    const envelope = callSchema.safeParse(body)
    if (envelope.success) {
      if (envelope.data.operation !== operation) throw new BadRequestException("游戏操作与入口不匹配。")
      return { ...envelope.data.params, roomCode: code }
    }
    if (body != null && (typeof body !== "object" || Array.isArray(body))) throw new BadRequestException("游戏请求无效。")
    return { ...body as Record<string, unknown>, roomCode: code }
  }
}
