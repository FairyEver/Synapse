import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { createHash, randomUUID } from "node:crypto"
import type { WorkflowDefinition, WorkflowMeta, ValidationError } from "../../../src/types/workflow"
import { validateWorkflow } from "./workflow-validator"
import { createMainLogger } from "../log-store"

const logger = createMainLogger("service.workflow")

export interface WorkflowSaveResult { versionHash: string }
export interface WorkflowSaveError { errors: ValidationError[] }

export class WorkflowService {
  private _seq = 0
  constructor(private readonly getRepoPath: () => string) {}

  private get repoPath(): string { return this.getRepoPath() }

  private dir(id: string) { return path.join(this.repoPath, "workflows", id) }

  private versionHash(def: WorkflowDefinition): string {
    const ts = Date.now()
    const seq = String(this._seq++).padStart(8, "0")
    const hash = createHash("sha256").update(JSON.stringify(def)).digest("hex").slice(0, 8)
    return `v_${ts}_${seq}_${hash}`
  }

  async list(): Promise<WorkflowMeta[]> {
    const resolvedPath = this.repoPath
    logger.info("workflow list: resolving from repo", { repoPath: resolvedPath })
    let ids: string[]
    try { ids = await readdir(path.join(resolvedPath, "workflows")) } catch { return [] }
    const metas: WorkflowMeta[] = []
    for (const id of ids) {
      const def = await this.get(id)
      if (def) metas.push({ id: def.id, name: def.name, description: def.description, version: def.version, nodeCount: def.nodes.length, createdAt: def.createdAt, updatedAt: def.updatedAt })
    }
    logger.info("workflow list loaded", { count: metas.length })
    return metas
  }

  async get(id: string): Promise<WorkflowDefinition | null> {
    let files: string[]
    try { files = await readdir(this.dir(id)) } catch {
      logger.info("workflow get: not found", { id })
      return null
    }
    const versions = files.filter((f) => f.startsWith("v_") && f.endsWith(".json")).sort()
    if (!versions.length) {
      logger.info("workflow get: no versions", { id })
      return null
    }
    const versionFile = versions[versions.length - 1]
    logger.info("workflow get: loaded", { id, versionFile })
    return JSON.parse(await readFile(path.join(this.dir(id), versionFile), "utf-8")) as WorkflowDefinition
  }

  async save(def: WorkflowDefinition): Promise<WorkflowSaveResult | WorkflowSaveError> {
    const validation = validateWorkflow(def)
    if (!validation.valid) {
      logger.warn("workflow save blocked by validation", { id: def.id, name: def.name, errorCount: validation.errors.length, errors: validation.errors })
      return { errors: validation.errors }
    }
    const versionHash = this.versionHash(def)
    const versioned: WorkflowDefinition = { ...def, version: versionHash, updatedAt: Date.now() }
    try {
      await mkdir(this.dir(def.id), { recursive: true })
      await writeFile(path.join(this.dir(def.id), `${versionHash}.json`), JSON.stringify(versioned, null, 2), "utf-8")
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error("workflow save failed — disk write error", { id: def.id, name: def.name, error: msg, stack: err instanceof Error ? err.stack : undefined })
      return { errors: [{ type: "invalid_config", message: "保存失败：磁盘空间不足或权限不足，请检查后重试" }] }
    }
    logger.info("workflow saved", { id: def.id, name: def.name, nodeCount: def.nodes.length, versionHash })
    return { versionHash }
  }

  async create(): Promise<{ id: string; versionHash: string } | WorkflowSaveError> {
    const id = randomUUID()
    const now = Date.now()
    const def: WorkflowDefinition = {
      id, name: "新工作流", version: "", createdAt: now, updatedAt: now, params: [],
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
    logger.info("workflow deleting", { id })
    try {
      await rm(this.dir(id), { recursive: true, force: true })
      logger.info("workflow deleted", { id })
    } catch (err) {
      logger.warn("workflow delete error", { id, error: err instanceof Error ? err.message : String(err) })
    }
  }
}
