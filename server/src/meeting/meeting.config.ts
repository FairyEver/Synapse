import { loadEnv } from "../config/env"

export const meetingConfigToken = Symbol("meetingConfig")

/**
 * 会议转写的部署配置。
 *
 * 腾讯云的密钥是**平台级**的，只在服务端：桌面端把分片交给服务端，服务端拼好对象、
 * 签一个下载地址、提交任务，全程不接触 SecretKey。这与现有语音输入的约定一致。
 *
 * `configured` 为 false 时不提交任务，任务记录会停在待提交并写明原因——宁可让用户
 * 看到「转写失败」并知道是环境没配，也不要让一次录音静静地卡在那里。
 */
export interface MeetingConfig {
  readonly configured: boolean
  readonly secretId?: string
  readonly secretKey?: string
  readonly region: string
  readonly engineModelType: string
  readonly hotwordList?: string
  /** 关掉之后既不提交也不轮询，表里的任务原样留着。 */
  readonly transcriptionEnabled: boolean
}

export function createMeetingConfig(): MeetingConfig {
  const env = loadEnv(process.env)
  const secretId = env.tencentAsrSecretId
  const secretKey = env.tencentAsrSecretKey
  return {
    configured: !!(secretId && secretKey),
    secretId,
    secretKey,
    region: env.tencentAsrRegion,
    engineModelType: env.tencentAsrMeetingEngineModelType,
    hotwordList: env.tencentAsrHotwordList,
    transcriptionEnabled: env.meetingTranscriptionEnabled,
  }
}
