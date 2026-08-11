import path from "node:path"
import { rm } from "node:fs/promises"

import type {
  DataNamespace,
  PendingUpdateInstallAttemptV1,
  UpdateInstallRecoveryEntryV1,
} from "../runtime/data-repo"
import type { AuditSink, PermissionGuard } from "../runtime/security"
import type { ControlledProcessRunner } from "../runtime/process"
import { createMainLogger } from "./log-store"

const SHIPIT_SERVICE_LABEL = "com.fairyever.synapse.ShipIt"
const UPDATE_CACHE_DIRECTORY_NAME = "@synapsedesktop-updater"
const SHIPIT_CACHE_DIRECTORY_NAME = SHIPIT_SERVICE_LABEL
const UPDATE_RECOVERY_SOURCE = "desktop.update-install.recovery"
const recoveryActor = { kind: "user" } as const
const logger = createMainLogger("update-install-recovery")

type RemovePath = (targetPath: string) => Promise<void>

export type UpdateInstallRecoveryDecision =
  | { readonly kind: "none" }
  | {
      readonly kind: "recover"
      readonly manualInstallerUrl: string | null
      readonly targetVersion: string
    }
  | {
      readonly kind: "resume"
      readonly manualInstallerUrl: string | null
      readonly targetVersion: string
    }
  | {
      readonly kind: "manual"
      readonly manualInstallerUrl: string | null
      readonly targetVersion: string
    }

type UpdateInstallRecoveryServiceDeps = {
  readonly auditSink: AuditSink
  readonly cacheDirectory: string
  readonly getUid: () => number | undefined
  readonly permissionGuard: PermissionGuard
  readonly processRunner: ControlledProcessRunner
  readonly removePath?: RemovePath
  readonly stateStore: DataNamespace<UpdateInstallRecoveryEntryV1>
}

export class UpdateInstallRecoveryService {
  private readonly auditSink: AuditSink
  private readonly cacheDirectory: string
  private readonly getUid: () => number | undefined
  private readonly permissionGuard: PermissionGuard
  private readonly processRunner: ControlledProcessRunner
  private readonly removePath: RemovePath
  private readonly stateStore: DataNamespace<UpdateInstallRecoveryEntryV1>

  constructor(deps: UpdateInstallRecoveryServiceDeps) {
    this.auditSink = deps.auditSink
    this.cacheDirectory = path.resolve(deps.cacheDirectory)
    this.getUid = deps.getUid
    this.permissionGuard = deps.permissionGuard
    this.processRunner = deps.processRunner
    this.removePath = deps.removePath ?? ((targetPath) => rm(targetPath, { force: true, recursive: true }))
    this.stateStore = deps.stateStore
  }

  async recordInstallAttempt(
    targetVersion: string,
    manualInstallerUrl: string | null,
  ): Promise<UpdateInstallRecoveryEntryV1> {
    const previous = await this.readState()
    const pending = previous.pendingAttempt
    const isRecoveredRetry = pending?.installAttempts === 1 && pending.recoveryPhase === "prepared"
    await this.writeAttempt({
      attemptedAt: new Date().toISOString(),
      installAttempts: isRecoveredRetry ? 2 : 1,
      manualInstallerUrl: manualInstallerUrl ?? pending?.manualInstallerUrl ?? null,
      recoveryPhase: isRecoveredRetry ? "prepared" : "not-started",
      targetVersion,
    })
    return previous
  }

  async restoreState(state: UpdateInstallRecoveryEntryV1): Promise<void> {
    await this.stateStore.setSingleton(state)
  }

  async reconcile(currentVersion: string): Promise<UpdateInstallRecoveryDecision> {
    const state = await this.readState()
    const pending = state.pendingAttempt
    if (!pending) return { kind: "none" }

    if (isVersionAtLeast(currentVersion, pending.targetVersion)) {
      await this.clearPendingAttempt()
      return { kind: "none" }
    }

    if (
      pending.installAttempts === 2
      || pending.recoveryPhase === "preparing"
      || pending.recoveryPhase === "manual-required"
    ) {
      return this.enterManualRecovery(pending)
    }

    if (pending.recoveryPhase === "prepared") {
      return decisionFromAttempt("resume", pending)
    }

    await this.writeAttempt({ ...pending, recoveryPhase: "preparing" })
    try {
      await this.resetMacUpdaterState()
      const prepared = { ...pending, recoveryPhase: "prepared" as const }
      await this.writeAttempt(prepared)
      return decisionFromAttempt("recover", prepared)
    } catch (error) {
      logger.error("Failed to repair the macOS update installer state.", error)
      return this.enterManualRecovery(pending)
    }
  }

  async updatePreparedTarget(targetVersion: string, manualInstallerUrl: string | null): Promise<void> {
    const state = await this.readState()
    const pending = state.pendingAttempt
    if (!pending || pending.installAttempts !== 1 || pending.recoveryPhase !== "prepared") return
    await this.writeAttempt({
      ...pending,
      manualInstallerUrl: manualInstallerUrl ?? pending.manualInstallerUrl,
      targetVersion,
    })
  }

  async markManualRequired(): Promise<UpdateInstallRecoveryDecision> {
    const state = await this.readState()
    if (!state.pendingAttempt) return { kind: "none" }
    return this.enterManualRecovery(state.pendingAttempt)
  }

  private async enterManualRecovery(
    attempt: PendingUpdateInstallAttemptV1,
  ): Promise<UpdateInstallRecoveryDecision> {
    const manualAttempt = { ...attempt, recoveryPhase: "manual-required" as const }
    await this.writeAttempt(manualAttempt)
    return decisionFromAttempt("manual", manualAttempt)
  }

  private async resetMacUpdaterState(): Promise<void> {
    const uid = this.getUid()
    if (uid === undefined) {
      throw new Error("Current user id is unavailable.")
    }

    const launchctlResult = await this.processRunner.run({
      action: "shell.exec",
      actor: recoveryActor,
      args: ["bootout", `gui/${String(uid)}/${SHIPIT_SERVICE_LABEL}`],
      command: "/bin/launchctl",
      metadata: { source: UPDATE_RECOVERY_SOURCE },
      output: { stderr: "buffer", stdout: "ignore" },
      timeoutMs: 10_000,
    })
    if (
      launchctlResult.exitCode !== 0
      && !isMissingLaunchServiceError(launchctlResult.stderr)
    ) {
      throw new Error("Unable to unload the stale ShipIt launch service.")
    }

    await this.removeCacheDirectory(UPDATE_CACHE_DIRECTORY_NAME)
    await this.removeCacheDirectory(SHIPIT_CACHE_DIRECTORY_NAME)
  }

  private async removeCacheDirectory(directoryName: string): Promise<void> {
    const targetPath = path.resolve(this.cacheDirectory, directoryName)
    if (path.dirname(targetPath) !== this.cacheDirectory || path.basename(targetPath) !== directoryName) {
      throw new Error("Invalid updater cache path.")
    }

    const context = {
      operation: "remove-update-cache",
      source: UPDATE_RECOVERY_SOURCE,
    }
    const permission = await this.permissionGuard.check({
      action: "fs.write.outside-userdata",
      actor: recoveryActor,
      context,
      resource: targetPath,
    })
    if (!permission.allowed) {
      this.auditSink.record({
        action: "fs.write.outside-userdata",
        actor: recoveryActor,
        metadata: {
          ...context,
          policyId: permission.policyId,
          reason: permission.reason,
        },
        outcome: "denied",
        resource: targetPath,
      })
      throw new Error(permission.reason)
    }

    try {
      await this.removePath(targetPath)
      this.auditSink.record({
        action: "fs.write.outside-userdata",
        actor: recoveryActor,
        metadata: context,
        outcome: "allowed",
        resource: targetPath,
      })
    } catch (error) {
      this.auditSink.record({
        action: "fs.write.outside-userdata",
        actor: recoveryActor,
        metadata: {
          ...context,
          errorName: error instanceof Error ? error.name : typeof error,
        },
        outcome: "failed",
        resource: targetPath,
      })
      throw error
    }
  }

  private async readState(): Promise<UpdateInstallRecoveryEntryV1> {
    return await this.stateStore.getSingleton() ?? {
      schemaVersion: 1,
      pendingAttempt: null,
    }
  }

  private async clearPendingAttempt(): Promise<void> {
    await this.stateStore.setSingleton({
      schemaVersion: 1,
      pendingAttempt: null,
    })
  }

  private async writeAttempt(pendingAttempt: PendingUpdateInstallAttemptV1): Promise<void> {
    await this.stateStore.setSingleton({
      schemaVersion: 1,
      pendingAttempt,
    })
  }
}

function decisionFromAttempt(
  kind: "recover" | "resume" | "manual",
  attempt: PendingUpdateInstallAttemptV1,
): UpdateInstallRecoveryDecision {
  return {
    kind,
    manualInstallerUrl: attempt.manualInstallerUrl,
    targetVersion: attempt.targetVersion,
  }
}

function isMissingLaunchServiceError(stderr: string | undefined): boolean {
  return stderr?.includes("Could not find service") === true
    || stderr?.includes("No such process") === true
}

function isVersionAtLeast(currentVersion: string, targetVersion: string): boolean {
  if (currentVersion === targetVersion) return true
  const current = parseVersion(currentVersion)
  const target = parseVersion(targetVersion)
  if (!current || !target) return false

  const length = Math.max(current.length, target.length)
  for (let index = 0; index < length; index++) {
    const currentPart = current[index] ?? 0
    const targetPart = target[index] ?? 0
    if (currentPart !== targetPart) return currentPart > targetPart
  }
  return true
}

function parseVersion(version: string): number[] | null {
  const core = version.trim().replace(/^v/, "").split("-", 1)[0]
  if (!core || !/^\d+(?:\.\d+)*$/.test(core)) return null
  return core.split(".").map(Number)
}
