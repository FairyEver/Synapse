import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { createHash, randomUUID } from "node:crypto"
import type { WorkflowDefinition, WorkflowMeta, ValidationError } from "../../../src/types/workflow"
import { validateWorkflow } from "./workflow-validator"

export interface WorkflowSaveResult { versionHash: string }
export interface WorkflowSaveError { errors: ValidationError[] }

export class WorkflowService {
  constructor(private readonly repoPath: string) {}

  private dir(id: string) { return path.join(this.repoPath, "workflows", id) }

  private versionHash(def: WorkflowDefinition): string {
    const ts = Date.now()
    const hash = createHash("sha256").update(JSON.stringify(def)).digest("hex").slice(0, 8)
    return `v_${ts}_${hash}`
  }

  async list(): Promise<WorkflowMeta[]> {
    let ids: string[]
    try { ids = await readdir(path.join(this.repoPath, "workflows")) } catch { return [] }
    const metas: WorkflowMeta[] = []
    for (const id of ids) {
      const def = await this.get(id)
      if (def) metas.push({ id: def.id, name: def.name, description: def.description, version: def.version, nodeCount: def.nodes.length, createdAt: def.createdAt, updatedAt: def.updatedAt })
    }
    return metas
  }

  async get(id: string): Promise<WorkflowDefinition | null> {
    let files: string[]
    try { files = await readdir(this.dir(id)) } catch { return null }
    const versions = files.filter((f) => f.startsWith("v_") && f.endsWith(".json")).sort()
    if (!versions.length) return null
    return JSON.parse(await readFile(path.join(this.dir(id), versions[versions.length - 1]), "utf-8")) as WorkflowDefinition
  }

  async save(def: WorkflowDefinition): Promise<WorkflowSaveResult | WorkflowSaveError> {
    const validation = validateWorkflow(def)
    if (!validation.valid) return { errors: validation.errors }
    const versionHash = this.versionHash(def)
    const versioned: WorkflowDefinition = { ...def, version: versionHash, updatedAt: Date.now() }
    await mkdir(this.dir(def.id), { recursive: true })
    await writeFile(path.join(this.dir(def.id), `${versionHash}.json`), JSON.stringify(versioned, null, 2), "utf-8")
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
    const result = await this.save(def)
    if ("errors" in result) return result
    return { id, ...result }
  }

  async delete(id: string): Promise<void> {
    try { await rm(this.dir(id), { recursive: true, force: true }) } catch { /* already gone */ }
  }
}
