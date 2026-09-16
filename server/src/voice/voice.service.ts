import { Inject, Injectable, ServiceUnavailableException } from "@nestjs/common"

import { newAsrVoiceId, signAsrSession, type AsrSignedSession } from "./asr-signature"
import { voiceConfigToken, type VoiceConfig } from "./voice.config"

/**
 * 平台统一提供的语音识别签名。
 *
 * 密钥只留在服务端：客户端拿到的是一条已经带好 `signature` 的 wss URL，它拿着直连
 * 腾讯云，全程不接触 SecretKey。签名原文只覆盖握手参数、不含音频数据，所以可以脱
 * 离音频流预先签好。
 */
@Injectable()
export class VoiceService {
  constructor(
    @Inject(voiceConfigToken) private readonly config: VoiceConfig,
  ) {}

  /** 客户端据此决定显不显示麦克风入口。 */
  availability(): { readonly available: boolean } {
    return { available: this.config.configured }
  }

  /**
   * 签一条可以直连的会话。
   *
   * `voiceId` 由服务端生成而不是由调用方指定：它每次连接都必须换新的，交给调用方
   * 只会多一个能被复用、能被猜到的输入面。
   */
  createSession(): AsrSignedSession {
    const { appId, secretId, secretKey } = this.config
    if (!appId || !secretId || !secretKey) {
      // 部署侧的问题，不是调用方的问题：502 而不是 4xx。
      throw new ServiceUnavailableException({
        code: "VOICE_ASR_NOT_CONFIGURED",
        message: "语音识别暂不可用。",
      })
    }
    return signAsrSession(
      { appId, secretId, secretKey },
      {
        engineModelType: this.config.engineModelType,
        voiceId: newAsrVoiceId(),
        hotwordList: this.config.hotwordList,
      },
    )
  }
}
