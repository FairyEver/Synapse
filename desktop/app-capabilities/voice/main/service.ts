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
/**
 * 可用性缓存时长。
 *
 * 渲染进程每次挂载输入区都会问一次（切换对话就会重新挂载），而这个答案只随平台
 * 配置变化。没有缓存的话，切一次对话就是一次多余请求。
 */
const STATUS_CACHE_MS = 60_000

export function createVoiceService(deps: VoiceServiceDeps) {
  let cached: { readonly at: number; readonly status: VoiceStatus } | null = null

  async function getStatus(): Promise<VoiceStatus> {
    if (cached && Date.now() - cached.at < STATUS_CACHE_MS) return cached.status
    try {
      const response = await deps.fetchAuthenticated("/voice/asr", {}, "读取语音识别状态失败。")
      const body = await response.json() as { available?: unknown }
      const status: VoiceStatus = { available: body.available === true }
      cached = { at: Date.now(), status }
      return status
    } catch (error) {
      // 服务端不可达时按"不可用"处理：入口不出现，比出现一个点了必然失败的按钮好。
      // 不缓存失败：网络恢复后应该立刻能拿到真话，而不是再等一个 TTL。
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
