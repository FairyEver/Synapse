import { createHash, randomUUID } from "node:crypto"
import { mkdir, readFile, rm } from "node:fs/promises"
import path from "node:path"
import type { ControlledProcessRunner, ControlledProcessSession } from "../../../electron/runtime/process"
import { WECOM_CONNECTOR_ID } from "../shared/capability"

const AUTH_TIMEOUT_MS = 5 * 60 * 1000
const COMMAND_TIMEOUT_MS = 45_000
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024

export type WecomCliErrorCode =
  | "cli_unavailable"
  | "connector_required"
  | "connector_disabled"
  | "auth_required"
  | "auth_timeout"
  | "permission_denied"
  | "cancelled"
  | "command_failed"
  | "invalid_response"
  | "qr_unavailable"
  | "storage_error"

export class WecomCliError extends Error {
  constructor(
    readonly code: WecomCliErrorCode,
    message: string,
    readonly options: {
      readonly errcode?: number
      readonly helpUrl?: string
      readonly permission?: string
    } = {},
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

export type WecomCliRunOptions = {
  readonly actor?: "user" | "system"
  readonly abortSignal?: AbortSignal
  readonly timeoutMs?: number
  readonly metadata?: Record<string, unknown>
}

export type WecomCliClient = {
  isAuthorized(ownerUserId: string): Promise<boolean>
  validate(ownerUserId: string): Promise<void>
  startAuth(ownerUserId: string): Promise<WecomCliAuthSession>
  disconnect(ownerUserId: string): Promise<void>
  clearAgentWork(ownerUserId: string): Promise<void>
  run(ownerUserId: string, args: readonly string[], options?: WecomCliRunOptions): Promise<string>
  runAgent(
    ownerUserId: string,
    sessionKey: string,
    args: readonly string[],
    options?: WecomCliRunOptions,
  ): Promise<{ readonly output: string; readonly workingDirectory: string }>
}

export type WecomCliClientDeps = {
  readonly binaryPath: string
  readonly rootDir: string
  readonly processRunner: Pick<ControlledProcessRunner, "run" | "start">
}

export function createWecomCliClient(deps: WecomCliClientDeps): WecomCliClient {
  const rootDir = deps.rootDir

  function ownerDirectory(ownerUserId: string): string {
    return path.join(rootDir, "owners", createHash("sha256").update(ownerUserId).digest("hex"))
  }

  function configDirectory(ownerUserId: string): string {
    return path.join(ownerDirectory(ownerUserId), "config")
  }

  function workDirectory(ownerUserId: string): string {
    return path.join(ownerDirectory(ownerUserId), "work")
  }

  function agentWorkDirectory(ownerUserId: string, sessionKey: string): string {
    return path.join(ownerDirectory(ownerUserId), "agent-work", createHash("sha256").update(sessionKey).digest("hex"))
  }

  async function ensureDirectories(ownerUserId: string) {
    const ownerDir = ownerDirectory(ownerUserId)
    const configDir = configDirectory(ownerUserId)
    const workDir = workDirectory(ownerUserId)
    try {
      await Promise.all([mkdir(ownerDir, { recursive: true }), mkdir(configDir, { recursive: true }), mkdir(workDir, { recursive: true })])
    } catch {
      throw new WecomCliError("storage_error", "无法创建企业微信本地目录。")
    }
    return { ownerDir, configDir, workDir }
  }

  async function runInDirectory(
    ownerUserId: string,
    cwd: string,
    args: readonly string[],
    options: WecomCliRunOptions = {},
  ): Promise<string> {
    const { configDir } = await ensureDirectories(ownerUserId)
    let result
    try {
      result = await deps.processRunner.run({
        actor: options.actor === "system"
          ? { kind: "system", id: "wecom-connector" }
          : { kind: "user" },
        action: "shell.exec",
        command: deps.binaryPath,
        args: [...args],
        cwd,
        env: { WECOM_CLI_CONFIG_DIR: configDir },
        envAllowlist: ["WECOM_CLI_CONFIG_DIR"],
        timeoutMs: options.timeoutMs ?? COMMAND_TIMEOUT_MS,
        abortSignal: options.abortSignal,
        output: {
          stdout: "buffer",
          stderr: "buffer",
          maxBufferBytes: MAX_OUTPUT_BYTES,
          overflow: "truncate",
        },
        metadata: { connectorId: WECOM_CONNECTOR_ID, ...options.metadata },
      })
    } catch (error) {
      if (error instanceof WecomCliError) throw error
      throw new WecomCliError("cli_unavailable", "无法启动企业微信 CLI。")
    }
    if (options.abortSignal?.aborted) throw new WecomCliError("cancelled", "企业微信操作已取消。")
    if (result.timedOut) {
      throw new WecomCliError("command_failed", "企业微信操作超时，请重试。")
    }
    if (result.exitCode !== 0) throw commandError(result.stdout)
    return result.stdout ?? ""
  }

  async function run(
    ownerUserId: string,
    args: readonly string[],
    options: WecomCliRunOptions = {},
  ): Promise<string> {
    const { ownerDir } = await ensureDirectories(ownerUserId)
    return runInDirectory(ownerUserId, ownerDir, args, options)
  }

  async function runAgent(
    ownerUserId: string,
    sessionKey: string,
    args: readonly string[],
    options: WecomCliRunOptions = {},
  ): Promise<{ readonly output: string; readonly workingDirectory: string }> {
    const workingDirectory = agentWorkDirectory(ownerUserId, sessionKey)
    try {
      await mkdir(workingDirectory, { recursive: true, mode: 0o700 })
    } catch {
      throw new WecomCliError("storage_error", "无法创建企业微信工作目录。")
    }
    return {
      output: await runInDirectory(ownerUserId, workingDirectory, args, options),
      workingDirectory,
    }
  }

  async function isAuthorized(ownerUserId: string): Promise<boolean> {
    const status = (await run(ownerUserId, ["auth", "show", "--status"], {
      actor: "system",
      metadata: { operation: "auth.status" },
    })).trim()
    return status === "authorized"
  }

  async function validate(ownerUserId: string): Promise<void> {
    if (!await isAuthorized(ownerUserId)) {
      throw new WecomCliError("auth_required", "企业微信授权已失效，请重新连接。")
    }
    try {
      await run(ownerUserId, ["identity", "whoami"], {
        actor: "system",
        metadata: { operation: "identity.whoami" },
      })
    } catch (error) {
      if (error instanceof WecomCliError && error.code === "permission_denied") return
      throw error
    }
  }

  async function startAuth(ownerUserId: string): Promise<WecomCliAuthSession> {
    const { ownerDir, configDir, workDir } = await ensureDirectories(ownerUserId)
    const qrPath = path.join(workDir, `auth-${randomUUID()}.png`)
    try {
      await Promise.all([rm(configDir, { recursive: true, force: true }), rm(qrPath, { force: true })])
      await mkdir(configDir, { recursive: true })
    } catch {
      throw new WecomCliError("storage_error", "无法准备企业微信本地凭据目录。")
    }

    let session: ControlledProcessSession
    try {
      session = await deps.processRunner.start({
        actor: { kind: "user" },
        action: "shell.exec",
        command: deps.binaryPath,
        args: ["auth", "init", "--noninteractive", "--no-browser", "--output-qrcode", qrPath],
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
        metadata: { connectorId: WECOM_CONNECTOR_ID, operation: "auth.init" },
      })
    } catch {
      throw new WecomCliError("cli_unavailable", "无法启动企业微信授权。")
    }

    const completion = session.wait()
    let qrCodeDataUrl: string
    try {
      qrCodeDataUrl = await waitForQrCode(qrPath, completion)
    } catch (error) {
      await session.close("SIGTERM").catch(() => undefined)
      if (error instanceof WecomCliError) throw error
      throw new WecomCliError("qr_unavailable", "企业微信授权二维码生成失败。")
    }

    const wait = completion.then((result) => {
      if (result.timedOut) throw new WecomCliError("auth_timeout", "企业微信授权超时，请重新连接。")
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

  async function disconnect(ownerUserId: string): Promise<void> {
    try {
      await rm(ownerDirectory(ownerUserId), { recursive: true, force: true })
    } catch {
      throw new WecomCliError("storage_error", "无法清理企业微信本地授权。")
    }
  }

  async function clearAgentWork(ownerUserId: string): Promise<void> {
    try {
      await rm(path.join(ownerDirectory(ownerUserId), "agent-work"), { recursive: true, force: true })
    } catch {
      throw new WecomCliError("storage_error", "无法清理企业微信工作目录。")
    }
  }

  return { isAuthorized, validate, startAuth, disconnect, clearAgentWork, run, runAgent }
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
    if (completed) throw new WecomCliError("qr_unavailable", "企业微信授权进程提前结束。")
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new WecomCliError("qr_unavailable", "企业微信授权二维码未生成。")
}

function commandError(stdout: string | undefined): WecomCliError {
  if (!stdout) return new WecomCliError("command_failed", "企业微信操作失败，请重试。")
  try {
    const parsed: unknown = JSON.parse(stdout)
    if (!isRecord(parsed)) return new WecomCliError("command_failed", "企业微信操作失败，请重试。")
    const error = isRecord(parsed.error) ? parsed.error : parsed
    const errcode = typeof error.errcode === "number"
      ? error.errcode
      : typeof error.code === "number"
        ? error.code
        : undefined
    const helpMessage = normalizeCliText(stringValue(error.help_message) || stringValue(error.instruction))
    const permissionDenied = errcode === 851008
    const message = commandErrorMessage(error, helpMessage)
    const helpUrl = permissionDenied ? extractHelpUrl(helpMessage) : undefined
    const permission = permissionDenied ? extractPermission(message) : undefined
    return new WecomCliError(
      permissionDenied
        ? "permission_denied"
        : errcode === 853004
          ? "auth_required"
          : "command_failed",
      message,
      {
        ...(errcode === undefined ? {} : { errcode }),
        ...(helpUrl ? { helpUrl } : {}),
        ...(permission ? { permission } : {}),
      },
    )
  } catch {
    // Never expose raw CLI output; it can contain sensitive authorization details.
    return new WecomCliError("command_failed", "企业微信操作失败，请重试。")
  }
}

function commandErrorMessage(value: Record<string, unknown>, helpMessage: string): string {
  if (helpMessage) return helpMessage.split("\n").find((line) => line.trim())?.trim() ?? helpMessage
  const raw = typeof value.message === "string"
    ? value.message.trim()
    : typeof value.errmsg === "string"
      ? value.errmsg.trim()
      : ""
  return raw
    .replace(/,\s*hint:\s*\[[^\]]+\].*$/iu, "")
    .replace(/\s+from ip:\s*\S+.*$/iu, "")
    .trim() || "企业微信操作失败，请重试。"
}

function extractHelpUrl(message: string): string | undefined {
  const markdownLink = message.match(/\[[^\]]+\]\((https:\/\/[^)\s]+)\)/u)?.[1]
  if (markdownLink) return markdownLink
  return message.match(/https:\/\/[^\s)]+/u)?.[0]
}

function extractPermission(message: string): string | undefined {
  return message.match(/「([^」]+)」能力/u)?.[1]?.trim() || undefined
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
