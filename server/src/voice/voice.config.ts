import { loadEnv } from "../config/env"

export const voiceConfigToken = Symbol("voiceConfig")

/**
 * 语音识别的部署配置。
 *
 * 这个能力是**平台统一提供**的：一把腾讯云密钥、一份配额，所有用户共用。所以它
 * 是服务端的部署事实，不是每个客户端的设置——客户端只拿签好的临时 URL。
 *
 * `configured` 为 false 时接口明确拒绝，客户端据此隐藏麦克风入口。宁可让入口不
 * 出现，也不要签出一条连不上的 URL 让用户对着麦克风白说一段。
 */
export interface VoiceConfig {
  readonly configured: boolean
  readonly appId?: string
  readonly secretId?: string
  readonly secretKey?: string
  readonly engineModelType: string
  readonly hotwordList?: string
}

export function createVoiceConfig(): VoiceConfig {
  const env = loadEnv(process.env)
  const appId = env.tencentAsrAppId
  const secretId = env.tencentAsrSecretId
  const secretKey = env.tencentAsrSecretKey
  return {
    configured: !!(appId && secretId && secretKey),
    appId,
    secretId,
    secretKey,
    engineModelType: env.tencentAsrEngineModelType,
    hotwordList: env.tencentAsrHotwordList,
  }
}
