import { Injectable, ForbiddenException, type CanActivate, type ExecutionContext } from "@nestjs/common"
import { userSessionCookieName } from "../auth/user-web-session"
import { PokerService } from "./poker/poker.service"
import { isCardRoom } from "./poker/poker-mode-policy"
import { reject } from "./poker/poker-error"
import type { GameWebRequest } from "./game-web.guard"

/** Complements the legacy Bearer-compatible guard; UI-only card writes require a verified Web session. */
@Injectable()
export class PokerCardWebGuard implements CanActivate {
  constructor(private readonly poker: PokerService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<GameWebRequest>()
    const invokeCreation = /\/invoke\/?$/i.test(request.path) && request.body?.operation === "app.game.poker.room.create"
    if (["GET", "HEAD", "OPTIONS"].includes(request.method) || /\/invoke\/?$/i.test(request.path) && !invokeCreation) return true
    const payload = request.body?.params ?? request.body
    const cardRoute = /\/card\/(?:play|choose)\/?$/i.test(request.path)
    const creation = invokeCreation || /\/poker\/rooms\/?$/i.test(request.path)
    let required = cardRoute || creation && payload?.ruleOptions?.cards === true
    if (!required && typeof request.params.code === "string") {
      const code = request.params.code
      if (!/^\d{4,6}$/.test(code)) reject("POKER_ILLEGAL_ACTION", "房间号无效。")
      const room = await this.poker.prisma.gamePokerRoom.findUnique({ where: { code }, select: { cardRulesVersion: true, ruleOptions: true } })
      // Known rooms have immutable rules. Reject absent rooms so a creation race cannot turn a Bearer UI write into a human one.
      if (!room) reject("POKER_ROOM_NOT_FOUND", "房间不存在。")
      required = isCardRoom(room)
    }
    if (!required) return true
    if (request.gameTransport !== "cookie" || typeof request.cookies?.[userSessionCookieName] !== "string") throw new ForbiddenException({ code: "POKER_CARD_AI_DISABLED", message: "卡牌房仅支持通过网页会话操作。" })
    if (!request.gameRulesSupported) throw new ForbiddenException({ code: "POKER_CARD_VERSION_UNSUPPORTED", message: "客户端不支持当前卡牌规则。" })
    return true
  }
}
