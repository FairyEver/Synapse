import { shell } from "electron"
import { lstat, readFile, realpath } from "node:fs/promises"
import path from "node:path"

import type { ActorIdentity, AuditSink, PermissionGuard } from "../../../electron/runtime/security"
import {
  inferProjectSkillEditors,
  isPathEqualOrInside,
  listGlobalTrustedSkillRoots,
} from "../../../electron/services/editor-scan-roots"
import { createMainLogger } from "../../../electron/services/log-store"
import { parseFrontmatterBlock } from "../../../src/definitions/editor/shared-yaml-scalar"
import type {
  SkillUninstallBatchResult,
  SkillUninstallQuery,
  SkillUninstallScanResult,
  SkillUninstallTarget,
} from "../shared/schema"
import { scanSkillRoots } from "./scanner"

const logger = createMainLogger("app.skill-uninstaller")
const SEARCH_ROOT_ERROR = "搜索目录不存在或无法读取。"
const TARGET_CHANGED_ERROR = "目标已发生变化，已跳过。"
const TARGET_OUTSIDE_ERROR = "目标不在本次扫描范围内，已跳过。"
const WRITE_DENIED_ERROR = "没有写入该位置的权限。"
const TRASH_FAILED_ERROR = "移到废纸篓失败。"

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

function normalizeName(value: string): string {
  return value.trim().toLowerCase()
}

function readFrontmatterName(content: string): string | undefined {
  if (!content.startsWith("---")) return undefined
  const end = content.indexOf("\n---", 3)
  if (end < 0) return undefined
  return parseFrontmatterBlock(content.slice(4, end)).metadata.name?.trim() || undefined
}

function matchesQueryName(targetPath: string, content: string, queryName: string): boolean {
  const expected = normalizeName(queryName)
  const frontmatterName = readFrontmatterName(content)
  return normalizeName(path.basename(targetPath)) === expected
    || (frontmatterName !== undefined && normalizeName(frontmatterName) === expected)
}

async function readSynapseContentId(targetPath: string): Promise<string | undefined> {
  const metadataPath = path.join(targetPath, ".synapse.json")
  try {
    const stats = await lstat(metadataPath)
    if (!stats.isFile() || stats.isSymbolicLink()) return undefined
    const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as { id?: unknown }
    return typeof metadata.id === "string" && metadata.id.trim()
      ? metadata.id.trim()
      : undefined
  } catch {
    return undefined
  }
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
  let skillRealPath: string
  let roots: string[]
  try {
    [targetRealPath, skillRealPath, roots] = await Promise.all([
      realpath(target.path),
      realpath(path.join(target.path, "SKILL.md")),
      resolveAllowedRoots(target.query),
    ])
  } catch {
    throw new Error(TARGET_CHANGED_ERROR)
  }

  if (!roots.some((root) => isPathEqualOrInside(root, targetRealPath))) {
    throw new Error(TARGET_OUTSIDE_ERROR)
  }
  if (!isPathEqualOrInside(targetRealPath, skillRealPath)) {
    throw new Error(TARGET_CHANGED_ERROR)
  }

  let content: string
  try {
    content = await readFile(skillRealPath, "utf8")
  } catch {
    throw new Error(TARGET_CHANGED_ERROR)
  }
  if (!matchesQueryName(targetRealPath, content, target.query.name)) {
    throw new Error(TARGET_CHANGED_ERROR)
  }

  return {
    path: target.path,
    synapseContentId: await readSynapseContentId(targetRealPath),
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
      const resource = query.searchRootPath
      let permissionDenied = false
      try {
        const permission = await security.permissionGuard.check({
          action: "fs.read.outside-userdata",
          actor: security.actor,
          context: { operation: "skill-uninstall-scan" },
          resource,
        })
        if (!permission.allowed) {
          permissionDenied = true
          recordAudit(security, "fs.read.outside-userdata", resource, "denied", "skill-uninstall-scan")
          throw new Error(SEARCH_ROOT_ERROR)
        }

        const stats = await lstat(resource)
        if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error(SEARCH_ROOT_ERROR)
        const rootPath = await realpath(resource)
        const result = await scanSkillRoots({
          query,
          roots: [{ path: rootPath, editorIds: [] }],
          classifyEditors: (candidatePath) => inferProjectSkillEditors(candidatePath, rootPath),
          signal,
        })
        recordAudit(security, "fs.read.outside-userdata", resource, "allowed", "skill-uninstall-scan")
        return result
      } catch (error) {
        if (!permissionDenied) {
          recordAudit(security, "fs.read.outside-userdata", resource, "failed", "skill-uninstall-scan")
        }
        throw new Error(SEARCH_ROOT_ERROR, { cause: error })
      }
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

  async uninstall(
    targets: readonly SkillUninstallTarget[],
    security: SkillUninstallerSecurity,
    hooks: SkillUninstallerHooks = {},
  ): Promise<SkillUninstallBatchResult> {
    const results: SkillUninstallBatchResult["results"] = []

    for (const target of targets) {
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
        }
      }
    }

    return { results }
  }
}

export const skillUninstallerService = new SkillUninstallerService()
