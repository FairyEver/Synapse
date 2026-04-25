import { createHash, timingSafeEqual } from "node:crypto"
import type { NetworkServiceDescriptor } from "../runtime/network"

export type WebhookAuthInput = {
  authorization?: string
  webhookToken?: string
  queryToken?: string
}

export type WebhookRequestInput = {
  event?: string
  project?: string
  sessionKey?: string
  prompt?: string
  exec?: string
  workDir?: string
  silent?: boolean
  payload?: unknown
}

export type WebhookDeliveryAction = "prompt" | "exec"

export type WebhookDelivery = {
  id: string
  event: string
  project: string | null
  sessionKey: string
  action: WebhookDeliveryAction
  acceptedAt: string
  silent: boolean
  payloadDigest?: string
  requiresPermission: boolean
}

export type WebhookAcceptedResult = {
  ok: true
  statusCode: 202
  body: {
    status: "accepted"
    event: string
    deliveryId: string
  }
  delivery: WebhookDelivery
}

export type WebhookRejectedResult = {
  ok: false
  statusCode: 400 | 401 | 405
  error: string
}

export type WebhookHandleInput = {
  method: string
  auth?: WebhookAuthInput
  body?: unknown
}

export type WebhookHandleResult = WebhookAcceptedResult | WebhookRejectedResult

export type WebhookServiceOptions = {
  port?: number
  path?: string
  tokenSecretRef?: string
  tokenValue?: string
  bindAddress?: string
  now?: () => Date
}

function normalizePath(path: string | undefined): string {
  const trimmed = path?.trim()
  if (!trimmed) {
    return "/hook"
  }

  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`
}

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)

  if (left.length !== right.length) {
    return false
  }

  return timingSafeEqual(left, right)
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  if (typeof value !== "string") {
    return undefined
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function readBoolean(record: Record<string, unknown>, key: string): boolean {
  return record[key] === true
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function payloadDigest(payload: unknown): string | undefined {
  if (payload === undefined || payload === null) {
    return undefined
  }

  return createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex")
}

export class WebhookService {
  readonly port: number
  readonly path: string
  readonly tokenSecretRef: string | null
  readonly bindAddress: string
  private readonly tokenValue: string
  private readonly now: () => Date
  private sequence = 0
  private readonly deliveries: WebhookDelivery[] = []

  constructor(options: WebhookServiceOptions = {}) {
    this.port = options.port && options.port > 0 ? options.port : 9111
    this.path = normalizePath(options.path)
    this.tokenSecretRef = options.tokenSecretRef ?? null
    this.bindAddress = options.bindAddress ?? "127.0.0.1"
    this.tokenValue = options.tokenValue ?? ""
    this.now = options.now ?? (() => new Date())
  }

  authenticate(input: WebhookAuthInput = {}): boolean {
    if (!this.tokenValue) {
      return true
    }

    const authorization = input.authorization?.trim()
    if (authorization?.startsWith("Bearer ")) {
      return constantTimeEquals(authorization.slice("Bearer ".length), this.tokenValue)
    }

    if (input.webhookToken) {
      return constantTimeEquals(input.webhookToken, this.tokenValue)
    }

    if (input.queryToken) {
      return constantTimeEquals(input.queryToken, this.tokenValue)
    }

    return false
  }

  handle(input: WebhookHandleInput): WebhookHandleResult {
    if (input.method.toUpperCase() !== "POST") {
      return { ok: false, statusCode: 405, error: "POST only" }
    }

    if (!this.authenticate(input.auth)) {
      return { ok: false, statusCode: 401, error: "unauthorized" }
    }

    if (!isRecord(input.body)) {
      return { ok: false, statusCode: 400, error: "invalid JSON: object expected" }
    }

    const parsed = this.parseRequest(input.body)
    if (!parsed.ok) {
      return parsed
    }

    const acceptedAt = this.now().toISOString()
    const digest = payloadDigest(parsed.request.payload)
    const delivery: WebhookDelivery = {
      id: `webhook-${++this.sequence}`,
      event: parsed.request.event || "webhook",
      project: parsed.request.project ?? null,
      sessionKey: parsed.request.sessionKey,
      action: parsed.request.exec ? "exec" : "prompt",
      acceptedAt,
      silent: parsed.request.silent ?? false,
      ...(digest ? { payloadDigest: digest } : undefined),
      requiresPermission: Boolean(parsed.request.exec),
    }

    this.deliveries.push(delivery)

    return {
      ok: true,
      statusCode: 202,
      body: {
        status: "accepted",
        event: delivery.event,
        deliveryId: delivery.id,
      },
      delivery,
    }
  }

  listDeliveries(): WebhookDelivery[] {
    return this.deliveries.map((delivery) => ({ ...delivery }))
  }

  createNetworkDescriptor(): NetworkServiceDescriptor {
    return {
      id: "connectors.webhook",
      role: "http",
      preferredPort: this.port,
      bindAddress: this.bindAddress,
      auth: this.tokenSecretRef
        ? { kind: "bearer", tokenSecretRef: this.tokenSecretRef }
        : { kind: "none" },
      handler: {
        handle: (request) => this.handle(request as WebhookHandleInput),
      },
    }
  }

  private parseRequest(body: Record<string, unknown>):
    | { ok: true; request: Required<Pick<WebhookRequestInput, "sessionKey">> & WebhookRequestInput }
    | WebhookRejectedResult {
    const sessionKey = readString(body, "session_key") ?? readString(body, "sessionKey")
    const prompt = readString(body, "prompt")
    const exec = readString(body, "exec")

    if (!sessionKey) {
      return { ok: false, statusCode: 400, error: "session_key is required" }
    }

    if (!prompt && !exec) {
      return { ok: false, statusCode: 400, error: "either prompt or exec is required" }
    }

    if (prompt && exec) {
      return { ok: false, statusCode: 400, error: "prompt and exec are mutually exclusive" }
    }

    return {
      ok: true,
      request: {
        sessionKey,
        ...(readString(body, "event") ? { event: readString(body, "event") } : undefined),
        ...(readString(body, "project") ? { project: readString(body, "project") } : undefined),
        ...(prompt ? { prompt } : undefined),
        ...(exec ? { exec } : undefined),
        ...(readString(body, "work_dir") ? { workDir: readString(body, "work_dir") } : undefined),
        silent: readBoolean(body, "silent"),
        ...(body.payload !== undefined ? { payload: body.payload } : undefined),
      },
    }
  }
}
