/**
 * Phase 0.3 — Electron IPC transport adapter.
 *
 * Wires IpcRegistry into ipcMain.handle for production use.
 * This is the ONLY allowed place outside tests to use ipcMain.handle.
 */

import { ipcMain } from "electron"
import type { SynapseGitUserFacingFailure } from "../../../src/types/git"
import { assertTrustedIpcSender } from "../../ipc/validated-ipc"
import { sanitizeGitDiagnosticText } from "../../services/git-client/git-sanitize"

type IpcTransportLogger = {
  info?: (message: string, meta?: unknown) => void
  warn?: (message: string, meta?: unknown) => void
  error: (message: string, meta?: unknown) => void
}

type ElectronTransportInstallOptions = {
  logger?: IpcTransportLogger
}

const SENSITIVE_FIELD_PATTERN =
  /(password|token|secret|credential|api[-_]?key|app[-_]?secret|private[-_ ]?key|cookie|authorization)/i
const SENSITIVE_MAP_FIELD_PATTERN = /^(skillEnvValues|skillEnvReplacementValues|variableSubstitutions|skillEnvSecretNames|variableSecretNames)$/i
const BODY_FIELD_PATTERN = /^(prompt|message|content|body|text|requestbody|responsebody|requesttext|responsetext)$/
const PATH_FIELD_PATTERN = /^(path|paths|url|urls|uri|uris|remoteurl|remoteurls|filepath|filepaths|folderpath|folderpaths|relativepath|relativepaths|fullpath|fullpaths|targetpath|targetpaths|sourcepath|sourcepaths|itempath|itempaths|foldername|filename)$/
const MAX_STRING_LENGTH = 300
const MAX_STACK_LENGTH = 1200
const MAX_ARRAY_LENGTH = 20
const PATH_REDACTED = "[path redacted]"
const IPC_ERROR_ENVELOPE_KEY = "__synapseIpcError"
const SECRETS_MUTATION_CHANNELS = new Set([
  "synapse:app:secrets:item:create",
  "synapse:app:secrets:item:update",
  "synapse:app:secrets:item:upsert",
])

type IpcErrorEnvelope = {
  readonly [IPC_ERROR_ENVELOPE_KEY]: true
  readonly message: string
  readonly name: string
  readonly userFacingFailure?: SynapseGitUserFacingFailure
}

function sanitizeIpcValue(fieldName: string, value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value
  if (SENSITIVE_MAP_FIELD_PATTERN.test(fieldName)) {
    return sensitiveMapSummary(value)
  }
  if (typeof value === "number" || typeof value === "boolean") return value
  if (typeof value === "string") {
    if (SENSITIVE_FIELD_PATTERN.test(fieldName)) return "[redacted]"
    if (isBodyField(fieldName)) return `[redacted text ${value.length} chars]`
    if (isPathLikeField(fieldName)) return PATH_REDACTED
    return value.length > MAX_STRING_LENGTH
      ? `${value.slice(0, 120)}...[truncated ${value.length} chars]`
      : value
  }
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_LENGTH).map((item) => sanitizeIpcValue(fieldName, item, depth + 1))
  }
  if (typeof value === "object") {
    if (depth >= 3) return "[object]"
    const record = value as Record<string, unknown>
    return Object.fromEntries(
      Object.entries(record).map(([key, item]) => [
        key,
        sanitizeIpcObjectField(record, key, item, depth + 1),
      ]),
    )
  }
  return String(value)
}

function sensitiveMapSummary(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "[redacted]"
  return {
    type: "sensitive-map",
    keyCount: Object.keys(value as Record<string, unknown>).length,
  }
}

function sanitizeIpcRequest(channel: string, request: unknown): unknown {
  if (!SECRETS_MUTATION_CHANNELS.has(channel)) return sanitizeIpcValue("request", request)
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    return { inputType: typeof request }
  }
  const record = request as Record<string, unknown>
  return {
    nameProvided: typeof record.name === "string",
    valueProvided: typeof record.value === "string",
    descriptionProvided: typeof record.description === "string",
  }
}

function sanitizeIpcObjectField(
  owner: Record<string, unknown>,
  key: string,
  item: unknown,
  depth: number,
): unknown {
  if (key === "name" && typeof item === "string" && isLocalFileItemLike(owner)) {
    return PATH_REDACTED
  }
  return sanitizeIpcValue(key, item, depth)
}

function isBodyField(fieldName: string): boolean {
  return BODY_FIELD_PATTERN.test(fieldName.toLowerCase().replace(/[-_\s]/g, ""))
}

function isPathLikeField(fieldName: string): boolean {
  return PATH_FIELD_PATTERN.test(fieldName.toLowerCase().replace(/[-_\s]/g, ""))
}

function isLocalFileItemLike(value: Record<string, unknown>): boolean {
  return value.kind === "file" && typeof value.path === "string"
}

function sanitizeErrorForLog(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      messageLength: error.message.length,
      stack: sanitizeErrorStack(error),
    }
  }

  const text = typeof error === "string" ? error : String(error)
  return {
    name: typeof error,
    messageLength: text.length,
  }
}

function createIpcErrorEnvelope(error: unknown): IpcErrorEnvelope {
  const message = sanitizeGitDiagnosticText(error instanceof Error ? error.message : String(error))
  const name = error instanceof Error ? error.name : typeof error
  const userFacingFailure = readSafeUserFacingFailure(error)
  return {
    [IPC_ERROR_ENVELOPE_KEY]: true,
    message,
    name,
    ...(userFacingFailure ? { userFacingFailure } : {}),
  }
}

function readSafeUserFacingFailure(error: unknown): SynapseGitUserFacingFailure | null {
  if (!error || typeof error !== "object") return null
  const failure = (error as { readonly userFacingFailure?: unknown }).userFacingFailure
  if (!isSafeUserFacingFailure(failure)) return null
  return {
    category: sanitizeGitDiagnosticText(failure.category) as SynapseGitUserFacingFailure["category"],
    detail: failure.detail === null ? null : sanitizeGitDiagnosticText(failure.detail),
    host: failure.host === null ? null : sanitizeGitDiagnosticText(failure.host),
    message: sanitizeGitDiagnosticText(failure.message),
    primaryAction: failure.primaryAction === null
      ? null
      : sanitizeGitDiagnosticText(failure.primaryAction) as SynapseGitUserFacingFailure["primaryAction"],
    protocol: sanitizeGitDiagnosticText(failure.protocol) as SynapseGitUserFacingFailure["protocol"],
    title: sanitizeGitDiagnosticText(failure.title),
  }
}

function isSafeUserFacingFailure(value: unknown): value is SynapseGitUserFacingFailure {
  if (!value || typeof value !== "object") return false
  const record = value as Partial<Record<keyof SynapseGitUserFacingFailure, unknown>>
  return typeof record.category === "string"
    && (record.detail === null || typeof record.detail === "string")
    && (record.host === null || typeof record.host === "string")
    && typeof record.message === "string"
    && (record.primaryAction === null || typeof record.primaryAction === "string")
    && typeof record.protocol === "string"
    && typeof record.title === "string"
}

function sanitizeErrorStack(error: Error): string | undefined {
  if (!error.stack) return undefined
  const [, ...frames] = error.stack.split("\n")
  const stack = [
    `${error.name}: [redacted message ${error.message.length} chars]`,
    ...frames.map(redactDiagnosticText),
  ].join("\n")
  return stack.length > MAX_STACK_LENGTH
    ? `${stack.slice(0, MAX_STACK_LENGTH)}...[truncated ${stack.length} chars]`
    : stack
}

function redactDiagnosticText(value: string): string {
  return value
    .replace(/([A-Za-z]:\\[^\s)]+|\/[^\s)]+)/g, "[path redacted]")
    .replace(
      /(password|token|secret|credential|api[-_]?key|app[-_]?secret|private[-_ ]?key|cookie|authorization)(\s*[:=]\s*)([^\s,;&)]+)/gi,
      "$1$2[redacted]",
    )
}

/**
 * Electron transport: installs handlers via ipcMain.handle.
 * Each installed handler returns a disposer that removes the listener.
 */
export function createElectronTransportInstall(options: ElectronTransportInstallOptions = {}) {
  return (channel: string, invoker: (request: unknown) => Promise<unknown>) => {
    // eslint-disable-next-line no-restricted-properties -- This adapter is the single Electron transport boundary for IpcRegistry.
    ipcMain.handle(channel, async (event, request) => {
      assertTrustedIpcSender(event)
      const startedAt = performance.now()
      try {
        return await invoker(request)
      } catch (error) {
        options.logger?.error("IPC invoke failed.", {
          channel,
          durationMs: Math.round(performance.now() - startedAt),
          error: sanitizeErrorForLog(error),
          request: sanitizeIpcRequest(channel, request),
        })
        return createIpcErrorEnvelope(error)
      }
    })
    return () => {
      ipcMain.removeHandler(channel)
    }
  }
}
