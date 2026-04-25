import { timingSafeEqual } from "node:crypto"
import type { NetworkServiceDescriptor } from "../runtime/network"

export type ManagementApiRequest = {
  method: string
  path: string
  headers?: Record<string, string | undefined>
  query?: Record<string, string | undefined>
  body?: unknown
}

export type ManagementApiResponse = {
  statusCode: number
  body: {
    ok: boolean
    data?: unknown
    error?: string
  }
}

export type ManagementProjectSummary = {
  name: string
  agentType: string
  platforms: string[]
  sessionsCount: number
  heartbeatEnabled?: boolean
}

export type ManagementApiOptions = {
  preferredPort?: number
  tokenValue?: string
  tokenSecretRef?: string
  startedAt?: Date
  version?: string
  projects?: () => ManagementProjectSummary[]
  restart?: (input: { sessionKey?: string; platform?: string }) => Promise<void> | void
  reload?: () => Promise<string[]> | string[]
}

function ok(statusCode: number, data: unknown): ManagementApiResponse {
  return { statusCode, body: { ok: true, data } }
}

function fail(statusCode: number, error: string): ManagementApiResponse {
  return { statusCode, body: { ok: false, error } }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === "string" ? value : undefined
}

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) {
    return false
  }
  return timingSafeEqual(left, right)
}

export class ManagementApiService {
  readonly preferredPort: number
  readonly tokenSecretRef: string | null
  private readonly tokenValue: string
  private readonly startedAt: Date
  private readonly version: string
  private readonly projects: () => ManagementProjectSummary[]
  private readonly restartHandler: (input: { sessionKey?: string; platform?: string }) => Promise<void> | void
  private readonly reloadHandler: () => Promise<string[]> | string[]
  private restartInProgress = false

  constructor(options: ManagementApiOptions = {}) {
    this.preferredPort = options.preferredPort ?? 9820
    this.tokenValue = options.tokenValue ?? ""
    this.tokenSecretRef = options.tokenSecretRef ?? null
    this.startedAt = options.startedAt ?? new Date()
    this.version = options.version ?? "unknown"
    this.projects = options.projects ?? (() => [])
    this.restartHandler = options.restart ?? (() => undefined)
    this.reloadHandler = options.reload ?? (() => [])
  }

  authenticate(request: Pick<ManagementApiRequest, "headers" | "query">): boolean {
    if (!this.tokenValue) {
      return true
    }

    const authorization = request.headers?.authorization ?? request.headers?.Authorization
    if (authorization?.startsWith("Bearer ")) {
      return constantTimeEquals(authorization.slice("Bearer ".length), this.tokenValue)
    }

    const queryToken = request.query?.token
    return queryToken ? constantTimeEquals(queryToken, this.tokenValue) : false
  }

  async handle(request: ManagementApiRequest): Promise<ManagementApiResponse> {
    if (!this.authenticate(request)) {
      return fail(401, "unauthorized: missing or invalid token")
    }

    if (request.path === "/api/v1/status") {
      if (request.method !== "GET") return fail(405, "GET only")
      return this.handleStatus()
    }
    if (request.path === "/api/v1/restart") {
      if (request.method !== "POST") return fail(405, "POST only")
      return this.handleRestart(request.body)
    }
    if (request.path === "/api/v1/reload") {
      if (request.method !== "POST") return fail(405, "POST only")
      return this.handleReload()
    }
    if (request.path === "/api/v1/projects") {
      if (request.method !== "GET") return fail(405, "GET only")
      return ok(200, { projects: this.projects().map(normalizeProject) })
    }

    return fail(404, "not found")
  }

  createNetworkDescriptor(): NetworkServiceDescriptor {
    return {
      id: "management-api",
      role: "http",
      preferredPort: this.preferredPort,
      bindAddress: "127.0.0.1",
      auth: this.tokenSecretRef
        ? { kind: "bearer", tokenSecretRef: this.tokenSecretRef }
        : { kind: "none" },
      handler: {
        handle: (request) => this.handle(request as ManagementApiRequest),
      },
    }
  }

  private handleStatus(): ManagementApiResponse {
    const projects = this.projects()
    const platforms = new Set<string>()
    for (const project of projects) {
      for (const platform of project.platforms) {
        platforms.add(platform)
      }
    }

    return ok(200, {
      version: this.version,
      uptime_seconds: Math.max(0, Math.floor((Date.now() - this.startedAt.getTime()) / 1000)),
      connected_platforms: [...platforms],
      projects_count: projects.length,
      token_set: this.tokenValue !== "" || this.tokenSecretRef !== null,
    })
  }

  private async handleRestart(body: unknown): Promise<ManagementApiResponse> {
    if (this.restartInProgress) {
      return fail(409, "restart already in progress")
    }

    const input = isRecord(body)
      ? { sessionKey: readString(body, "session_key"), platform: readString(body, "platform") }
      : {}

    this.restartInProgress = true
    try {
      await this.restartHandler(input)
      return ok(200, { message: "restart initiated" })
    } catch (error) {
      return fail(500, error instanceof Error ? error.message : String(error))
    } finally {
      this.restartInProgress = false
    }
  }

  private async handleReload(): Promise<ManagementApiResponse> {
    try {
      const projectsUpdated = await this.reloadHandler()
      return ok(200, {
        message: "config reloaded",
        projects_updated: projectsUpdated,
      })
    } catch (error) {
      return fail(500, error instanceof Error ? error.message : String(error))
    }
  }
}

function normalizeProject(project: ManagementProjectSummary): Record<string, unknown> {
  return {
    name: project.name,
    agent_type: project.agentType,
    platforms: [...project.platforms],
    sessions_count: project.sessionsCount,
    heartbeat_enabled: project.heartbeatEnabled ?? false,
  }
}
