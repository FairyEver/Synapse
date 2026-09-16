import { createHmac, randomInt, randomUUID } from "node:crypto"

/**
 * 腾讯云实时语音识别的 URL 预签名。
 *
 * 这个接口的鉴权是 URL 上的 `signature` 参数，不是云 API 的 TC3 签名，而且签名
 * 原文只覆盖握手参数、不含音频数据（见官方《实时语音识别（WebSocket）》文档）。
 * 因此签名可以脱离音频流预先算好：主进程拿到 SecretKey 签出完整 URL，客户端拿
 * 这个 URL 直连，渲染进程和 iOS 从头到尾不接触密钥。
 */

export const ASR_WEBSOCKET_HOST = "asr.cloud.tencent.com"

/** 签名有效期。够一次录音握手即可，过期后客户端重新请求一次签名。 */
export const ASR_SIGNATURE_TTL_SECONDS = 300

/** 16k / 16bit / 单声道，每 200ms 一包。低于或高于这个值都会被引擎判为超速。 */
export const ASR_PCM_SAMPLE_RATE = 16_000
export const ASR_CHUNK_INTERVAL_MS = 200
export const ASR_CHUNK_BYTES = (ASR_PCM_SAMPLE_RATE * 2 * ASR_CHUNK_INTERVAL_MS) / 1000

/**
 * 单个热词最长 30 字符，最多 128 个；权重 1-11，11 是超级热词。
 * 全量超限会被引擎整条拒绝，所以这里按官方上限截断而不是报错。
 */
export const ASR_HOTWORD_LIMIT = 128
const ASR_HOTWORD_MAX_CHARS = 30

export type AsrSessionSignRequest = {
  readonly engineModelType: string
  readonly voiceId: string
  /** 1 = pcm，当前只支持这一种。 */
  readonly voiceFormat?: number
  readonly hotwordList?: string
  readonly needVad?: number
  readonly domain?: number
}

export type AsrCredentials = {
  readonly appId: string
  readonly secretId: string
  readonly secretKey: string
}

export type AsrSignedSession = {
  readonly url: string
  readonly voiceId: string
  readonly expiredAt: number
}

/**
 * RFC 3986 百分号编码。
 *
 * `encodeURIComponent` 不转义 `!'()*`，这里补齐；关键的是它**会**转义 `+` 和 `=`，
 * 而签名用 base64，结尾必然带 `=`、内部经常带 `+`。漏掉这一步表现为偶发鉴权失败，
 * 很难复现，所以第三步在这里是显式的一步而不是顺手拼接。
 */
export function percentEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  )
}

/**
 * 签名原文：除 signature 外的全部参数按字典序排序后拼成不带协议的 URL。
 * 排序是字节序（`<`），不是 `localeCompare` —— 后者受 locale 影响，会让某些
 * 参数顺序与文档样例不一致。
 */
export function buildSignatureSource(
  appId: string,
  params: Readonly<Record<string, string>>,
): string {
  const query = Object.keys(params)
    .filter((key) => key !== "signature")
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((key) => `${key}=${params[key]}`)
    .join("&")
  return `${ASR_WEBSOCKET_HOST}/asr/v2/${appId}?${query}`
}

export function signAsrSession(
  credentials: AsrCredentials,
  request: AsrSessionSignRequest,
  options: { readonly nowMs?: number; readonly nonce?: number } = {},
): AsrSignedSession {
  const nowSeconds = Math.floor((options.nowMs ?? Date.now()) / 1000)
  const expiredAt = nowSeconds + ASR_SIGNATURE_TTL_SECONDS
  const params: Record<string, string> = {
    secretid: credentials.secretId,
    timestamp: String(nowSeconds),
    expired: String(expiredAt),
    nonce: String(options.nonce ?? randomInt(1, 1_000_000_000)),
    engine_model_type: request.engineModelType,
    voice_id: request.voiceId,
    voice_format: String(request.voiceFormat ?? 1),
    needvad: String(request.needVad ?? 1),
  }
  if (request.domain !== undefined) params.domain = String(request.domain)
  const hotwordList = normalizeHotwordList(request.hotwordList)
  if (hotwordList) params.hotword_list = hotwordList

  const signature = createHmac("sha1", credentials.secretKey)
    .update(buildSignatureSource(credentials.appId, params))
    .digest("base64")

  const query = Object.keys(params)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((key) => `${key}=${params[key]}`)
    .join("&")

  return {
    url: `wss://${ASR_WEBSOCKET_HOST}/asr/v2/${credentials.appId}?${query}&signature=${percentEncode(signature)}`,
    voiceId: request.voiceId,
    expiredAt,
  }
}

/**
 * 把热词表规整到引擎能接受的形状：丢掉空项和超长项，超出数量上限就截断。
 * 传入一条非法项会让整个握手被判参数错误，代价远大于丢掉一个词。
 */
export function normalizeHotwordList(raw: string | undefined): string {
  if (!raw) return ""
  const words = raw
    .split(",")
    .map((word) => word.trim())
    .filter((word) => {
      if (!word) return false
      const head = word.split("|")[0] ?? ""
      return head.length > 0 && head.length <= ASR_HOTWORD_MAX_CHARS
    })
  return words.slice(0, ASR_HOTWORD_LIMIT).join(",")
}

/** 每次连接都必须换新的 voice_id，中断后旧的一律作废。 */
export function newAsrVoiceId(): string {
  return randomUUID()
}
