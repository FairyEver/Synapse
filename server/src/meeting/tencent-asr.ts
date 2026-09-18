import { createHash, createHmac } from "node:crypto"

/**
 * 腾讯云录音文件识别的云 API 调用。
 *
 * 与现有的实时语音识别（`server/src/voice/asr-signature.ts`）是两套完全不同的签名：
 * 那边是握手 URL 上的 `signature` 参数，这边是云 API 的 TC3-HMAC-SHA256。两者不能
 * 互相顶替，所以这里是独立实现而不是复用。
 *
 * 密钥同样只留在服务端：桌面端提交任务、取结果都经服务端，全程不接触 SecretKey。
 * 这里用 `fetch` 手写签名，不引入腾讯云 SDK——只用到两个接口，加一个依赖不划算。
 */

export const TENCENT_ASR_API_HOST = "asr.tencentcloudapi.com"
const TENCENT_ASR_SERVICE = "asr"
const TENCENT_ASR_API_VERSION = "2019-06-14"

export type TencentAsrCredentials = {
  readonly secretId: string
  readonly secretKey: string
  /** 云 API 的区域。这个接口不区分区域，留一个默认值只为让签名原文完整。 */
  readonly region?: string
}

/**
 * 云 API 的错误体。
 *
 * 字段是**大写开头**的 `Code` / `Message`，不是小写的——这是实测出来的：按小写读会
 * 得到一个 `undefined: undefined` 的报错，把真正的失败原因整个吞掉。
 */
export type TencentAsrError = {
  readonly Code: string
  readonly Message: string
}

/** 云 API 的错误是 200 包着 `Response.Error`，必须显式认出来，否则会被当成成功。 */
export class TencentAsrApiError extends Error {
  readonly code: string

  constructor(error: TencentAsrError) {
    super(`${error.Code}: ${error.Message}`)
    this.name = "TencentAsrApiError"
    this.code = error.Code
  }
}

type TencentResponse<T> = {
  readonly Response: T & {
    readonly Error?: TencentAsrError
    readonly RequestId?: string
  }
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac("sha256", key).update(value, "utf8").digest()
}

/**
 * TC3-HMAC-SHA256。步骤顺序是文档定死的：先拼规范请求，再拼待签串，然后逐层派生
 * 签名密钥——最后一层的密钥只对这一天的这一个服务有效，缓存没有意义。
 */
export function buildTencentAuthorization(input: {
  readonly credentials: TencentAsrCredentials
  readonly action: string
  readonly payload: string
  readonly timestampSeconds: number
}): { readonly authorization: string; readonly signedHeaders: string } {
  const date = new Date(input.timestampSeconds * 1000)
  const dateStamp = date.toISOString().slice(0, 10)
  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${TENCENT_ASR_API_HOST}\nx-tc-action:${input.action.toLowerCase()}\n`
  const signedHeaders = "content-type;host;x-tc-action"
  const canonicalRequest = [
    "POST",
    "/",
    "",
    canonicalHeaders,
    signedHeaders,
    sha256Hex(input.payload),
  ].join("\n")

  const credentialScope = `${dateStamp}/${TENCENT_ASR_SERVICE}/tc3_request`
  const stringToSign = ["TC3-HMAC-SHA256", String(input.timestampSeconds), credentialScope, sha256Hex(canonicalRequest)].join(
    "\n",
  )

  const secretDate = hmac(`TC3${input.credentials.secretKey}`, dateStamp)
  const secretService = hmac(secretDate, TENCENT_ASR_SERVICE)
  const secretSigning = hmac(secretService, "tc3_request")
  const signature = createHmac("sha256", secretSigning).update(stringToSign, "utf8").digest("hex")

  return {
    authorization: `TC3-HMAC-SHA256 Credential=${input.credentials.secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    signedHeaders,
  }
}

export type TencentAsrRequestOptions = {
  readonly fetchImpl?: typeof fetch
  readonly nowMs?: number
  readonly timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 15_000

async function callApi<T>(
  action: string,
  payload: Record<string, unknown>,
  credentials: TencentAsrCredentials,
  options: TencentAsrRequestOptions = {},
): Promise<T> {
  const body = JSON.stringify(payload)
  const timestampSeconds = Math.floor((options.nowMs ?? Date.now()) / 1000)
  const { authorization } = buildTencentAuthorization({
    credentials,
    action,
    payload: body,
    timestampSeconds,
  })

  const fetchImpl = options.fetchImpl ?? fetch
  const abort = new AbortController()
  const timeout = setTimeout(() => abort.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  let response: Response
  try {
    response = await fetchImpl(`https://${TENCENT_ASR_API_HOST}`, {
      method: "POST",
      headers: {
        Authorization: authorization,
        "Content-Type": "application/json; charset=utf-8",
        Host: TENCENT_ASR_API_HOST,
        "X-TC-Action": action,
        "X-TC-Timestamp": String(timestampSeconds),
        "X-TC-Version": TENCENT_ASR_API_VERSION,
        ...(credentials.region ? { "X-TC-Region": credentials.region } : {}),
      },
      body,
      signal: abort.signal,
    })
  } finally {
    clearTimeout(timeout)
  }

  if (!response.ok) {
    throw new Error(`Tencent ASR ${action} failed with HTTP ${response.status}.`)
  }

  const parsed = (await response.json()) as TencentResponse<T>
  if (parsed.Response?.Error) throw new TencentAsrApiError(parsed.Response.Error)
  return parsed.Response
}

export type CreateRecTaskInput = {
  readonly engineModelType: string
  readonly channelNum: number
  readonly resTextFormat: number
  readonly sourceType: number
  readonly url: string
  readonly speakerDiarization: number
  readonly speakerNumber: number
  readonly filterDirty: number
  readonly filterModal: number
  readonly convertNumMode: number
  readonly hotwordList?: string
}

/**
 * 提交成功只回一个任务号，而且它**嵌在 `Data` 里面**。
 *
 * 实测返回：`{"RequestId":"…","Data":{"TaskId":16816512591}}`。
 * 按顶层的 `TaskId` 读会拿到 `undefined`，于是下一句「取结果」被腾讯云判成「缺少必填
 * 参数 TaskId」——报的是取结果的错，锅其实在提交那一步的读法。
 */
type CreateRecTaskResponse = {
  readonly Data: { readonly TaskId: number }
}

export async function createRecTask(
  input: CreateRecTaskInput,
  credentials: TencentAsrCredentials,
  options: TencentAsrRequestOptions = {},
): Promise<{ readonly taskId: number }> {
  const payload: Record<string, unknown> = {
    EngineModelType: input.engineModelType,
    ChannelNum: input.channelNum,
    ResTextFormat: input.resTextFormat,
    SourceType: input.sourceType,
    Url: input.url,
    SpeakerDiarization: input.speakerDiarization,
    SpeakerNumber: input.speakerNumber,
    FilterDirty: input.filterDirty,
    FilterModal: input.filterModal,
    ConvertNumMode: input.convertNumMode,
  }
  // 热词表为空时整个字段不发：发一个空串会被判参数错误，代价远大于少几个热词。
  if (input.hotwordList) payload.HotwordList = input.hotwordList
  // 云端的分层结构只在这里出现一次，调用方拿到的是拍平之后的任务号。
  const response = await callApi<CreateRecTaskResponse>("CreateRecTask", payload, credentials, options)
  return { taskId: response.Data.TaskId }
}

/** 同样嵌在 `Data` 里，理由与 `CreateRecTask` 一致。 */
type DescribeTaskStatusResponse = {
  readonly Data: {
    readonly TaskId: number
    readonly Status: number
    readonly StatusStr?: string
    /** 纯文本结果。`ResTextFormat=1` 时结构化结果在 `ResultDetail` 里，这里往往仍是整段文本。 */
    readonly Result?: string | null
    readonly ResultDetail?: readonly RawSentenceDetail[] | null
    readonly ErrorMsg?: string | null
    readonly AudioDuration?: number | null
  }
}

export type DescribeTaskStatusResult = {
  readonly taskId: number
  readonly status: number
  readonly statusText: string
  readonly result: string | null
  /** 结构化结果，`ResTextFormat=1` 时才有；说话人与词级时间戳都在这里。 */
  readonly detail: readonly RawSentenceDetail[] | null
  readonly errorMessage: string | null
  readonly audioDuration: number | null
}

/**
 * 原始句子结构。
 *
 * 字段名是腾讯云定死的：词级时间戳在 `ResultDetail[].Words[]`，且词的偏移是**相对
 * 本句**的（`OffsetStartMs`），不是绝对时间。单测造不出这个结构——它是从真实返回里
 * 抄下来的，改动前请先跑一次真实录音。
 */
export type RawSentenceDetail = {
  readonly FinalSentence?: string | null
  readonly StartMs?: number | null
  readonly EndMs?: number | null
  readonly SpeakerId?: number | null
  readonly Words?: readonly RawSentenceWord[] | null
}

export type RawSentenceWord = {
  readonly Word?: string | null
  readonly OffsetStartMs?: number | null
  readonly OffsetEndMs?: number | null
}

export async function describeTaskStatus(
  taskId: number,
  credentials: TencentAsrCredentials,
  options: TencentAsrRequestOptions = {},
): Promise<DescribeTaskStatusResult> {
  const response = await callApi<DescribeTaskStatusResponse>(
    "DescribeTaskStatus",
    { TaskId: taskId },
    credentials,
    options,
  )
  return {
    taskId: response.Data.TaskId,
    status: response.Data.Status,
    statusText: response.Data.StatusStr ?? "",
    result: response.Data.Result ?? null,
    detail: response.Data.ResultDetail ?? null,
    errorMessage: response.Data.ErrorMsg ?? null,
    audioDuration: response.Data.AudioDuration ?? null,
  }
}
