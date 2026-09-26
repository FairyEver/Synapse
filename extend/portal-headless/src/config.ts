import type { OssUploadConfig } from './capabilities/base-upload.js'

/**
 * SDK 初始化参数。
 *
 * 环境不作为 SDK 的概念存在：连哪个环境完全由 baseUrl 决定（设计 §1b 决策 D23）。
 * 正式启用时由接入方传入生产环境的 baseUrl。
 */
export type PortalCredential = {
  /** Portal 会话 token（设计 D1：浏览器回调取得的会话 token） */
  token: string
  /** 当前租户。必须显式传入：后端在部分路径会静默选错租户（设计 F26） */
  tenantId: number | string
}

/** 会话绑定后的凭据快照；只读，避免调用方原地轮换旧会话的身份。 */
export type PortalCredentialSnapshot = Readonly<PortalCredential>

export type PortalHeadlessConfig = {
  /** 例：https://biz-api-test.wodecorp.cn */
  baseUrl: string
  credential: PortalCredential
  /** 登录设备管理的当前PC标识，由调用方显式提供，不从浏览器提取。 */
  portalDevice?: import('./capabilities/portal-device.js').PortalDeviceOptions
  /**
   * 调用方的用户标识。**只用于写操作的幂等键**（隔离不同用户可能撞上的 requestId），
   * 不进任何请求头或请求体。多用户形态请用 `createPortalServer`，那边从会话取。
   */
  userId?: string
  /** Accept-Language，默认 zh-CN */
  language?: string
  /** 请求超时，默认 180s（与 Portal 前端 platform.js 一致） */
  timeoutMs?: number
  /**
   * 目标页面的 menu-type 解析不到时的行为。
   * 默认 'omit'：与浏览器保持一致（浏览器算不出时同样不发这个头，设计 D34 / F19）。
   */
  moduleTypeFallback?: 'omit' | number
  /**
   * 非默认 http 实例的 baseURL，键是实例 id（`src/context/http-instance.ts`）。
   *
   * **必须由调用方显式给**——SDK 不替「同 host 不同前缀 / 不同 host」的范围决策做主
   * （设计 D3：只做 Portal 主后端）。没配的实例，对应页面一律**拒绝发请求**，
   * 而不是拿默认 baseUrl 去凑：凑错的后果是打到错的 URL，不是少一个头。
   */
  httpBaseUrls?: Record<string, string>
  /**
   * OSS 上传配置（`baseUpload` 基础能力用）。**凭据**：AccessKeyId / AccessKeySecret。
   *
   * **必须由接入方通过这里传**——SDK 不读环境变量、不读文件、不从浏览器抓（conventions 第 8 条）。
   * 不传也能正常建 SDK：上传能力会照常存在，但真去调用时以 `OssCredentialError` 失败关闭
   * （**建的时候不校验**，否则没配 OSS 的调用方会连 SDK 都建不起来）。
   * 任何输出里的 secret 都会被 `redactOssConfig` 抹成 `<redacted>`。
   */
  oss?: OssUploadConfig
}

export const DEFAULT_LANGUAGE = 'zh-CN'
export const DEFAULT_TIMEOUT_MS = 180_000

export function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim()
  if (!trimmed) {
    throw new Error('baseUrl 不能为空')
  }
  return trimmed.replace(/\/+$/, '')
}
