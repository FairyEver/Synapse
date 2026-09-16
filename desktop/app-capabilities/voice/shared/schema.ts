import { z } from "zod"

/**
 * 语音识别由服务端统一提供：桌面端不持有腾讯云密钥，也不再有自己的设置项——
 * 引擎、热词、凭证都是部署配置，客户端只拿一条签好的临时 URL。
 */

export const voiceStatusSchema = z.object({
  /** 服务端配好腾讯云密钥了才为 true；客户端据此显不显示麦克风入口。 */
  available: z.boolean(),
}).strict()

export const voiceSessionSignInputSchema = z.object({}).strict()

export const voiceSignedSessionSchema = z.object({
  url: z.string().min(1),
  voiceId: z.string().min(1),
  expiredAt: z.number().int(),
}).strict()

export type VoiceStatus = z.infer<typeof voiceStatusSchema>
export type VoiceSessionSignInput = z.infer<typeof voiceSessionSignInputSchema>
export type VoiceSignedSession = z.infer<typeof voiceSignedSessionSchema>
