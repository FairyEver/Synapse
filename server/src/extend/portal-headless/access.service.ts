import { createHmac } from "node:crypto"
import { Injectable, UnauthorizedException } from "@nestjs/common"
import { JwtService } from "@nestjs/jwt"
import { loadEnv } from "../../config/env"
import { PrismaService } from "../../prisma/prisma.service"

const issuer = "synapse.extend"
const audience = "portal-headless"
const lifetimeSeconds = 300

@Injectable()
export class PortalHeadlessAccessService {
  private readonly jwt = new JwtService({
    // Domain-separated key: an extension token cannot authenticate ordinary SY APIs.
    secret: createHmac("sha256", loadEnv(process.env).userAccessJwtSecret)
      .update("synapse/extend/portal-headless/access/v1").digest("base64url"),
  })
  constructor(private readonly prisma: PrismaService) {}

  issue(userId: string): { accessToken: string; expiresAt: string } {
    const now = Math.floor(Date.now() / 1000)
    return {
      accessToken: this.jwt.sign({ sub: userId, scope: "read", iat: now }, {
        algorithm: "HS256", issuer, audience, expiresIn: lifetimeSeconds,
      }),
      expiresAt: new Date((now + lifetimeSeconds) * 1000).toISOString(),
    }
  }

  async verify(authorization: string | undefined): Promise<string> {
    let payload: { sub: string; scope: string; iat: number }
    try {
      const match = /^Bearer ([^\s]+)$/i.exec(authorization ?? "")
      if (!match || match[1].length > 8192) throw new Error("invalid_token")
      payload = this.jwt.verify(match[1], { algorithms: ["HS256"], issuer, audience })
      if (typeof payload.sub !== "string" || !payload.sub || payload.scope !== "read" || !Number.isSafeInteger(payload.iat)) {
        throw new Error("invalid_claims")
      }
    } catch {
      throw new UnauthorizedException({ code: "SY_EXTENSION_AUTH_REQUIRED", message: "扩展授权已失效，请通过本机 MCP 重新获取凭证。" })
    }
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub }, select: { status: true, passwordChangedAt: true },
    })
    if (!user || user.status !== "active" || (user.passwordChangedAt && payload.iat <= Math.floor(user.passwordChangedAt.getTime() / 1000))) {
      throw new UnauthorizedException({ code: "SY_EXTENSION_AUTH_REQUIRED", message: "Synapse 账号不可用，请重新登录。" })
    }
    return payload.sub
  }
}
