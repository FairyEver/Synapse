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
const callSchema = z
  .object({ operation: z.string().max(100), params: z.record(z.string(), z.unknown()).default({}) })
  .strict()
@UseGuards(UserAuthGuard)
@Controller("/api/game")
export class GameController {
  constructor(
    private readonly api: GameApiService,
    private readonly actions: PokerActionService,
    private readonly poker: PokerService,
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
      false,
    )
  }
  @Post("/poker/rooms/:code/join") join(
    @Req() r: AuthenticatedUserRequest,
    @Param("code") code: string,
    @Body() b: Record<string, unknown>,
  ) {
    return this.api.run(r.user!.id, "app.game.poker.seat.join", { ...b, roomCode: code })
  }
  @Post("/poker/rooms/:code/leave") leave(
    @Req() r: AuthenticatedUserRequest,
    @Param("code") code: string,
  ) {
    return this.api.run(r.user!.id, "app.game.poker.seat.leave", { roomCode: code })
  }
  @Post("/poker/rooms/:code/actions") action(
    @Req() r: AuthenticatedUserRequest,
    @Param("code") code: string,
    @Body() b: Record<string, unknown>,
  ) {
    return this.api.run(r.user!.id, "app.game.poker.action.act", { ...b, roomCode: code })
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
      ...(q.offset === undefined ? {} : { offset: Number(q.offset) }),
      ...(q.limit === undefined ? {} : { limit: Number(q.limit) }),
    }
  }
}
