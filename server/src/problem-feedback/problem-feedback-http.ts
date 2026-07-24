import type { NextFunction, Request, Response } from "express"
import { getNodeValue, parseTree, type Node, type ParseError } from "jsonc-parser"
import { PROBLEM_FEEDBACK_HTTP_MAX_BYTES, PROBLEM_FEEDBACK_PUBLIC_PATH } from "./problem-feedback.constants"

type ParsedProblemFeedbackRequest = Request & {
  body?: unknown
}

export function isProblemFeedbackPublicRequest(request: {
  readonly method?: string
  readonly originalUrl?: string
  readonly url?: string
}): boolean {
  const url = request.originalUrl ?? request.url ?? ""
  return request.method === "POST" && isProblemFeedbackPublicPath(url)
}

export function isProblemFeedbackPublicPath(url: string): boolean {
  return url.split("?")[0] === PROBLEM_FEEDBACK_PUBLIC_PATH
}

export function problemFeedbackRawJsonParser(
  request: ParsedProblemFeedbackRequest,
  response: Response,
  next: NextFunction,
): void {
  if (!isProblemFeedbackPublicRequest(request)) {
    next()
    return
  }

  const contentType = request.headers["content-type"]
  const contentEncoding = request.headers["content-encoding"]
  if (
    typeof contentType !== "string"
    || !/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(contentType)
    || (contentEncoding !== undefined && contentEncoding !== "identity")
  ) {
    sendProblemFeedbackInvalidRequest(response, "type")
    return
  }

  const declaredLength = readDeclaredLength(request.headers["content-length"])
  if (declaredLength === null || declaredLength > PROBLEM_FEEDBACK_HTTP_MAX_BYTES) {
    sendProblemFeedbackInvalidRequest(
      response,
      declaredLength !== null && declaredLength > PROBLEM_FEEDBACK_HTTP_MAX_BYTES
        ? "too_large"
        : "type",
    )
    return
  }

  const chunks: Buffer[] = []
  let receivedBytes = 0
  let finished = false

  const cleanup = () => {
    request.off("data", handleData)
    request.off("end", handleEnd)
    request.off("error", handleError)
    request.off("aborted", handleAborted)
  }
  const reject = (reason: "type" | "too_large") => {
    if (finished) return
    finished = true
    cleanup()
    request.pause()
    response.setHeader("Connection", "close")
    sendProblemFeedbackInvalidRequest(response, reason)
  }
  const handleData = (chunk: Buffer | string) => {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    receivedBytes += bytes.byteLength
    if (receivedBytes > PROBLEM_FEEDBACK_HTTP_MAX_BYTES) {
      reject("too_large")
      return
    }
    chunks.push(bytes)
  }
  const handleEnd = () => {
    if (finished) return
    finished = true
    cleanup()
    const parsed = parseProblemFeedbackJson(Buffer.concat(chunks, receivedBytes))
    if (!parsed.ok) {
      sendProblemFeedbackInvalidRequest(response, "type")
      return
    }
    request.body = parsed.value
    next()
  }
  const handleError = () => reject("type")
  const handleAborted = () => {
    finished = true
    cleanup()
  }

  request.on("data", handleData)
  request.on("end", handleEnd)
  request.on("error", handleError)
  request.on("aborted", handleAborted)
}

export function parseProblemFeedbackJson(
  bytes: Uint8Array,
): { readonly ok: true; readonly value: unknown } | { readonly ok: false } {
  if (
    bytes.byteLength >= 3
    && bytes[0] === 0xef
    && bytes[1] === 0xbb
    && bytes[2] === 0xbf
  ) {
    return { ok: false }
  }

  let text: string
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    return { ok: false }
  }
  if (!text || text.charCodeAt(0) === 0xfeff) return { ok: false }

  const errors: ParseError[] = []
  const root = parseTree(text, errors, {
    allowEmptyContent: false,
    allowTrailingComma: false,
    disallowComments: true,
  })
  if (!root || errors.length > 0 || hasDuplicateObjectKey(root)) return { ok: false }
  if (text.slice(root.offset + root.length).trim().length > 0) return { ok: false }
  return { ok: true, value: getNodeValue(root) }
}

function hasDuplicateObjectKey(node: Node): boolean {
  if (node.type === "object") {
    const keys = new Set<string>()
    for (const property of node.children ?? []) {
      const key = property.children?.[0]?.value
      if (typeof key !== "string" || keys.has(key)) return true
      keys.add(key)
    }
  }
  return (node.children ?? []).some(hasDuplicateObjectKey)
}

function readDeclaredLength(value: string | undefined): number | null {
  if (value === undefined) return 0
  if (!/^\d+$/u.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function sendProblemFeedbackInvalidRequest(
  response: Response,
  reason: "type" | "too_large",
): void {
  response
    .status(400)
    .set({
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
    })
    .send(JSON.stringify({
      code: "INVALID_INPUT",
      data: { field: "request", reason },
    }))
}
