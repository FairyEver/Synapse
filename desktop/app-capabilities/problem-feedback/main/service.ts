import { request as requestHttp } from "node:http"
import { request as requestHttps } from "node:https"
import type {
  ProblemFeedbackInputField,
  ProblemFeedbackInputReason,
  ProblemFeedbackPrivacyCategory,
} from "@synapse/shared" with { "resolution-mode": "import" }

export const PROBLEM_FEEDBACK_TOTAL_TIMEOUT_MS = 30_000
export const PROBLEM_FEEDBACK_MAX_RESPONSE_BYTES = 16 * 1024

const sharedProblemFeedbackPromise = import("@synapse/shared")

export type ProblemFeedbackSubmissionFailureCode =
  | "INVALID_INPUT"
  | "PRIVACY_RISK"
  | "RATE_LIMITED"
  | "SUBMISSION_FAILED"
  | "SUBMISSION_OUTCOME_UNKNOWN"

export type ProblemFeedbackSubmissionResult =
  | { readonly ok: true; readonly data: { readonly success: true } }
  | {
    readonly ok: false
    readonly code: ProblemFeedbackSubmissionFailureCode
    readonly data?: {
      readonly field: ProblemFeedbackInputField
      readonly reason: ProblemFeedbackInputReason
    } | {
      readonly category: ProblemFeedbackPrivacyCategory
    }
  }

type ProblemFeedbackHttpResponse = {
  readonly status: number
  readonly contentType: string | null
  readonly cacheControl: string | null
  readonly body: Uint8Array
}

type RequestPort = (
  endpoint: URL,
  body: string,
  signal: AbortSignal,
) => Promise<ProblemFeedbackHttpResponse>

export class ProblemFeedbackService {
  private readonly endpoint: URL | null

  constructor(
    apiBaseUrl: string,
    private readonly options: {
      readonly allowDevelopmentLoopbackHttp: boolean
      readonly request?: RequestPort
      readonly timeoutMs?: number
    },
  ) {
    this.endpoint = resolveProblemFeedbackEndpoint(
      apiBaseUrl,
      options.allowDevelopmentLoopbackHttp,
    )
  }

  async submit(
    content: string,
    abortSignal?: AbortSignal,
  ): Promise<ProblemFeedbackSubmissionResult> {
    if (!this.endpoint || abortSignal?.aborted) {
      return submissionFailure("SUBMISSION_FAILED")
    }

    const controller = new AbortController()
    const timeout = setTimeout(
      () => controller.abort("problem-feedback-timeout"),
      this.options.timeoutMs ?? PROBLEM_FEEDBACK_TOTAL_TIMEOUT_MS,
    )
    const abort = () => controller.abort("problem-feedback-cancelled")
    abortSignal?.addEventListener("abort", abort, { once: true })

    let requestStarted = false
    try {
      if (abortSignal?.aborted) return submissionFailure("SUBMISSION_FAILED")
      requestStarted = true
      const response = await (this.options.request ?? requestProblemFeedback)(
        this.endpoint,
        JSON.stringify({ content }),
        controller.signal,
      )
      return parseProblemFeedbackResponse(response)
    } catch (error) {
      if (!requestStarted || provesRequestBodyWasNotSent(error)) {
        return submissionFailure("SUBMISSION_FAILED")
      }
      return submissionFailure("SUBMISSION_OUTCOME_UNKNOWN")
    } finally {
      clearTimeout(timeout)
      abortSignal?.removeEventListener("abort", abort)
      content = ""
    }
  }
}

export function resolveProblemFeedbackEndpoint(
  apiBaseUrl: string,
  allowDevelopmentLoopbackHttp: boolean,
): URL | null {
  let endpoint: URL
  try {
    const base = new URL(apiBaseUrl.endsWith("/") ? apiBaseUrl : `${apiBaseUrl}/`)
    if (base.username || base.password) return null
    endpoint = new URL("problem-feedback", base)
  } catch {
    return null
  }

  if (endpoint.protocol === "https:") return endpoint
  if (
    allowDevelopmentLoopbackHttp
    && endpoint.protocol === "http:"
    && isLoopbackHostname(endpoint.hostname)
  ) {
    return endpoint
  }
  return null
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/gu, "")
  return normalized === "localhost"
    || normalized === "127.0.0.1"
    || normalized === "::1"
}

async function parseProblemFeedbackResponse(
  response: ProblemFeedbackHttpResponse,
): Promise<ProblemFeedbackSubmissionResult> {
  const {
    isProblemFeedbackInputField,
    isProblemFeedbackInputReason,
    isProblemFeedbackPrivacyCategory,
  } = await sharedProblemFeedbackPromise
  if (
    !response.contentType
    || !/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(response.contentType)
    || !response.cacheControl?.split(",").some(
      (directive) => directive.trim().toLowerCase() === "no-store",
    )
    || response.body.byteLength > PROBLEM_FEEDBACK_MAX_RESPONSE_BYTES
  ) {
    return submissionFailure("SUBMISSION_OUTCOME_UNKNOWN")
  }

  let value: unknown
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(response.body)
    value = JSON.parse(text)
  } catch {
    return submissionFailure("SUBMISSION_OUTCOME_UNKNOWN")
  }

  if (response.status === 200 && isExactObject(value, ["success"]) && value.success === true) {
    return { ok: true, data: { success: true } }
  }
  if (response.status === 429 && isExactCode(value, "RATE_LIMITED")) {
    return submissionFailure("RATE_LIMITED")
  }
  if (response.status === 503 && isExactCode(value, "SUBMISSION_FAILED")) {
    return submissionFailure("SUBMISSION_FAILED")
  }
  if (response.status === 400 && isExactObject(value, ["code", "data"])) {
    const data = value.data
    if (
      value.code === "INVALID_INPUT"
      && isExactObject(data, ["field", "reason"])
      && isProblemFeedbackInputField(data.field)
      && isProblemFeedbackInputReason(data.reason)
    ) {
      return { ok: false, code: "INVALID_INPUT", data: {
        field: data.field,
        reason: data.reason,
      } }
    }
  }
  if (response.status === 422 && isExactObject(value, ["code", "data"])) {
    const data = value.data
    if (
      value.code === "PRIVACY_RISK"
      && isExactObject(data, ["category"])
      && isProblemFeedbackPrivacyCategory(data.category)
    ) {
      return { ok: false, code: "PRIVACY_RISK", data: {
        category: data.category,
      } }
    }
  }
  return submissionFailure("SUBMISSION_OUTCOME_UNKNOWN")
}

function requestProblemFeedback(
  endpoint: URL,
  body: string,
  signal: AbortSignal,
): Promise<ProblemFeedbackHttpResponse> {
  return new Promise((resolve, reject) => {
    const bodyBytes = Buffer.from(body, "utf8")
    let transportReady = false
    let settled = false
    const settle = (
      operation: () => void,
    ) => {
      if (settled) return
      settled = true
      operation()
    }
    const request = (endpoint.protocol === "https:" ? requestHttps : requestHttp)(
      endpoint,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json; charset=utf-8",
          "Content-Length": bodyBytes.byteLength,
        },
        signal,
      },
      (response) => {
        transportReady = true
        const chunks: Buffer[] = []
        let receivedBytes = 0
        response.on("data", (chunk: Buffer | string) => {
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
          receivedBytes += bytes.byteLength
          if (receivedBytes > PROBLEM_FEEDBACK_MAX_RESPONSE_BYTES) {
            response.destroy()
            settle(() => reject(new Error("problem feedback response too large")))
            return
          }
          chunks.push(bytes)
        })
        response.once("aborted", () => {
          settle(() => reject(new Error("problem feedback response aborted")))
        })
        response.once("error", (error) => {
          settle(() => reject(error))
        })
        response.once("end", () => {
          settle(() => resolve({
            status: response.statusCode ?? 0,
            contentType: readResponseHeader(response.headers["content-type"]),
            cacheControl: readResponseHeader(response.headers["cache-control"]),
            body: Buffer.concat(chunks, receivedBytes),
          }))
        })
      },
    )

    request.once("socket", (socket) => {
      if (endpoint.protocol === "https:") {
        socket.once("secureConnect", () => {
          transportReady = true
        })
      } else {
        socket.once("connect", () => {
          transportReady = true
        })
      }
    })
    request.once("error", (error) => {
      if (!transportReady) {
        Object.defineProperty(error, "problemFeedbackBodyDefinitelyNotSent", {
          value: true,
        })
      }
      settle(() => reject(error))
    })
    request.end(bodyBytes)
  })
}

function readResponseHeader(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value.length === 1 ? value[0] ?? null : null
  return value ?? null
}

function isExactCode(
  value: unknown,
  code: "RATE_LIMITED" | "SUBMISSION_FAILED",
): boolean {
  return isExactObject(value, ["code"]) && value.code === code
}

function isExactObject(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index])
}

function submissionFailure(
  code: ProblemFeedbackSubmissionFailureCode,
): ProblemFeedbackSubmissionResult {
  return { ok: false, code }
}

function provesRequestBodyWasNotSent(error: unknown): boolean {
  if (
    error
    && typeof error === "object"
    && "problemFeedbackBodyDefinitelyNotSent" in error
    && error.problemFeedbackBodyDefinitelyNotSent === true
  ) {
    return true
  }
  const code = readCauseCode(error)
  return code === "ENOTFOUND"
    || code === "EAI_AGAIN"
    || code === "ECONNREFUSED"
    || code === "ENETUNREACH"
    || code === "EHOSTUNREACH"
    || code === "ERR_TLS_CERT_ALTNAME_INVALID"
    || code === "DEPTH_ZERO_SELF_SIGNED_CERT"
    || code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE"
    || code === "CERT_HAS_EXPIRED"
}

function readCauseCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined
  const direct = "code" in error ? error.code : undefined
  if (typeof direct === "string") return direct
  const cause = "cause" in error ? error.cause : undefined
  return cause && typeof cause === "object" && "code" in cause && typeof cause.code === "string"
    ? cause.code
    : undefined
}
