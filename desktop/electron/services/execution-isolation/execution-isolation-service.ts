import { randomUUID } from "node:crypto"

import type {
  DataNamespace,
  RunAsConfigEntryV1,
  RunAsPreflightEntryV1,
} from "../../runtime/data-repo"
import type {
  ControlledProcessIsolationOptions,
  ControlledProcessRunner,
} from "../../runtime/process"
import type { AuditSink } from "../../runtime/security"
import type { StructuredLogger } from "../../runtime/service-registry"
import type {
  ProcessIsolationResolver,
  RunAsCheckResult,
  RunAsConfigUpdate,
  RunAsConfigView,
} from "./types"

const DEFAULT_RUN_AS_ENV_ALLOWLIST = [
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LC_MESSAGES",
  "TERM",
]

const SIDE_CHANNEL_ENV_ALLOWLIST = [
  "CC_PROJECT",
  "CC_SESSION_KEY",
  "SYNAPSE_PROJECT",
  "SYNAPSE_SESSION_KEY",
  "SYNAPSE_SIDE_CHANNEL_BASE_URL",
  "SYNAPSE_SIDE_CHANNEL_URL",
  "SYNAPSE_RELAY_SEND_URL",
  "SYNAPSE_SIDE_CHANNEL_TOKEN",
]

export interface ExecutionIsolationServiceDeps {
  readonly configs: DataNamespace<RunAsConfigEntryV1>
  readonly preflights: DataNamespace<RunAsPreflightEntryV1>
  readonly processRunner: ControlledProcessRunner
  readonly auditSink?: AuditSink
  readonly logger?: StructuredLogger
  readonly now?: () => Date
}

export class ExecutionIsolationService implements ProcessIsolationResolver {
  private readonly deps: ExecutionIsolationServiceDeps

  constructor(deps: ExecutionIsolationServiceDeps) {
    this.deps = deps
  }

  async getConfig(projectId: string): Promise<RunAsConfigView> {
    return toView(await this.getOrCreateConfig(projectId))
  }

  async updateConfig(input: RunAsConfigUpdate): Promise<RunAsConfigView> {
    const existing = await this.getOrCreateConfig(input.projectId)
    const supported = isRunAsUserSupported()
    const nextUser = input.user === undefined ? existing.user : input.user.trim() || undefined
    const nextEnvAllowlist = input.envAllowlist === undefined
      ? existing.envAllowlist
      : normalizeAllowlist(input.envAllowlist)
    const nextRequirePreflight = input.requirePreflight ?? existing.requirePreflight
    const preflightBoundaryChanged = nextUser !== existing.user
      || !sameStringArray(nextEnvAllowlist, existing.envAllowlist)
      || nextRequirePreflight !== existing.requirePreflight
    const next: RunAsConfigEntryV1 = {
      ...existing,
      enabled: supported ? input.enabled ?? existing.enabled : false,
      user: nextUser,
      envAllowlist: nextEnvAllowlist,
      requirePreflight: nextRequirePreflight,
      lastError: !supported && input.enabled
        ? "run_as_user is not supported on Windows"
        : preflightBoundaryChanged ? undefined : existing.lastError,
      lastPreflightAt: preflightBoundaryChanged ? undefined : existing.lastPreflightAt,
      lastPreflightStatus: preflightBoundaryChanged ? undefined : existing.lastPreflightStatus,
      updatedAt: this.isoNow(),
    }
    await this.deps.configs.upsert(next)
    return toView(next)
  }

  async resolveProcessIsolation(
    projectId: string,
    extraEnvAllowlist: readonly string[] = [],
  ): Promise<ControlledProcessIsolationOptions | undefined> {
    const config = await this.getConfig(projectId)
    if (!config.enabled) return undefined
    if (!config.supported) {
      this.deps.logger?.warn("run_as_user is disabled on this platform.", {
        platform: process.platform,
        projectId,
      })
      return undefined
    }
    if (!config.user) {
      throw new Error("run_as_user is enabled but no target user is configured")
    }
    if (config.requirePreflight && config.lastPreflightStatus !== "pass") {
      throw new Error("run_as_user preflight has not passed")
    }
    return {
      kind: "run_as_user",
      user: config.user,
      envAllowlist: normalizeAllowlist([
        ...config.envAllowlist,
        ...SIDE_CHANNEL_ENV_ALLOWLIST,
        ...extraEnvAllowlist,
      ]),
    }
  }

  async preflight(projectId: string, workspacePath?: string): Promise<RunAsCheckResult> {
    const config = await this.getOrCreateConfig(projectId)
    const user = config.user?.trim()
    if (!user) {
      return this.recordCheck(projectId, "", workspacePath, "fail", {
        error: "run_as_user target user is not configured",
      })
    }
    if (process.platform === "win32") {
      return this.recordCheck(projectId, user, workspacePath, "unsupported", {
        error: "run_as_user is not supported on Windows",
      })
    }

    const checks: Record<string, unknown> = {}
    try {
      const sudoCheck = await this.deps.processRunner.run({
        actor: { kind: "user" },
        action: "shell.exec",
        command: "sudo",
        args: ["-n", "-iu", user, "--", "/bin/true"],
        timeoutMs: 30_000,
        output: { stdout: "buffer", stderr: "buffer" },
        metadata: { projectId, source: "run_as.preflight", check: "sudo_to_target" },
      })
      checks.sudoToTarget = sudoCheck.exitCode === 0
      if (sudoCheck.exitCode !== 0) {
        throw new Error(sudoCheck.stderr?.trim() || "passwordless sudo to target user failed")
      }

      const targetSudoCheck = await this.deps.processRunner.run({
        actor: { kind: "user" },
        action: "shell.exec",
        command: "sudo",
        args: ["-n", "-iu", user, "--", "sudo", "-n", "/bin/true"],
        timeoutMs: 30_000,
        output: { stdout: "buffer", stderr: "buffer" },
        metadata: { projectId, source: "run_as.preflight", check: "target_cannot_sudo" },
      })
      checks.targetCannotSudo = targetSudoCheck.exitCode !== 0
      if (targetSudoCheck.exitCode === 0) {
        throw new Error("target user can run passwordless sudo")
      }

      if (workspacePath) {
        const workspaceCheck = await this.deps.processRunner.run({
          actor: { kind: "user" },
          action: "shell.exec",
          command: "sudo",
          args: [
            "-n",
            "-iu",
            user,
            "--",
            "/bin/sh",
            "-lc",
            "test -d \"$1\" && test -r \"$1\" && test -w \"$1\" && test -x \"$1\"",
            "sh",
            workspacePath,
          ],
          timeoutMs: 30_000,
          output: { stdout: "buffer", stderr: "buffer" },
          metadata: { projectId, source: "run_as.preflight", check: "workspace_access" },
        })
        checks.workspaceAccess = workspaceCheck.exitCode === 0
        if (workspaceCheck.exitCode !== 0) {
          throw new Error(workspaceCheck.stderr?.trim() || "target user cannot read/write workspace")
        }
      }

      return this.recordCheck(projectId, user, workspacePath, "pass", { checks })
    } catch (error) {
      return this.recordCheck(projectId, user, workspacePath, "fail", {
        checks,
        error: errorMessage(error),
      })
    }
  }

  async auditProbe(projectId: string, workspacePath?: string): Promise<RunAsCheckResult> {
    const config = await this.getOrCreateConfig(projectId)
    const user = config.user?.trim()
    if (!user) {
      return this.recordProbe(projectId, "", workspacePath, "fail", {
        error: "run_as_user target user is not configured",
      })
    }
    if (process.platform === "win32") {
      return this.recordProbe(projectId, user, workspacePath, "unsupported", {
        error: "run_as_user is not supported on Windows",
      })
    }

    try {
      const script = [
        "printf 'effectiveUser='",
        "id -un",
        "printf 'effectiveUid='",
        "id -u",
        "printf 'effectiveGid='",
        "id -g",
        "printf 'workspaceReadable='",
        "test -r \"$1\" && echo yes || echo no",
        "printf 'workspaceWritable='",
        "test -w \"$1\" && echo yes || echo no",
        "printf 'envKeys='",
        "env | cut -d= -f1 | sort | paste -sd, -",
      ].join("\n")
      const result = await this.deps.processRunner.run({
        actor: { kind: "user" },
        action: "shell.exec",
        command: "sudo",
        args: [
          "-n",
          "-iu",
          user,
          `--preserve-env=${normalizeAllowlist(config.envAllowlist).join(",")}`,
          "--",
          "/bin/sh",
          "-lc",
          script,
          "sh",
          workspacePath ?? ".",
        ],
        timeoutMs: 30_000,
        output: { stdout: "buffer", stderr: "buffer" },
        metadata: { projectId, source: "run_as.audit_probe" },
      })
      if (result.exitCode !== 0) {
        throw new Error(result.stderr?.trim() || result.error || "run_as audit probe failed")
      }
      return this.recordProbe(projectId, user, workspacePath, "pass", {
        checks: parseProbeOutput(result.stdout ?? ""),
      })
    } catch (error) {
      return this.recordProbe(projectId, user, workspacePath, "fail", {
        error: errorMessage(error),
      })
    }
  }

  private async getOrCreateConfig(projectId: string): Promise<RunAsConfigEntryV1> {
    const id = configId(projectId)
    const existing = await this.deps.configs.get(id)
    if (existing) return existing
    const now = this.isoNow()
    const entry: RunAsConfigEntryV1 = {
      id,
      schemaVersion: 1,
      projectId,
      enabled: false,
      envAllowlist: DEFAULT_RUN_AS_ENV_ALLOWLIST,
      requirePreflight: true,
      createdAt: now,
      updatedAt: now,
    }
    await this.deps.configs.upsert(entry)
    return entry
  }

  private async recordCheck(
    projectId: string,
    user: string,
    workspacePath: string | undefined,
    status: RunAsCheckResult["status"],
    details: {
      readonly checks?: Record<string, unknown>
      readonly warnings?: readonly string[]
      readonly error?: string
    },
  ): Promise<RunAsCheckResult> {
    return this.recordRunAsCheck("preflight", projectId, user, workspacePath, status, details)
  }

  private async recordProbe(
    projectId: string,
    user: string,
    workspacePath: string | undefined,
    status: RunAsCheckResult["status"],
    details: {
      readonly checks?: Record<string, unknown>
      readonly warnings?: readonly string[]
      readonly error?: string
    },
  ): Promise<RunAsCheckResult> {
    return this.recordRunAsCheck("audit_probe", projectId, user, workspacePath, status, details)
  }

  private async recordRunAsCheck(
    kind: "preflight" | "audit_probe",
    projectId: string,
    user: string,
    workspacePath: string | undefined,
    status: RunAsCheckResult["status"],
    details: {
      readonly checks?: Record<string, unknown>
      readonly warnings?: readonly string[]
      readonly error?: string
    },
  ): Promise<RunAsCheckResult> {
    const now = this.isoNow()
    const entry: RunAsPreflightEntryV1 = {
      id: `run-as:${kind}:${randomUUID()}`,
      schemaVersion: 1,
      projectId,
      user,
      status,
      workspacePath,
      checks: details.checks,
      warnings: details.warnings ? [...details.warnings] : undefined,
      error: details.error,
      createdAt: now,
      updatedAt: now,
    }
    await this.deps.preflights.upsert(entry)
    const config = await this.getOrCreateConfig(projectId)
    const next: RunAsConfigEntryV1 = {
      ...config,
      lastError: details.error,
      lastPreflightAt: kind === "preflight" ? now : config.lastPreflightAt,
      lastPreflightStatus: kind === "preflight" ? status : config.lastPreflightStatus,
      lastAuditProbeAt: kind === "audit_probe" ? now : config.lastAuditProbeAt,
      lastAuditProbeStatus: kind === "audit_probe" ? status : config.lastAuditProbeStatus,
      updatedAt: now,
    }
    await this.deps.configs.upsert(next)
    this.deps.auditSink?.record({
      action: "shell.exec",
      actor: { kind: "user" },
      resource: `run_as_user:${kind}`,
      outcome: status === "pass" ? "allowed" : status === "unsupported" ? "denied" : "failed",
      metadata: {
        projectId,
        user,
        workspacePath,
        checks: details.checks,
        warnings: details.warnings,
        error: details.error,
      },
    })
    return {
      projectId,
      user,
      status,
      workspacePath,
      checks: details.checks,
      warnings: details.warnings,
      error: details.error,
      createdAt: now,
    }
  }

  private isoNow(): string {
    return (this.deps.now?.() ?? new Date()).toISOString()
  }
}

function configId(projectId: string): string {
  return `run-as:${projectId}`
}

function toView(entry: RunAsConfigEntryV1): RunAsConfigView {
  const supported = isRunAsUserSupported()
  return {
    projectId: entry.projectId,
    enabled: supported ? entry.enabled : false,
    supported,
    unsupportedReason: supported ? undefined : "run_as_user is not supported on Windows",
    user: entry.user,
    envAllowlist: entry.envAllowlist,
    requirePreflight: entry.requirePreflight,
    lastPreflightAt: entry.lastPreflightAt,
    lastPreflightStatus: entry.lastPreflightStatus,
    lastAuditProbeAt: entry.lastAuditProbeAt,
    lastAuditProbeStatus: entry.lastAuditProbeStatus,
    lastError: entry.lastError,
  }
}

function isRunAsUserSupported(): boolean {
  return process.platform !== "win32"
}

function normalizeAllowlist(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false
  return left.every((value, index) => value === right[index])
}

function parseProbeOutput(output: string): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const line of output.split(/\r?\n/)) {
    const index = line.indexOf("=")
    if (index <= 0) continue
    result[line.slice(0, index)] = line.slice(index + 1)
  }
  return result
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
