import { ForbiddenException, Inject, Injectable, UnauthorizedException } from "@nestjs/common"
import { JwtService } from "@nestjs/jwt"
import { randomUUID } from "node:crypto"
import { z } from "zod"
import { type UpdateIntentConfig, updateIntentConfigToken } from "./update-intent.config"

const UPDATE_INTENT_LIFETIME_SECONDS = 120
const updateIntentClaimsSchema = z.object({
  type: z.literal("desktop-update-intent"),
  aud: z.literal("synapse-desktop"),
  scope: z.literal("update:latest"),
  jti: z.uuid(),
  iat: z.number().int(),
  exp: z.number().int(),
}).strict()

@Injectable()
export class UpdateIntentService {
  constructor(
    private readonly jwt: JwtService,
    @Inject(updateIntentConfigToken) private readonly config: UpdateIntentConfig,
  ) {}

  issue(origin?: string): { readonly deepLink: string; readonly expiresAt: string } {
    if (this.config.enforceOrigin && origin !== this.config.publicOrigin) {
      throw new ForbiddenException("更新凭证只能由官方更新承接页申请。")
    }
    const issuedAt = Math.floor(Date.now() / 1_000)
    const expiresAt = issuedAt + UPDATE_INTENT_LIFETIME_SECONDS
    const token = this.jwt.sign({
      type: "desktop-update-intent",
      aud: "synapse-desktop",
      scope: "update:latest",
      jti: randomUUID(),
      iat: issuedAt,
      exp: expiresAt,
    }, {
      algorithm: "HS256",
    })

    return {
      deepLink: `synapse://update?token=${encodeURIComponent(token)}`,
      expiresAt: new Date(expiresAt * 1_000).toISOString(),
    }
  }

  verify(token: string): { readonly authorized: true } {
    try {
      const payload = this.jwt.verify(token, {
        algorithms: ["HS256"],
        audience: "synapse-desktop",
      })
      const parsed = updateIntentClaimsSchema.parse(payload)
      if (parsed.exp - parsed.iat !== UPDATE_INTENT_LIFETIME_SECONDS) {
        throw new Error("Invalid update credential lifetime")
      }
      return { authorized: true }
    } catch {
      throw new UnauthorizedException("更新凭证无效或已过期。")
    }
  }
}
