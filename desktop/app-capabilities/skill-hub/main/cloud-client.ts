import { sha256 } from "@synapse/shared/archive-package-node"
import {
  SKILL_HUB_LIMITS as limits, inspectHubIconInput, skillHubDeleteResultSchema, skillHubDetailSchema, skillHubIdSchema,
  skillHubMainResultSchema, skillHubPageSchema, skillHubReceiptSchema, skillHubTeamPageSchema,
  skillHubUploadResultSchema, skillHubWriteReplaySchema, skillHubWriteResultSchema,
  type SkillHubCreateInput, type SkillHubListInput, type SkillHubPublishInput, type SkillHubReceiptInput,
  type SkillHubRevisionInput, type SkillHubTeamQuery, type SkillHubUpdateInput, type SkillHubUploadInput,
} from "@synapse/shared/skill-hub-contracts"
import type { AccountRequestScope, AccountService } from "../../../electron/services/account-service"
import { hubAccountChanged, SkillHubDesktopError } from "./error"

type Scope = AccountRequestScope & { accountId: string }
export type HubAccountOperation = { scope: Scope; signal: AbortSignal }
type HubAccount = Pick<AccountService, "captureAccountRequestScope" | "onBeforeIdentityChange" | "fetchAuthenticated">

const remoteMessages: Record<string, string> = {
  HUB_NO_TEAM: "加入团队后才能上传 Skill。",
  HUB_TEAM_REQUIRED: "请选择目标团队。",
  HUB_TEAM_UNAVAILABLE: "当前账号已无法向该团队上传或维护 Skill。",
  HUB_NOT_AVAILABLE: "该 Skill 不存在或当前账号无权访问。",
  HUB_LATEST_CHANGED: "最新版已变化，请重新读取。",
  HUB_VERSION_CONFLICT: "Skill 版本已变化，请重新读取当前版本。",
  HUB_REVISION_CONFLICT: "Skill 资料已变化，请重新读取。",
  HUB_REQUEST_CONFLICT: "此请求标识已用于另一项操作。",
  HUB_UPLOAD_UNAVAILABLE: "上传已失效，请重新准备文件。",
  HUB_UPLOAD_EXPIRED: "上传已过期，请重新上传文件。",
  HUB_PACKAGE_INVALID: "服务端拒绝了此文件，请检查格式和包内容。",
  HUB_UPLOAD_TOO_LARGE: "Skill 文件超过上传大小限制。",
  HUB_UPLOAD_BUSY: "当前上传较多，请稍后重试。",
  HUB_STORAGE_UNAVAILABLE: "Skill 文件暂不可用，请稍后重试。",
  HUB_INVALID_CURSOR: "团队或查询范围已变化，请从第一页重新读取。",
}

const requestPath = (path: string) => `/skill-hub${path}`
function queryString(input: Record<string, unknown>) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(input)) if (value !== undefined) params.set(key, String(value))
  return params.size ? `?${params}` : ""
}

function id(value: string) {
  return encodeURIComponent(skillHubIdSchema.parse(value))
}

async function readBytes(response: Response, max: number, signal: AbortSignal): Promise<Buffer> {
  const length = response.headers.get("Content-Length")
  if (length && Number(length) > max) {
    await response.body?.cancel()
    throw new SkillHubDesktopError("HUB_RESPONSE_BUDGET", "Skill Hub 响应超过大小限制。")
  }
  if (!response.body) return Buffer.alloc(0)
  const reader = response.body.getReader()
  const abort = () => { void reader.cancel().catch(() => undefined) }
  signal.addEventListener("abort", abort, { once: true })
  const parts: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      signal.throwIfAborted()
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > max) throw new SkillHubDesktopError("HUB_RESPONSE_BUDGET", "Skill Hub 响应超过大小限制。")
      parts.push(value)
    }
    signal.throwIfAborted()
    return Buffer.concat(parts, size)
  } finally {
    signal.removeEventListener("abort", abort)
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

export class SkillHubCloudClient {
  private lifetime = new AbortController()
  private revokedScope: Scope | null = null
  private readonly unsubscribe: () => void

  constructor(private readonly account: HubAccount) {
    this.unsubscribe = account.onBeforeIdentityChange(() => {
      this.revokedScope = account.captureAccountRequestScope()
      this.lifetime.abort(hubAccountChanged())
      this.lifetime = new AbortController()
    })
  }

  capture(signal?: AbortSignal): HubAccountOperation {
    const scope = this.account.captureAccountRequestScope()
    if (!scope) throw new SkillHubDesktopError("HUB_ACCOUNT_REQUIRED", "请打开 Synapse，登录并确认账号在线。")
    if (this.same(scope, this.revokedScope)) throw hubAccountChanged()
    return { scope, signal: signal ? AbortSignal.any([signal, this.lifetime.signal]) : this.lifetime.signal }
  }

  assertActive(operation: HubAccountOperation) {
    if (!this.same(operation.scope, this.account.captureAccountRequestScope()) || this.same(operation.scope, this.revokedScope)
      || operation.signal.reason instanceof SkillHubDesktopError && operation.signal.reason.code === "HUB_ACCOUNT_CHANGED") {
      throw hubAccountChanged()
    }
    if (operation.signal.aborted) throw new SkillHubDesktopError("HUB_CANCELLED", "Skill Hub 请求已取消。")
  }

  private same(a: Scope, b: Scope | null) {
    return b?.accountId === a.accountId && b.authRevision === a.authRevision
  }

  dispose() {
    this.unsubscribe()
    this.lifetime.abort(hubAccountChanged())
  }

  teams(op: HubAccountOperation, input: SkillHubTeamQuery = {}) {
    return this.json(op, requestPath(`/teams${queryString(input)}`), skillHubTeamPageSchema)
  }

  list(op: HubAccountOperation, input: SkillHubListInput) {
    return this.json(op, requestPath(`/skills${queryString(input)}`), skillHubPageSchema)
  }

  get(op: HubAccountOperation, skillId: string) {
    return this.json(op, requestPath(`/skills/${id(skillId)}`), skillHubDetailSchema)
  }

  main(op: HubAccountOperation, skillId: string, expectedVersionId?: string) {
    return this.json(op, requestPath(`/skills/${id(skillId)}/main${queryString({ expectedVersionId })}`), skillHubMainResultSchema)
  }

  async icon(op: HubAccountOperation, skillId: string) {
    const signal = AbortSignal.any([op.signal, AbortSignal.timeout(20_000)])
    const response = await this.request(op, requestPath(`/skills/${id(skillId)}/icon`), {}, signal)
    if (response.headers.get("Content-Type") !== "image/png") {
      await response.body?.cancel()
      throw new SkillHubDesktopError("HUB_RESPONSE_INVALID", "Skill 图标格式无效。")
    }
    const bytes = await readBytes(response, limits.iconBytes, signal)
    this.assertActive(op)
    const icon = inspectHubIconInput(bytes)
    if (icon?.type !== "image/png" || icon.width > limits.iconSize || icon.height > limits.iconSize) {
      throw new SkillHubDesktopError("HUB_RESPONSE_INVALID", "Skill 图标格式无效。")
    }
    return bytes.toString("base64")
  }

  receipt(op: HubAccountOperation, input: SkillHubReceiptInput) {
    return this.json(op, requestPath(`/receipts/${id(input.requestId)}${queryString({ action: input.action })}`), skillHubReceiptSchema)
  }

  upload(op: HubAccountOperation, input: SkillHubUploadInput, bytes: Uint8Array) {
    return this.json(op, requestPath(`/uploads${queryString(input)}`), skillHubUploadResultSchema, {
      method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: Uint8Array.from(bytes),
    }, 125_000)
  }

  create(op: HubAccountOperation, input: SkillHubCreateInput) {
    return this.json(op, requestPath("/skills"), skillHubWriteResultSchema.or(skillHubWriteReplaySchema), this.write("POST", input))
  }

  publish(op: HubAccountOperation, skillId: string, input: SkillHubPublishInput) {
    return this.json(op, requestPath(`/skills/${id(skillId)}/versions`), skillHubWriteResultSchema.or(skillHubWriteReplaySchema), this.write("POST", input))
  }

  update(op: HubAccountOperation, skillId: string, input: SkillHubUpdateInput) {
    return this.json(op, requestPath(`/skills/${id(skillId)}`), skillHubWriteResultSchema.or(skillHubWriteReplaySchema), this.write("PATCH", input))
  }

  delete(op: HubAccountOperation, skillId: string, input: SkillHubRevisionInput) {
    return this.json(op, requestPath(`/skills/${id(skillId)}`), skillHubDeleteResultSchema.or(skillHubWriteReplaySchema), this.write("DELETE", input))
  }

  async download(op: HubAccountOperation, skillId: string, expectedVersionId?: string) {
    const signal = AbortSignal.any([op.signal, AbortSignal.timeout(120_000)])
    const response = await this.request(op, requestPath(`/skills/${id(skillId)}/package${queryString({ expectedVersionId })}`), {}, signal)
    const bytes = await readBytes(response, limits.uploadBytes, signal)
    this.assertActive(op)
    const version = skillHubIdSchema.safeParse(response.headers.get("X-Skill-Hub-Version-Id"))
    const archiveSha256 = response.headers.get("X-Skill-Hub-Archive-Sha256")
    if (!version.success || (expectedVersionId && expectedVersionId !== version.data) || sha256(bytes) !== archiveSha256) {
      throw new SkillHubDesktopError("HUB_DOWNLOAD_INVALID", "下载文件与当前版本不符，请重新读取后再试。")
    }
    return { bytes, versionId: version.data, archiveSha256 }
  }

  private write(method: string, input: unknown): RequestInit {
    return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }
  }

  private async json<T>(
    op: HubAccountOperation, path: string, schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } },
    init: RequestInit = {}, timeout = 20_000,
  ): Promise<T> {
    const signal = AbortSignal.any([op.signal, AbortSignal.timeout(timeout)])
    const response = await this.request(op, path, init, signal)
    try {
      const bytes = await readBytes(response, 8 * 1024 * 1024, signal)
      this.assertActive(op)
      const result = schema.safeParse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)))
      if (!result.success) throw new SkillHubDesktopError("HUB_UNSUPPORTED_SERVER", "Skill Hub 响应不兼容，请检查客户端与服务端版本。")
      return result.data
    } catch (error) {
      this.assertActive(op)
      if (error instanceof SkillHubDesktopError) throw error
      throw new SkillHubDesktopError("HUB_RESPONSE_INVALID", "未能确认服务端响应，请稍后重试。")
    }
  }

  private async request(op: HubAccountOperation, path: string, init: RequestInit, signal: AbortSignal) {
    this.assertActive(op)
    try {
      const response = await this.account.fetchAuthenticated(path, { ...init, redirect: "error", signal }, "Skill Hub 请求失败。", op.scope)
      this.assertActive(op)
      return response
    } catch (error) {
      this.assertActive(op)
      if (error instanceof SkillHubDesktopError) throw error
      const failure = error as { status?: number; code?: string }
      if (failure.code && Object.hasOwn(remoteMessages, failure.code)) {
        throw new SkillHubDesktopError(failure.code, remoteMessages[failure.code], { status: failure.status })
      }
      if (failure.status === 404 || failure.status === 405) {
        throw new SkillHubDesktopError("HUB_UNSUPPORTED_SERVER", "当前服务端不支持 Skill Hub，请升级服务端。")
      }
      if (failure.status === 401) throw new SkillHubDesktopError("HUB_ACCOUNT_REQUIRED", "登录已失效，请重新登录 Synapse。")
      if (failure.status && failure.status < 500) {
        throw new SkillHubDesktopError("HUB_REQUEST_REJECTED", "Skill Hub 拒绝了此请求。", { status: failure.status })
      }
      throw new SkillHubDesktopError("HUB_CONNECTION_ERROR", "Skill Hub 连接中断或超时，请重试或查询写入回执。")
    }
  }
}
