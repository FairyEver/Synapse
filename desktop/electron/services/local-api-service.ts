import { createHash } from "node:crypto"
import type { NetworkServiceDescriptor } from "../runtime/network"
import { normalizeCronSessionMode, type AutomationCronScheduler } from "./automation-cron-service"
import type { RelayService } from "./relay-service"

export type LocalApiAttachment = {
  mimeType: string
  data: Uint8Array | string
  fileName: string
}

export type LocalApiSendRequest = {
  project?: string
  sessionKey?: string
  message?: string
  images?: LocalApiAttachment[]
  files?: LocalApiAttachment[]
}

export type LocalApiSessionInfo = {
  project: string
  sessionKey: string
  platform: string
}

export type LocalApiHandleRequest = {
  method: string
  path: string
  query?: Record<string, string | undefined>
  body?: unknown
}

export type LocalApiResponse = {
  statusCode: number
  body: unknown
  contentType: "application/json" | "text/plain"
}

export type LocalApiSendHandler = (request: Required<Pick<LocalApiSendRequest, "message" | "images" | "files">> & {
  project: string | null
  sessionKey: string
}) => Promise<void> | void

export type LocalApiServiceOptions = {
  preferredPort?: number
  tokenSecretRef?: string
  sendHandler?: LocalApiSendHandler
  sessions?: () => LocalApiSessionInfo[]
  cron?: AutomationCronScheduler
  relay?: RelayService
}

function json(statusCode: number, body: unknown): LocalApiResponse {
  return { statusCode, body, contentType: "application/json" }
}

function text(statusCode: number, message: string): LocalApiResponse {
  return { statusCode, body: message, contentType: "text/plain" }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  return typeof value === "string" ? value : ""
}

function readAttachments(record: Record<string, unknown>, key: string): LocalApiAttachment[] {
  const value = record[key]
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter(isRecord).map((item) => ({
    mimeType: readString(item, "mime_type") || readString(item, "mimeType"),
    data: typeof item.data === "string" || item.data instanceof Uint8Array ? item.data : "",
    fileName: readString(item, "file_name") || readString(item, "fileName"),
  }))
}

function digestBody(body: unknown): string | undefined {
  if (body === undefined) {
    return undefined
  }
  return createHash("sha256").update(JSON.stringify(body)).digest("hex")
}

export class LocalApiService {
  readonly preferredPort: number
  readonly tokenSecretRef: string | null
  private readonly sendHandler: LocalApiSendHandler
  private readonly sessions: () => LocalApiSessionInfo[]
  private readonly cron?: AutomationCronScheduler
  private readonly relay?: RelayService

  constructor(options: LocalApiServiceOptions = {}) {
    this.preferredPort = options.preferredPort ?? 9818
    this.tokenSecretRef = options.tokenSecretRef ?? null
    this.sendHandler = options.sendHandler ?? (() => undefined)
    this.sessions = options.sessions ?? (() => [])
    this.cron = options.cron
    this.relay = options.relay
  }

  async handle(request: LocalApiHandleRequest): Promise<LocalApiResponse> {
    const { method, path } = request
    if (path === "/send") {
      return this.handleSend(method, request.body)
    }
    if (path === "/sessions") {
      return json(200, this.sessions())
    }
    if (path === "/cron/list") {
      if (!this.cron) return text(503, "cron scheduler not available")
      const project = request.query?.project
      const jobs = project
        ? this.cron.getStore().listByProject(project)
        : this.cron.getStore().list()
      return json(200, jobs)
    }
    if (path === "/cron/info") {
      if (!this.cron) return text(503, "cron scheduler not available")
      const id = request.query?.id
      if (!id) return text(400, "id is required")
      const job = this.cron.getStore().get(id)
      return job ? json(200, job) : text(404, `job ${JSON.stringify(id)} not found`)
    }
    if (path === "/cron/add") {
      return this.handleCronAdd(method, request.body)
    }
    if (path === "/cron/edit") {
      return this.handleCronEdit(method, request.body)
    }
    if (path === "/cron/del") {
      return this.handleCronDelete(method, request.body)
    }
    if (path === "/relay/send") {
      return this.handleRelaySend(method, request.body)
    }
    if (path === "/relay/bind") {
      return this.handleRelayBind(method, request.body)
    }
    if (path === "/relay/binding") {
      if (!this.relay) return text(503, "relay not available")
      const chatId = request.query?.chat_id
      if (!chatId) return text(400, "chat_id is required")
      return json(200, { chatId })
    }

    return text(404, "not found")
  }

  createNetworkDescriptor(): NetworkServiceDescriptor {
    return {
      id: "local-api",
      role: "http",
      preferredPort: this.preferredPort,
      bindAddress: "127.0.0.1",
      auth: this.tokenSecretRef
        ? { kind: "local-token", tokenSecretRef: this.tokenSecretRef }
        : { kind: "none" },
      handler: {
        handle: (request) => this.handle(request as LocalApiHandleRequest),
      },
    }
  }

  private async handleSend(method: string, body: unknown): Promise<LocalApiResponse> {
    if (method !== "POST") {
      return text(405, "POST only")
    }
    if (!isRecord(body)) {
      return text(400, "invalid JSON: object expected")
    }

    const images = readAttachments(body, "images")
    const files = readAttachments(body, "files")
    const message = readString(body, "message")
    if (!message && images.length === 0 && files.length === 0) {
      return text(400, "message or attachment is required")
    }

    const project = readString(body, "project") || null
    const sessionKey = readString(body, "session_key") || readString(body, "sessionKey")
    try {
      await this.sendHandler({ project, sessionKey, message, images, files })
      return json(200, { status: "ok", requestDigest: digestBody(body) })
    } catch (error) {
      return text(500, error instanceof Error ? error.message : String(error))
    }
  }

  private handleCronAdd(method: string, body: unknown): LocalApiResponse {
    if (method !== "POST") return text(405, "POST only")
    if (!this.cron) return text(503, "cron scheduler not available")
    if (!isRecord(body)) return text(400, "invalid JSON: object expected")

    const cronExpr = readString(body, "cron_expr") || readString(body, "cronExpr")
    const prompt = readString(body, "prompt")
    const exec = readString(body, "exec")
    if (!cronExpr) return text(400, "cron_expr is required")
    if (!prompt && !exec) return text(400, "either prompt or exec is required")
    if (prompt && exec) return text(400, "prompt and exec are mutually exclusive")

    try {
      const job = this.cron.addJob({
        id: readString(body, "id") || `local-${Date.now()}`,
        project: readString(body, "project"),
        sessionKey: readString(body, "session_key") || readString(body, "sessionKey"),
        cronExpr,
        prompt,
        exec,
        workDir: readString(body, "work_dir") || readString(body, "workDir"),
        description: readString(body, "description"),
        enabled: true,
        sessionMode: normalizeCronSessionMode(readString(body, "session_mode") || readString(body, "sessionMode")),
        mode: readString(body, "mode") as never,
        timeoutMins: typeof body.timeout_mins === "number" ? body.timeout_mins : null,
      })
      return json(200, job)
    } catch (error) {
      return text(400, error instanceof Error ? error.message : String(error))
    }
  }

  private handleCronEdit(method: string, body: unknown): LocalApiResponse {
    if (method !== "POST") return text(405, "POST only")
    if (!this.cron) return text(503, "cron scheduler not available")
    if (!isRecord(body)) return text(400, "invalid JSON: object expected")
    const id = readString(body, "id")
    const field = readString(body, "field")
    if (!id) return text(400, "id is required")
    if (!field) return text(400, "field is required")
    if (body.value === undefined || body.value === null) return text(400, "value is required")
    try {
      return json(200, this.cron.updateJob(id, field, body.value))
    } catch (error) {
      return text(400, error instanceof Error ? error.message : String(error))
    }
  }

  private handleCronDelete(method: string, body: unknown): LocalApiResponse {
    if (method !== "POST") return text(405, "POST only")
    if (!this.cron) return text(503, "cron scheduler not available")
    if (!isRecord(body)) return text(400, "invalid JSON: object expected")
    const id = readString(body, "id")
    if (!id) return text(400, "id is required")
    return this.cron.removeJob(id) ? json(200, { status: "ok" }) : text(404, `job ${JSON.stringify(id)} not found`)
  }

  private handleRelaySend(method: string, body: unknown): LocalApiResponse {
    if (method !== "POST") return text(405, "POST only")
    if (!this.relay) return text(503, "relay not available")
    if (!isRecord(body)) return text(400, "invalid JSON: object expected")
    const to = readString(body, "to")
    const message = readString(body, "message")
    const sessionKey = readString(body, "session_key") || readString(body, "sessionKey")
    if (!to || !message || !sessionKey) {
      return text(400, "to, session_key, and message are required")
    }
    try {
      return json(200, this.relay.send({
        from: readString(body, "from"),
        to,
        sessionKey,
        message,
      }))
    } catch (error) {
      return text(500, error instanceof Error ? error.message : String(error))
    }
  }

  private handleRelayBind(method: string, body: unknown): LocalApiResponse {
    if (method !== "POST") return text(405, "POST only")
    if (!this.relay) return text(503, "relay not available")
    if (!isRecord(body)) return text(400, "invalid JSON: object expected")
    const bots = isRecord(body.bots) ? Object.fromEntries(
      Object.entries(body.bots).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    ) : {}
    const chatId = readString(body, "chat_id") || readString(body, "chatId")
    if (!chatId || Object.keys(bots).length < 2) {
      return text(400, "chat_id and at least 2 bots are required")
    }
    this.relay.bind(readString(body, "platform"), chatId, bots)
    return json(200, { status: "ok" })
  }
}
