import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { createHash, randomUUID } from "node:crypto"
import type { WorkflowDefinition, WorkflowMeta, ValidationError } from "../../../src/types/workflow"
import { validateWorkflow } from "./workflow-validator"
import { createMainLogger } from "../log-store"
import { configStore } from "../config-store"
import { errorCode, sanitizeAgentError, truncateWithEllipsis } from "./workflow-utils"

const logger = createMainLogger("service.workflow")

const MAX_VERSIONS = 10

export interface WorkflowSaveResult { versionHash: string }
export interface WorkflowSaveError { errors: ValidationError[] }

export class WorkflowService {
  private _seq = 0
  constructor(private readonly getRepoPath: () => string) {}

  private get repoPath(): string { return this.getRepoPath() }

  private isSafeId(id: string): boolean {
    return typeof id === "string" && id.length > 0 && !/[/\\]/.test(id) && id !== "." && id !== ".."
  }

  private dir(id: string) {
    const base = path.join(this.repoPath, "workflows")
    const resolved = path.resolve(base, id)
    if (!resolved.startsWith(base + path.sep) && resolved !== base) {
      throw new Error("工作流 ID 包含非法路径片段")
    }
    return resolved
  }

  private versionHash(def: WorkflowDefinition): string {
    const ts = Date.now()
    const seq = String(this._seq++).padStart(8, "0")
    const hash = createHash("sha256").update(JSON.stringify(def)).digest("hex").slice(0, 8)
    return `v_${ts}_${seq}_${hash}`
  }

  async list(): Promise<WorkflowMeta[]> {
    const resolvedPath = this.repoPath
    const repoPathMeta = summarizeRepoPath(resolvedPath)
    logger.info("workflow list: resolving from repo", repoPathMeta)
    let ids: string[]
    try {
      const entries = await readdir(path.join(resolvedPath, "workflows"), { withFileTypes: true })
      ids = entries.filter((e) => e.isDirectory()).map((e) => e.name)
    } catch (err) {
      if (errorCode(err) === "ENOENT") {
        // workflows 目录不存在——合法空列表
        return []
      }
      logger.warn("workflow list failed", {
        boundary: "workflow-service.list",
        ...repoPathMeta,
        ...errorLogMeta(err),
      })
      throw err
    }
    const defs = await Promise.all(ids.map((id) => this.get(id)))
    const metas: WorkflowMeta[] = []
    for (const def of defs) {
      if (def) metas.push({ id: def.id, name: def.name, description: def.description, version: def.version, nodeCount: def.nodes.length, createdAt: def.createdAt, updatedAt: def.updatedAt })
    }
    logger.info("workflow list loaded", { count: metas.length })
    return metas
  }

  async get(id: string): Promise<WorkflowDefinition | null> {
    let files: string[]
    try { files = await readdir(this.dir(id)) } catch (err) {
      logger.info("workflow get: not found", {
        boundary: "workflow-service.get.not-found",
        id,
        ...summarizeRepoPath(this.repoPath),
        ...errorLogMeta(err),
      })
      return null
    }
    const versions = files.filter((f) => f.startsWith("v_") && f.endsWith(".json")).sort()
    if (!versions.length) {
      logger.info("workflow get: no versions", { id })
      return null
    }
    for (const versionFile of [...versions].reverse()) {
      try {
        const parsed = JSON.parse(await readFile(path.join(this.dir(id), versionFile), "utf-8")) as WorkflowDefinition
        logger.info("workflow get: loaded", { id, versionFile })
        return parsed
      } catch (err) {
        logger.warn("workflow get failed", {
          boundary: "workflow-service.get",
          id,
          versionFile,
          ...errorLogMeta(err),
        })
      }
    }
    logger.error("workflow get: all version files corrupted", { id, versionCount: versions.length })
    return null
  }

  async save(def: WorkflowDefinition): Promise<WorkflowSaveResult | WorkflowSaveError> {
    if (!this.isSafeId(def.id)) {
      logger.warn("workflow save blocked — unsafe ID", { id: def.id })
      return { errors: [{ type: "invalid_config", message: "工作流 ID 格式非法" }] }
    }
    const validation = validateWorkflow(def)
    if (!validation.valid) {
      logger.warn("workflow save blocked by validation", { id: def.id, name: def.name, errorCount: validation.errors.length, errors: validation.errors })
      return { errors: validation.errors }
    }
    const versionHash = this.versionHash(def)
    const versioned: WorkflowDefinition = { ...def, version: versionHash, updatedAt: Date.now() }
    try {
      await mkdir(this.dir(def.id), { recursive: true })
      const target = path.join(this.dir(def.id), `${versionHash}.json`)
      const tmp = `${target}.tmp`
      await writeFile(tmp, JSON.stringify(versioned, null, 2), "utf-8")
      await rename(tmp, target)
    } catch (err) {
      logger.error("workflow save failed — disk write error", {
        boundary: "workflow-service.save",
        id: def.id,
        name: def.name,
        ...summarizeRepoPath(this.repoPath),
        ...errorLogMeta(err),
      })
      return { errors: [{ type: "invalid_config", message: "保存失败：磁盘空间不足或权限不足，请检查后重试" }] }
    }
    logger.info("workflow saved", { id: def.id, name: def.name, nodeCount: def.nodes.length, versionHash })
    // Prune old version files to prevent unbounded disk growth
    try {
      const allFiles = await readdir(this.dir(def.id))
      const versionFiles = allFiles.filter((f) => f.startsWith("v_") && f.endsWith(".json")).sort()
      const staleVersions = versionFiles.length > MAX_VERSIONS
        ? versionFiles.slice(0, versionFiles.length - MAX_VERSIONS)
        : []
      const tmpFiles = allFiles.filter((f) => f.endsWith(".tmp"))
      const STALE_TMP_AGE_MS = 60_000
      const now = Date.now()
      const staleTmpFiles = (await Promise.all(
        tmpFiles.map(async (f) => {
          try {
            const st = await stat(path.join(this.dir(def.id), f))
            return now - st.mtimeMs > STALE_TMP_AGE_MS ? f : null
          } catch { return null }
        }),
      )).filter((f): f is string => f !== null)
      const toDelete = [...staleVersions, ...staleTmpFiles]
      if (toDelete.length > 0) {
        await Promise.all(toDelete.map((f) => rm(path.join(this.dir(def.id), f), { force: true })))
        logger.info("workflow version files pruned", { id: def.id, prunedVersions: staleVersions.length, prunedTmp: staleTmpFiles.length, remaining: MAX_VERSIONS })
      }
    } catch (err) {
      logger.warn("workflow version pruning failed (non-critical)", {
        id: def.id,
        ...errorLogMeta(err),
      })
    }
    return { versionHash }
  }

  async create(): Promise<{ id: string; versionHash: string } | WorkflowSaveError> {
    const id = randomUUID()
    const now = Date.now()
    const appConfig = await configStore.load()
    const pm = appConfig.agent?.defaultProviderModel
    const def: WorkflowDefinition = {
      id, name: "新工作流", version: "", createdAt: now, updatedAt: now, params: [],
      ...(pm ? { defaultProviderId: pm.providerId, defaultModelTier: pm.modelTier } : {}),
      nodes: [{ id: randomUUID(), name: "结束", type: "end", position: { x: 600, y: 200 }, config: { outputType: "text", template: "", variables: [] } }],
      edges: [],
    }
    logger.info("workflow creating", { id, name: def.name })
    const result = await this.save(def)
    if ("errors" in result) {
      logger.warn("workflow create failed", { id, errors: result.errors })
      return result
    }
    logger.info("workflow created", { id, name: def.name, versionHash: result.versionHash })
    return { id, ...result }
  }

  async delete(id: string): Promise<void> {
    if (!this.isSafeId(id)) {
      logger.warn("workflow delete blocked — unsafe ID", { id })
      return
    }
    logger.info("workflow deleting", { id })
    try {
      await rm(this.dir(id), { recursive: true, force: true })
      logger.info("workflow deleted", { id })
    } catch (err) {
      logger.warn("workflow delete error", {
        boundary: "workflow-service.delete",
        id,
        ...summarizeRepoPath(this.repoPath),
        ...errorLogMeta(err),
      })
      throw err
    }
  }
}

function summarizeRepoPath(repoPath: string): { repoBasename: string; repoPathLength: number } {
  return {
    repoBasename: path.basename(repoPath) || "[path redacted]",
    repoPathLength: repoPath.length,
  }
}

function errorLogMeta(error: unknown): { errorName: string; errorCode?: string; errorLength: number; errorMessage: string } {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : String(error)
  const sanitized = sanitizeAgentError(raw)
  const truncated = truncateWithEllipsis(sanitized, 200)
  return {
    errorName: error instanceof Error ? error.name : typeof error,
    errorCode: errorCode(error),
    errorLength: raw.length,
    errorMessage: truncated,
  }
}
