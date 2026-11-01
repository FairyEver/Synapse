import { CanActivate, ConflictException, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common"
import { GAME_WEB_IDENTITY_HEADER, GAME_WEB_INVOKE_OPERATIONS } from "@synapse/shared/game-ui"
import type { AuthenticatedUserRequest } from "../auth/user-auth.guard"
import { resolvePublicAppUrl } from "../common/public-app-url"

// Only the two fixed local Web entrypoints may share development Cookie calls.
const localWebOrigins = new Set(["http://localhost:19700", "http://localhost:19703"])

/** UserAuthGuard runs first. Browser-only checks never change Bearer callers. */
@Injectable()
export class GameWebGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedUserRequest>()
    if (/^bearer\s+\S+/i.test(request.headers.authorization ?? "")) return true
    if (!request.user || request.headers[GAME_WEB_IDENTITY_HEADER] !== request.user.id) {
      throw new ConflictException({ code: "GAME_IDENTITY_CHANGED", message: "登录账号已变更，请重新载入。" })
    }
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      const origin = request.headers.origin
      const expectedOrigin = new URL(resolvePublicAppUrl({ configuredPublicAppUrl: process.env.APP_PUBLIC_URL, request })).origin
      const isLocalDevOrigin = process.env.NODE_ENV !== "production"
        && localWebOrigins.has(expectedOrigin) && !!origin && localWebOrigins.has(origin)
      if ((origin && origin !== expectedOrigin && !isLocalDevOrigin) || request.headers["sec-fetch-site"] === "cross-site"
        || (!origin && request.headers["sec-fetch-site"] !== "same-origin")) {
        throw new ForbiddenException("游戏请求来源无效。")
      }
    }
    if (/\/invoke\/?$/i.test(request.path) && !GAME_WEB_INVOKE_OPERATIONS.includes(request.body?.operation)) {
      throw new ForbiddenException("此操作不能通过浏览器调用。")
    }
    return true
  }
}
