import { Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from "@nestjs/common"
import { Throttle } from "@nestjs/throttler"

import { UserAuthGuard } from "../auth/user-auth.guard"
import { RATE_LIMIT_TTL_MS, VOICE_ASR_SESSION_RATE_LIMIT_PER_MINUTE } from "../common/rate-limits"
import { VoiceService } from "./voice.service"

/**
 * 语音识别。
 *
 * 两个接口都不带参数：引擎和热词是服务端按平台统一决定的配置，`voiceId` 由服务端
 * 生成。调用方能决定的越少，能滥用的面就越小。
 */
@Controller("/api/voice")
@UseGuards(UserAuthGuard)
export class VoiceController {
  constructor(private readonly voice: VoiceService) {}

  /** 麦克风入口的可见性。没配密钥时客户端据此隐藏入口，而不是点了再报错。 */
  @Get("/asr")
  availability(): { readonly available: boolean } {
    return this.voice.availability()
  }

  @Throttle({ default: { ttl: RATE_LIMIT_TTL_MS, limit: VOICE_ASR_SESSION_RATE_LIMIT_PER_MINUTE } })
  @HttpCode(HttpStatus.OK)
  @Post("/asr/session")
  createSession(): { readonly url: string; readonly voiceId: string; readonly expiredAt: number } {
    return this.voice.createSession()
  }
}
