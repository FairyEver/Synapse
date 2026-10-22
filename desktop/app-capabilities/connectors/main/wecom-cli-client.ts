import { createHash, randomUUID } from "node:crypto"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import type { ControlledProcessRunner, ControlledProcessSession } from "../../../electron/runtime/process"
import type {
  WecomMailDetail,
  WecomMailGetInput,
  WecomMailPerson,
  WecomMailSearchInput,
  WecomMailSearchResult,
  WecomMailSendInput,
  WecomMailSendResult,
  WecomMailSummary,
} from "../shared/wecom-mail"

const AUTH_TIMEOUT_MS = 5 * 60 * 1000
const COMMAND_TIMEOUT_MS = 45_000
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu

export type WecomCliErrorCode =
  | "cli_unavailable"
  | "auth_required"
  | "auth_timeout"
  | "permission_denied"
  | "command_failed"
  | "invalid_response"
  | "qr_unavailable"
  | "storage_error"

export class WecomCliError extends Error {
  constructor(
    readonly code: WecomCliErrorCode,
    message: string,
    readonly helpUrl?: string,
  ) {
    super(message)
    this.name = "WecomCliError"
  }
}

export type WecomCliAuthSession = {
  readonly qrCodeDataUrl: string
  wait(): Promise<void>
  cancel(): Promise<void>
}

export type WecomCliAccount = {
  readonly address?: string
  readonly displayName?: string
  readonly warningMessage?: string
  readonly helpUrl?: string
}

export type WecomCliClient = {
  isAuthorized(ownerUserId: string): Promise<boolean>
  startAuth(ownerUserId: string): Promise<WecomCliAuthSession>
  validate(ownerUserId: string): Promise<WecomCliAccount>
  disconnect(ownerUserId: string): Promise<void>
  search(ownerUserId: string, input: WecomMailSearchInput): Promise<WecomMailSearchResult>
  get(ownerUserId: string, input: WecomMailGetInput): Promise<WecomMailDetail>
  send(ownerUserId: string, input: WecomMailSendInput): Promise<WecomMailSendResult>
}

export type WecomCliClientDeps = {
  readonly binaryPath: string
  readonly rootDir: string
  readonly processRunner: Pick<ControlledProcessRunner, "run" | "start">
  readonly now?: () => number
}

export function createWecomCliClient(deps: WecomCliClientDeps): WecomCliClient {
  const rootDir = deps.rootDir

  async function ensureDirectories(ownerUserId: string) {
    const ownerDir = ownerDirectory(ownerUserId)
    const configDir = configDirectory(ownerUserId)
    const workDir = workDirectory(ownerUserId)
    try {
      await Promise.all([mkdir(ownerDir, { recursive: true }), mkdir(configDir, { recursive: true }), mkdir(workDir, { recursive: true })])
    } catch {
      throw new WecomCliError("storage_error", "无法创建企业微信邮箱本地目录。")
    }
    return { ownerDir, configDir, workDir }
  }

  function ownerDirectory(ownerUserId: string): string {
    return path.join(rootDir, "owners", createHash("sha256").update(ownerUserId).digest("hex"))
  }

  function configDirectory(ownerUserId: string): string {
    return path.join(ownerDirectory(ownerUserId), "config")
  }

  function workDirectory(ownerUserId: string): string {
    return path.join(ownerDirectory(ownerUserId), "work")
  }

  async function runCommand(
    ownerUserId: string,
    args: readonly string[],
    options: {
      readonly actor?: "user" | "system"
      readonly timeoutMs?: number
      readonly metadata?: Record<string, unknown>
    } = {},
  ): Promise<string> {
    const { ownerDir, configDir } = await ensureDirectories(ownerUserId)
    let result
    try {
      result = await deps.processRunner.run({
        actor: options.actor === "system"
          ? { kind: "system", id: "wecom-mail-connector" }
          : { kind: "user" },
        action: "shell.exec",
        command: deps.binaryPath,
        args: [...args],
        cwd: ownerDir,
        env: { WECOM_CLI_CONFIG_DIR: configDir },
        envAllowlist: ["WECOM_CLI_CONFIG_DIR"],
        timeoutMs: options.timeoutMs ?? COMMAND_TIMEOUT_MS,
        output: {
          stdout: "buffer",
          stderr: "buffer",
          maxBufferBytes: MAX_OUTPUT_BYTES,
          overflow: "truncate",
        },
        metadata: { connectorId: "wecom-mail", ...options.metadata },
      })
    } catch (error) {
      if (error instanceof WecomCliError) throw error
      throw new WecomCliError("cli_unavailable", "无法启动企业微信邮箱。")
    }
    if (result.timedOut) throw new WecomCliError("command_failed", "企业微信邮箱操作超时，请重试。")
    if (result.exitCode !== 0) {
      throw commandError(result.stdout)
    }
    return result.stdout ?? ""
  }

  async function startAuth(ownerUserId: string): Promise<WecomCliAuthSession> {
    const { ownerDir, configDir, workDir } = await ensureDirectories(ownerUserId)
    const qrPath = path.join(workDir, `auth-${randomUUID()}.png`)
    try {
      await Promise.all([rm(configDir, { recursive: true, force: true }), rm(qrPath, { force: true })])
      await mkdir(configDir, { recursive: true })
    } catch {
      throw new WecomCliError("storage_error", "无法准备企业微信邮箱本地凭据目录。")
    }

    let session: ControlledProcessSession
    try {
      session = await deps.processRunner.start({
        actor: { kind: "user" },
        action: "shell.exec",
        command: deps.binaryPath,
        args: [
          "auth",
          "init",
          "--noninteractive",
          "--no-browser",
          "--output-qrcode",
          qrPath,
        ],
        cwd: ownerDir,
        env: { WECOM_CLI_CONFIG_DIR: configDir },
        envAllowlist: ["WECOM_CLI_CONFIG_DIR"],
        timeoutMs: AUTH_TIMEOUT_MS,
        output: {
          stdout: "buffer",
          stderr: "buffer",
          maxBufferBytes: 1024 * 1024,
          overflow: "truncate",
        },
        metadata: { connectorId: "wecom-mail", operation: "auth.init" },
      })
    } catch {
      throw new WecomCliError("cli_unavailable", "无法启动企业微信邮箱授权。")
    }

    const completion = session.wait()
    let qrCodeDataUrl: string
    try {
      qrCodeDataUrl = await waitForQrCode(qrPath, completion)
    } catch (error) {
      await session.close("SIGTERM").catch(() => undefined)
      if (error instanceof WecomCliError) throw error
      throw new WecomCliError("qr_unavailable", "企业微信邮箱授权二维码生成失败。")
    }

    const wait = completion.then((result) => {
      if (result.timedOut) throw new WecomCliError("auth_timeout", "企业微信邮箱授权超时，请重新连接。")
      if (result.exitCode !== 0) throw commandError(result.stdout)
    }).finally(async () => {
      await rm(qrPath, { force: true }).catch(() => undefined)
    })

    return {
      qrCodeDataUrl,
      wait: () => wait,
      cancel: async () => {
        await session.close("SIGTERM").catch(() => undefined)
        await rm(configDir, { recursive: true, force: true }).catch(() => undefined)
        await rm(qrPath, { force: true }).catch(() => undefined)
      },
    }
  }

  async function isAuthorized(ownerUserId: string): Promise<boolean> {
    const status = (await runCommand(ownerUserId, ["auth", "show", "--status"], {
      actor: "system",
      metadata: { operation: "auth.status" },
    })).trim()
    return status === "authorized"
  }

  async function validate(ownerUserId: string): Promise<WecomCliAccount> {
    if (!await isAuthorized(ownerUserId)) {
      throw new WecomCliError("auth_required", "企业微信邮箱授权已失效，请重新连接。")
    }

    const identity = await runCommand(ownerUserId, ["identity", "whoami"], {
      actor: "system",
      metadata: { operation: "identity.whoami" },
    })
    const email = identity.match(EMAIL_PATTERN)?.[0]
    const account: WecomCliAccount = email ? { address: email } : {}
    try {
      await runCommand(ownerUserId, ["mail", "search", "--json", JSON.stringify({
        folder_names: ["收件箱"],
        limit: 1,
      })], {
        actor: "system",
        metadata: { operation: "mail.search.verify" },
      })
    } catch (error) {
      if (error instanceof WecomCliError && error.code === "permission_denied") {
        return {
          ...account,
          warningMessage: error.message,
          ...(error.helpUrl ? { helpUrl: error.helpUrl } : {}),
        }
      }
      throw error
    }
    return account
  }

  async function disconnect(ownerUserId: string): Promise<void> {
    try {
      await rm(ownerDirectory(ownerUserId), { recursive: true, force: true })
    } catch {
      throw new WecomCliError("storage_error", "无法清理企业微信邮箱本地授权。")
    }
  }

  async function search(ownerUserId: string, input: WecomMailSearchInput): Promise<WecomMailSearchResult> {
    const keywords = input.query?.trim().split(/\s+/u).filter(Boolean).slice(0, 10)
    const output = await runCommand(ownerUserId, ["mail", "search", "--json", JSON.stringify({
      folder_names: ["收件箱"],
      ...(keywords?.length ? { keywords } : {}),
      ...(input.cursor ? { cursor: input.cursor } : {}),
      limit: input.limit ?? 50,
    })], { metadata: { operation: "mail.search" } })
    const body = parseJsonObject(output)
    const mails = Array.isArray(body.mails) ? body.mails : []
    return {
      items: mails.map(normalizeSummary).filter((item): item is WecomMailSummary => item !== null),
      nextCursor: typeof body.next_cursor === "string" && body.next_cursor ? body.next_cursor : null,
      hasMore: body.has_more === true,
    }
  }

  async function get(ownerUserId: string, input: WecomMailGetInput): Promise<WecomMailDetail> {
    const output = await runCommand(ownerUserId, ["mail", "get", "--json", JSON.stringify({
      mail_ids: [input.mailId],
    })], { metadata: { operation: "mail.get" } })
    const body = parseJsonObject(output)
    const first = Array.isArray(body.mail_list) ? body.mail_list[0] : null
    if (!isRecord(first)) throw new WecomCliError("invalid_response", "企业微信邮箱返回了无效的邮件内容。")
    if (typeof first.errcode === "number" && first.errcode !== 0) {
      throw commandError(JSON.stringify(first))
    }

    let content = typeof first.content === "string" ? first.content : ""
    if (!content && typeof first.file_path === "string") {
      content = await readBodyFile(ownerUserId, first.file_path)
    }

    return {
      mailId: input.mailId,
      subject: stringValue(first.subject),
      sendTime: stringValue(first.send_time),
      sender: normalizePerson(first.sender),
      receivers: normalizePeople(first.to),
      isRead: true,
      folderName: stringValue(first.folder_name) || undefined,
      content,
      to: normalizePeople(first.to),
      cc: normalizePeople(first.cc),
      bcc: normalizePeople(first.bcc),
      attachments: normalizeAttachments(first.attachments),
    }
  }

  async function send(ownerUserId: string, input: WecomMailSendInput): Promise<WecomMailSendResult> {
    const { workDir } = await ensureDirectories(ownerUserId)
    const bodyPath = path.join(workDir, `mail-body-${randomUUID()}.md`)
    try {
      await writeFile(bodyPath, input.body, { encoding: "utf8", mode: 0o600 })
      const body: Record<string, unknown> = {
        to: { emails: input.to },
        ...(input.cc?.length ? { cc: { emails: input.cc } } : {}),
        ...(input.bcc?.length ? { bcc: { emails: input.bcc } } : {}),
        subject: input.subject,
        file_path: bodyPath,
        content_type: "markdown",
        ...(input.replyToMailId
          ? { reply: { last_mail_id: input.replyToMailId, reply_all: input.replyAll === true } }
          : {}),
      }
      await runCommand(ownerUserId, ["mail", "send", "--json", JSON.stringify(body)], {
        metadata: { operation: input.replyToMailId ? "mail.reply" : "mail.send" },
      })
      return { ok: true }
    } finally {
      await rm(bodyPath, { force: true }).catch(() => undefined)
    }
  }

  async function readBodyFile(ownerUserId: string, filePath: string): Promise<string> {
    const ownerDir = ownerDirectory(ownerUserId)
    const resolvedOwnerDir = path.resolve(ownerDir)
    const resolvedFile = path.resolve(filePath)
    if (resolvedFile !== resolvedOwnerDir && !resolvedFile.startsWith(`${resolvedOwnerDir}${path.sep}`)) {
      throw new WecomCliError("invalid_response", "企业微信邮箱返回了无效的正文路径。")
    }
    try {
      const content = await readFile(resolvedFile, "utf8")
      await rm(resolvedFile, { force: true }).catch(() => undefined)
      return content
    } catch {
      throw new WecomCliError("invalid_response", "无法读取企业微信邮箱的正文文件。")
    }
  }

  return { isAuthorized, startAuth, validate, disconnect, search, get, send }
}

async function waitForQrCode(
  qrPath: string,
  completion: Promise<{ readonly exitCode: number | null; readonly timedOut: boolean }>,
): Promise<string> {
  let completed = false
  void completion.then(() => { completed = true }, () => { completed = true })
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const bytes = await readFile(qrPath)
      if (bytes.byteLength >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
        return `data:image/png;base64,${bytes.toString("base64")}`
      }
    } catch {
      // The CLI creates the file after starting its authorization session.
    }
    if (completed) throw new WecomCliError("qr_unavailable", "企业微信邮箱授权进程提前结束。")
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new WecomCliError("qr_unavailable", "企业微信邮箱授权二维码未生成。")
}

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value)
    if (isRecord(parsed)) return parsed
  } catch {
    // Fall through to a stable user-facing error.
  }
  throw new WecomCliError("invalid_response", "企业微信邮箱返回了无效数据。")
}

function normalizeSummary(value: unknown): WecomMailSummary | null {
  if (!isRecord(value) || typeof value.mail_id !== "string" || !value.mail_id) return null
  return {
    mailId: value.mail_id,
    subject: stringValue(value.subject),
    sendTime: stringValue(value.send_time),
    sender: normalizePerson(value.sender),
    receivers: normalizePeople(value.receivers),
    isRead: value.is_read === true,
    folderName: stringValue(value.folder_name) || undefined,
  }
}

function normalizePerson(value: unknown): WecomMailPerson {
  if (!isRecord(value)) return { name: "", email: "" }
  return {
    name: stringValue(value.name),
    email: stringValue(value.email),
  }
}

function normalizePeople(value: unknown): WecomMailPerson[] {
  return Array.isArray(value) ? value.map(normalizePerson).filter((person) => person.email) : []
}

function normalizeAttachments(value: unknown): Array<{ name: string; size?: number }> {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!isRecord(item) || typeof item.name !== "string") return []
    return [{
      name: item.name,
      ...(typeof item.size === "number" && Number.isSafeInteger(item.size) && item.size >= 0 ? { size: item.size } : {}),
    }]
  })
}

function commandError(stdout: string | undefined): WecomCliError {
  if (!stdout) return new WecomCliError("command_failed", "企业微信邮箱操作失败，请重试。")
  try {
    const parsed: unknown = JSON.parse(stdout)
    if (!isRecord(parsed)) return new WecomCliError("command_failed", "企业微信邮箱操作失败，请重试。")
    const error = isRecord(parsed.error) ? parsed.error : parsed
    const errcode = typeof error.errcode === "number" ? error.errcode : undefined
    const helpMessage = normalizeCliText(stringValue(error.help_message) || stringValue(error.instruction))
    const message = commandErrorMessage(error, helpMessage)
    const permissionDenied = errcode === 851008
    return new WecomCliError(
      permissionDenied
        ? "permission_denied"
        : errcode === 853004
          ? "auth_required"
          : "command_failed",
      message,
      permissionDenied ? extractHelpUrl(helpMessage) : undefined,
    )
  } catch {
    // Never expose raw CLI output; it can contain sensitive authorization details.
    return new WecomCliError("command_failed", "企业微信邮箱操作失败，请重试。")
  }
}

function commandErrorMessage(value: Record<string, unknown>, helpMessage: string): string {
  if (helpMessage) return helpMessage.split("\n").find((line) => line.trim())?.trim() ?? helpMessage
  const message = typeof value.message === "string"
    ? value.message.trim()
    : typeof value.errmsg === "string"
      ? value.errmsg.trim()
      : ""
  return message || "企业微信邮箱操作失败，请重试。"
}

function extractHelpUrl(message: string): string | undefined {
  const markdownLink = message.match(/\[[^\]]+\]\((https:\/\/[^)\s]+)\)/u)?.[1]
  if (markdownLink) return markdownLink
  return message.match(/https:\/\/[^\s)]+/u)?.[0]
}

function normalizeCliText(value: string): string {
  return value.replace(/\\n/gu, "\n").trim()
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
