import { mkdir, readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

import type {
  ActorIdentity,
  AuditSink,
  PermissionGuard,
} from "../../runtime/security"
import type { ProviderRuntimeView } from "./types"

export interface PrepareCodexRuntimeDeps {
  readonly permissionGuard?: PermissionGuard
  readonly auditSink?: AuditSink
  readonly actor?: ActorIdentity
}

export async function prepareCodexRuntime(
  view: ProviderRuntimeView,
  deps: PrepareCodexRuntimeDeps = {},
): Promise<void> {
  if (view.agentType !== "codex" || !view.provider) return
  const codexHome = resolveCodexHome(view.provider.codex?.codexHome, view.env.CODEX_HOME)
  if (!shouldWriteCodexProvider(view)) return

  await mkdir(codexHome, { recursive: true, mode: 0o755 })
  await writeCodexProviderConfig(codexHome, view, deps)
  if (view.apiKey) {
    await writeCodexAuth(codexHome, view.apiKey, deps)
  }
}

export function buildCodexProviderSection(
  providerName: string,
  baseUrl: string | undefined,
  wireApi: string | undefined,
  headers: Record<string, string> | undefined,
): string {
  const lines = [
    `[model_providers.${providerName}]`,
    `name = ${JSON.stringify(providerName)}`,
  ]
  if (baseUrl) lines.push(`base_url = ${JSON.stringify(baseUrl)}`)
  lines.push(`env_key = ${JSON.stringify("OPENAI_API_KEY")}`)
  if (wireApi) lines.push(`wire_api = ${JSON.stringify(wireApi)}`)
  const headerEntries = Object.entries(headers ?? {})
  if (headerEntries.length > 0) {
    lines.push("", `[model_providers.${providerName}.http_headers]`)
    for (const [key, value] of headerEntries) {
      lines.push(`${JSON.stringify(key)} = ${JSON.stringify(value)}`)
    }
  }
  return `${lines.join("\n")}\n`
}

export function upsertCodexProviderSection(
  content: string,
  providerName: string,
  newSection: string,
): string {
  const sectionHeader = `[model_providers.${providerName}]`
  const subSectionPrefix = `[model_providers.${providerName}.`
  const lines = content.split(/\r?\n/)
  const start = lines.findIndex((line) => line.trim() === sectionHeader)
  if (start < 0) {
    const trimmed = content.trimEnd()
    return trimmed ? `${trimmed}\n\n${newSection}` : newSection
  }

  let end = lines.length
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? ""
    if (!line.startsWith("[")) continue
    if (line === sectionHeader || line.startsWith(subSectionPrefix)) continue
    end = index
    break
  }

  const before = lines.slice(0, start).join("\n").trimEnd()
  const after = lines.slice(end).join("\n").trimStart()
  if (before && after) return `${before}\n\n${newSection}\n${after}`
  if (before) return `${before}\n\n${newSection}`
  if (after) return `${newSection}\n${after}`
  return newSection
}

async function writeCodexProviderConfig(
  codexHome: string,
  view: ProviderRuntimeView,
  deps: PrepareCodexRuntimeDeps,
): Promise<void> {
  const provider = view.provider
  if (!provider) return
  const configPath = join(codexHome, "config.toml")
  const current = await readTextIfPresent(configPath)
  const section = buildCodexProviderSection(
    provider.id,
    provider.baseUrl,
    provider.codex?.wireApi,
    provider.codex?.httpHeaders,
  )
  const next = upsertCodexProviderSection(current, provider.id, section)
  await guardedWriteFile(configPath, next, { mode: 0o644 }, deps, {
    providerId: provider.id,
    projectId: view.projectId,
    agentType: view.agentType,
    file: "config.toml",
  })
}

async function writeCodexAuth(
  codexHome: string,
  apiKey: string,
  deps: PrepareCodexRuntimeDeps,
): Promise<void> {
  const authPath = join(codexHome, "auth.json")
  const payload = `${JSON.stringify({
    OPENAI_API_KEY: apiKey,
    auth_mode: "apikey",
  }, null, 2)}\n`
  await guardedWriteFile(authPath, payload, { mode: 0o600 }, deps, {
    file: "auth.json",
  })
}

async function guardedWriteFile(
  path: string,
  content: string,
  options: { readonly mode: number },
  deps: PrepareCodexRuntimeDeps,
  metadata: Record<string, unknown>,
): Promise<void> {
  const actor = deps.actor ?? { kind: "user" }
  if (deps.permissionGuard) {
    const permission = await deps.permissionGuard.check({
      action: "fs.write",
      actor,
      resource: path,
      context: metadata,
    })
    if (!permission.allowed) {
      deps.auditSink?.record({
        action: "fs.write",
        actor,
        resource: path,
        outcome: "denied",
        metadata: {
          ...metadata,
          reason: permission.reason,
          policyId: permission.policyId,
        },
      })
      throw new Error(permission.reason)
    }
  }

  try {
    await writeFile(path, content, { encoding: "utf8", mode: options.mode })
    deps.auditSink?.record({
      action: "fs.write",
      actor,
      resource: path,
      outcome: "allowed",
      metadata,
    })
  } catch (error) {
    deps.auditSink?.record({
      action: "fs.write",
      actor,
      resource: path,
      outcome: "failed",
      metadata: {
        ...metadata,
        error: error instanceof Error ? error.message : String(error),
      },
    })
    throw error
  }
}

async function readTextIfPresent(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8")
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return ""
    throw error
  }
}

function shouldWriteCodexProvider(view: ProviderRuntimeView): boolean {
  const provider = view.provider
  if (!provider) return false
  return Boolean(
    provider.baseUrl
    || provider.codex?.wireApi
    || (provider.codex?.httpHeaders && Object.keys(provider.codex.httpHeaders).length > 0)
    || view.apiKey,
  )
}

function resolveCodexHome(explicit: string | undefined, envValue: string | undefined): string {
  if (explicit?.trim()) return explicit.trim()
  if (envValue?.trim()) return envValue.trim()
  return join(homedir(), ".codex")
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error
}

