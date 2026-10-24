import type { StructuredLogger } from "../runtime/service-registry"
import type { AuditSink, PermissionGuard } from "../runtime/security"
import { constants } from "node:fs"
import { randomUUID } from "node:crypto"
import { lstat, open, readdir } from "node:fs/promises"
import path from "node:path"
import { findSkillDirectoryByContentId, readSkillIdFile } from "./editor-adapters/skill-identity"
import { hasSameFileSnapshot, isFileNotFoundError, readFileHandleUpTo } from "./fs-utils"
import { errorLogCode } from "./error-sanitize"
import { parseInstallStagingName } from "./editor-install-staging-name"

const LEGACY_STAGING_AGE_MS = 24 * 60 * 60 * 1000
const ACTOR = { kind: "system", id: "editor-install-staging-recovery" } as const

function processIsGone(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return false
  } catch (error) {
    // EPERM and PID reuse are conservative skips, never reasons to remove data.
    return errorLogCode(error) === "ESRCH"
  }
}

async function ownerProcessIsGone(markerPath: string): Promise<boolean | null> {
  let expected
  try {
    expected = await lstat(markerPath, { bigint: true })
  } catch (error) {
    if (isFileNotFoundError(error)) return null
    throw error
  }
  // An invalid or replaced marker is not evidence that a process is dead.
  if (!expected.isFile() || expected.isSymbolicLink() || expected.size > 4096n) return false
  const handle = await open(markerPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    if (!hasSameFileSnapshot(expected, await handle.stat({ bigint: true }))) return false
    const bytes = await readFileHandleUpTo(handle, 4097)
    if (bytes.byteLength > 4096 || !hasSameFileSnapshot(expected, await handle.stat({ bigint: true }))
      || !hasSameFileSnapshot(expected, await lstat(markerPath, { bigint: true }))) return false
    let marker: { version?: unknown; ownerPid?: unknown; targetName?: unknown }
    try {
      marker = JSON.parse(bytes.toString("utf8"))
    } catch {
      return false
    }
    if (!marker || marker.version !== 1 || !Number.isSafeInteger(marker.ownerPid)
      || (marker.ownerPid as number) <= 0 || typeof marker.targetName !== "string"
      || !marker.targetName || path.basename(marker.targetName) !== marker.targetName
      || marker.targetName === "." || marker.targetName === "..") return false
    return processIsGone(marker.ownerPid as number)
  } finally {
    await handle.close()
  }
}

export interface EditorInstallStagingRecoveryDeps {
  listSkillDirectories(): Promise<readonly string[]>
  trashItem(directoryPath: string): Promise<void>
  permissionGuard: PermissionGuard
  auditSink: AuditSink
  logger: Pick<StructuredLogger, "info" | "warn">
}

export class EditorInstallStagingRecovery {
  private readonly roots = new Set<string>()
  private readonly unregisterPolicy: () => void

  constructor(private readonly deps: EditorInstallStagingRecoveryDeps) {
    this.unregisterPolicy = deps.permissionGuard.registerPolicy({
      id: `editor-install-staging-recovery-${randomUUID()}`,
      decide: request => {
        if (request.actor.kind !== "system" || request.actor.id !== ACTOR.id) return "defer-to-next"
        const resource = path.resolve(request.resource)
        if (request.action === "fs.read.outside-userdata" && this.roots.has(resource)) return "allow"
        if ((request.action === "fs.read.outside-userdata" || request.action === "fs.write.outside-userdata")
          && this.roots.has(path.dirname(resource)) && parseInstallStagingName(path.basename(resource))) return "allow"
        return "defer-to-next"
      },
    })
  }

  async recover(): Promise<void> {
    const directories = await this.deps.listSkillDirectories()
    this.roots.clear()
    for (const directory of directories) this.roots.add(path.resolve(directory))
    for (const root of this.roots) {
      try {
        await this.inspectRoot(root)
      } catch (error) {
        if (!isFileNotFoundError(error)) this.deps.logger.warn("Skill staging recovery could not inspect a directory.", {
          errorCode: errorLogCode(error) ?? "unknown",
        })
      }
    }
  }

  stop(): void {
    this.unregisterPolicy()
  }

  private async allowed(action: "fs.read.outside-userdata" | "fs.write.outside-userdata", resource: string): Promise<boolean> {
    const decision = await this.deps.permissionGuard.check({ action, actor: ACTOR, resource, context: { operation: "recover-install-staging" } })
    if (!decision.allowed) this.deps.auditSink.record({ action, actor: ACTOR, resource, outcome: "denied", metadata: { operation: "recover-install-staging" } })
    return decision.allowed
  }

  private async isAbandoned(directory: string): Promise<boolean> {
    const name = parseInstallStagingName(path.basename(directory))
    if (!name) return false
    if (name.ownerPid !== null) return processIsGone(name.ownerPid)
    const ownerGone = await ownerProcessIsGone(path.join(directory, "transaction.json"))
    if (ownerGone !== null) return ownerGone
    // Legacy staging has no owner marker. Never guess from its name alone.
    const snapshot = await lstat(directory)
    if (Date.now() - snapshot.mtimeMs < LEGACY_STAGING_AGE_MS) return false
    const entries = await readdir(directory)
    if (entries.length === 0) return true // Killed between mkdtemp and marker creation.
    const id = await readSkillIdFile(directory)
    return id !== null && await findSkillDirectoryByContentId(path.dirname(directory), id) !== null
  }

  private async inspectRoot(root: string): Promise<void> {
    if (!await this.allowed("fs.read.outside-userdata", root)) return
    const entries = await readdir(root, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory() || !parseInstallStagingName(entry.name)) continue
      const directory = path.join(root, entry.name)
      try {
        if (!await this.allowed("fs.read.outside-userdata", directory)) continue
        const before = await lstat(directory, { bigint: true })
        if (before.isSymbolicLink() || !before.isDirectory() || !await this.isAbandoned(directory)) continue
        if (!await this.allowed("fs.write.outside-userdata", directory)) continue
        // Permissions may await user/policy work; recheck ownership and the entry.
        if (!await this.isAbandoned(directory)
          || !hasSameFileSnapshot(before, await lstat(directory, { bigint: true }))) continue
        try {
          await this.deps.trashItem(directory)
        } catch (error) {
          this.deps.auditSink.record({ action: "fs.write.outside-userdata", actor: ACTOR, resource: directory, outcome: "failed", metadata: { operation: "recover-install-staging" } })
          throw error
        }
        this.deps.auditSink.record({ action: "fs.write.outside-userdata", actor: ACTOR, resource: directory, outcome: "allowed", metadata: { operation: "recover-install-staging" } })
        this.deps.logger.info("Recovered abandoned Skill installation staging.", { stagingName: entry.name })
      } catch (error) {
        if (!isFileNotFoundError(error)) this.deps.logger.warn("Skill installation staging was retained for retry.", {
          stagingName: entry.name, errorCode: errorLogCode(error) ?? "unknown",
        })
      }
    }
  }
}
