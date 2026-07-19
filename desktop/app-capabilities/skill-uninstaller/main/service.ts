import { shell } from "electron"
import { lstat, realpath } from "node:fs/promises"
import path from "node:path"

import type { ActorIdentity, AuditSink, PermissionGuard } from "../../../electron/runtime/security"
import {
  inferProjectSkillEditors,
  isPathEqualOrInside,
  listGlobalTrustedSkillRoots,
} from "../../../electron/services/editor-scan-roots"
import { createMainLogger } from "../../../electron/services/log-store"
import type {
  SkillUninstallBatchResult,
  SkillUninstallNameScanResult,
  SkillUninstallQuery,
  SkillUninstallScanResult,
  SkillUninstallTarget,
} from "../shared/schema"
import { isSkillTargetDiscoverable, scanSkillNames, scanSkillRoots } from "./scanner"
import { readSynapseContentId } from "./synapse-metadata"

const logger = createMainLogger("app.skill-uninstaller")
const SEARCH_ROOT_ERROR = "搜索目录不存在或无法读取。"
const TARGET_CHANGED_ERROR = "目标已发生变化，已跳过。"
const TARGET_OUTSIDE_ERROR = "目标不在本次扫描范围内，已跳过。"
const WRITE_DENIED_ERROR = "没有写入该位置的权限。"
const TRASH_FAILED_ERROR = "移到废纸篓失败。"
const STATUS_REFRESH_WARNING = "已移到废纸篓，安装状态刷新失败。"

export type SkillUninstallerSecurity = {
  readonly actor: ActorIdentity
  readonly auditSink: AuditSink
  readonly permissionGuard: PermissionGuard
}

export type SkillUninstallerHooks = {
  readonly onTrashedContentId?: (contentId: string) => Promise<void>
}

export type SkillUninstallerServiceDeps = {
  readonly trashItem: (targetPath: string) => Promise<void>
}

type RevalidatedTarget = {
  readonly path: string
  readonly synapseContentId?: string
}

async function resolveAllowedRoots(query: SkillUninstallQuery): Promise<string[]> {
  if (query.searchRootPath) return [await realpath(query.searchRootPath)]
  const roots = await listGlobalTrustedSkillRoots()
  const resolved = await Promise.all(roots.map(async (root) => {
    try {
      return await realpath(root.path)
    } catch {
      return undefined
    }
  }))
  return resolved.filter((root): root is string => root !== undefined)
}

async function revalidateTarget(target: SkillUninstallTarget): Promise<RevalidatedTarget> {
  let targetStats
  let skillStats
  try {
    targetStats = await lstat(target.path)
    skillStats = await lstat(path.join(target.path, "SKILL.md"))
  } catch {
    throw new Error(TARGET_CHANGED_ERROR)
  }

  if (
    targetStats.isSymbolicLink()
    || !targetStats.isDirectory()
    || skillStats.isSymbolicLink()
    || !skillStats.isFile()
  ) {
    throw new Error(TARGET_CHANGED_ERROR)
  }

  let targetRealPath: string
  let roots: string[]
  try {
    [targetRealPath, roots] = await Promise.all([
      realpath(target.path),
      resolveAllowedRoots(target.query),
    ])
  } catch {
    throw new Error(TARGET_CHANGED_ERROR)
  }

  if (!roots.some((root) => isPathEqualOrInside(root, targetRealPath))) {
    throw new Error(TARGET_OUTSIDE_ERROR)
  }
  try {
    if (!await isSkillTargetDiscoverable({
      query: target.query,
      roots,
      targetPath: target.path,
    })) {
      throw new Error(TARGET_CHANGED_ERROR)
    }
  } catch {
    throw new Error(TARGET_CHANGED_ERROR)
  }

  const metadata = await readSynapseContentId(targetRealPath)
  return {
    path: target.path,
    ...(metadata.status === "readable" && metadata.contentId
      ? { synapseContentId: metadata.contentId }
      : {}),
  }
}

function recordAudit(
  security: SkillUninstallerSecurity,
  action: "fs.read.outside-userdata" | "fs.write",
  resource: string,
  outcome: "allowed" | "denied" | "failed",
  operation: string,
): void {
  security.auditSink.record({
    action,
    actor: security.actor,
    metadata: { operation },
    outcome,
    resource,
  })
}

async function scanCustomRoot<T>(
  resource: string,
  security: SkillUninstallerSecurity,
  operation: "skill-uninstall-scan" | "skill-uninstall-name-scan",
  scan: (rootPath: string) => Promise<T>,
): Promise<T> {
  let permissionDenied = false
  try {
    const permission = await security.permissionGuard.check({
      action: "fs.read.outside-userdata",
      actor: security.actor,
      context: { operation },
      resource,
    })
    if (!permission.allowed) {
      permissionDenied = true
      recordAudit(security, "fs.read.outside-userdata", resource, "denied", operation)
      throw new Error(SEARCH_ROOT_ERROR)
    }

    const stats = await lstat(resource)
    if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error(SEARCH_ROOT_ERROR)
    const result = await scan(await realpath(resource))
    recordAudit(security, "fs.read.outside-userdata", resource, "allowed", operation)
    return result
  } catch (error) {
    if (!permissionDenied) {
      recordAudit(security, "fs.read.outside-userdata", resource, "failed", operation)
    }
    throw new Error(SEARCH_ROOT_ERROR, { cause: error })
  }
}

export class SkillUninstallerService {
  constructor(private readonly deps: SkillUninstallerServiceDeps = {
    trashItem: (targetPath) => shell.trashItem(targetPath),
  }) {}

  async scan(
    query: SkillUninstallQuery,
    security: SkillUninstallerSecurity,
    signal?: AbortSignal,
  ): Promise<SkillUninstallScanResult> {
    if (query.searchRootPath) {
      return scanCustomRoot(query.searchRootPath, security, "skill-uninstall-scan", async (rootPath) => (
        scanSkillRoots({
          query,
          roots: [{ path: rootPath, editorIds: [] }],
          classifyEditors: (candidatePath) => inferProjectSkillEditors(candidatePath, rootPath),
          signal,
          rootErrorsFatal: true,
        })
      ))
    }

    const roots = await listGlobalTrustedSkillRoots()
    return scanSkillRoots({
      query,
      roots: roots.map((root) => ({
        path: root.path,
        editorIds: root.editors.map((editor) => editor.id),
      })),
      classifyEditors: () => [],
      signal,
    })
  }

  async scanNames(
    searchRootPath: string | undefined,
    security: SkillUninstallerSecurity,
    signal?: AbortSignal,
  ): Promise<SkillUninstallNameScanResult> {
    if (searchRootPath) {
      return scanCustomRoot(searchRootPath, security, "skill-uninstall-name-scan", async (rootPath) => (
        scanSkillNames({
          roots: [{ path: rootPath, editorIds: [] }],
          signal,
          rootErrorsFatal: true,
        })
      ))
    }

    const roots = await listGlobalTrustedSkillRoots()
    return scanSkillNames({
      roots: roots.map((root) => ({
        path: root.path,
        editorIds: root.editors.map((editor) => editor.id),
      })),
      signal,
    })
  }

  async uninstall(
    targets: readonly SkillUninstallTarget[],
    security: SkillUninstallerSecurity,
    hooks: SkillUninstallerHooks = {},
    signal?: AbortSignal,
  ): Promise<SkillUninstallBatchResult> {
    const results: SkillUninstallBatchResult["results"] = []

    for (const target of targets) {
      if (signal?.aborted) break
      const metadata = { operation: "skill-uninstall" }
      let permission
      try {
        permission = await security.permissionGuard.check({
          action: "fs.write",
          actor: security.actor,
          context: metadata,
          resource: target.path,
        })
      } catch {
        recordAudit(security, "fs.write", target.path, "failed", "skill-uninstall")
        results.push({ path: target.path, status: "failed", error: WRITE_DENIED_ERROR })
        continue
      }
      if (!permission.allowed) {
        recordAudit(security, "fs.write", target.path, "denied", "skill-uninstall")
        results.push({ path: target.path, status: "failed", error: WRITE_DENIED_ERROR })
        continue
      }

      let revalidated: RevalidatedTarget
      try {
        revalidated = await revalidateTarget(target)
      } catch (error) {
        recordAudit(security, "fs.write", target.path, "failed", "skill-uninstall")
        results.push({
          path: target.path,
          status: "skipped",
          error: error instanceof Error && error.message === TARGET_OUTSIDE_ERROR
            ? TARGET_OUTSIDE_ERROR
            : TARGET_CHANGED_ERROR,
        })
        continue
      }

      try {
        await this.deps.trashItem(revalidated.path)
        recordAudit(security, "fs.write", target.path, "allowed", "skill-uninstall")
        results.push({ path: target.path, status: "trashed" })
      } catch {
        recordAudit(security, "fs.write", target.path, "failed", "skill-uninstall")
        results.push({ path: target.path, status: "failed", error: TRASH_FAILED_ERROR })
        continue
      }

      if (revalidated.synapseContentId && hooks.onTrashedContentId) {
        try {
          await hooks.onTrashedContentId(revalidated.synapseContentId)
        } catch (error) {
          logger.warn("Failed to refresh install status after trashing Skill.", { error })
          const result = results.at(-1)
          if (result?.path === target.path && result.status === "trashed") {
            result.warning = STATUS_REFRESH_WARNING
          }
        }
      }
    }

    return {
      results,
      ...(signal?.aborted ? { cancelled: true } : {}),
    }
  }
}

export const skillUninstallerService = new SkillUninstallerService()
