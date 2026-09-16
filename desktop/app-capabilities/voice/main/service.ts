import type { VoiceSignedSession, VoiceStatus } from "../shared/schema"

export type VoiceLogger = {
  info(message: string, meta?: Record<string, unknown>): void
  warn(message: string, meta?: Record<string, unknown>): void
}

/**
 * 用登录态向服务端发一个请求。由装配层绑到 `AccountService.fetchAuthenticated` 上，
 * 这样这一层不用知道账户是怎么存的、令牌是怎么刷的。
 */
export type VoiceAuthenticatedFetch = (
  path: string,
  init?: RequestInit,
  errorMessage?: string,
) => Promise<Response>

export type VoiceServiceDeps = {
  readonly fetchAuthenticated: VoiceAuthenticatedFetch
  readonly logger: VoiceLogger
}

/** 服务端没配腾讯云密钥。客户端据此隐藏麦克风入口，不弹错误框。 */
export class VoiceUnavailableError extends Error {
  readonly code = "voice_unavailable"

  constructor() {
    super("语音识别暂不可用。")
    this.name = "VoiceUnavailableError"
  }
}

/**
 * 语音识别的桌面侧。
 *
 * 这里**不签名**：腾讯云密钥是平台级的，只存在于服务端。桌面端做的事是把登录态
 * 带上、替渲染进程去问一条签好的 URL，再把响应原样交回去。密钥从头到尾没有到过
 * 这台机器。
 */
export function createVoiceService(deps: VoiceServiceDeps) {
  async function getStatus(): Promise<VoiceStatus> {
    try {
      const response = await deps.fetchAuthenticated("/voice/asr", {}, "读取语音识别状态失败。")
      const body = await response.json() as { available?: unknown }
      return { available: body.available === true }
    } catch (error) {
      // 服务端不可达时按"不可用"处理：入口不出现，比出现一个点了必然失败的按钮好。
      deps.logger.warn("Failed to read voice availability.", {
        errorName: error instanceof Error ? error.name : typeof error,
      })
      return { available: false }
    }
  }

  async function signSession(): Promise<VoiceSignedSession> {
    const response = await deps.fetchAuthenticated(
      "/voice/asr/session",
      { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
      "获取语音识别会话失败。",
    )
    if (response.status === 503) throw new VoiceUnavailableError()
    const body = await response.json() as Partial<VoiceSignedSession>
    if (typeof body.url !== "string" || typeof body.voiceId !== "string" || typeof body.expiredAt !== "number") {
      throw new VoiceUnavailableError()
    }
    return { url: body.url, voiceId: body.voiceId, expiredAt: body.expiredAt }
  }

  return { getStatus, signSession }
}

export type VoiceService = ReturnType<typeof createVoiceService>
