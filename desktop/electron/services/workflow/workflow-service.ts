import { createHash, randomUUID } from "node:crypto"
import type { WorkflowDefinition, WorkflowMeta, ValidationError } from "../../../src/types/workflow"
import type { DataNamespace, DataRepository, WorkflowEntryV1 } from "../../runtime/data-repo"
import { validateWorkflow } from "./workflow-validator"
import { createMainLogger } from "../log-store"
import { errorCode, sanitizeAgentError, truncateWithEllipsis } from "./workflow-utils"

const logger = createMainLogger("service.workflow")

export interface WorkflowSaveResult { versionHash: string }
export interface WorkflowSaveError { errors: ValidationError[] }
export interface WorkflowDefaultProviderModel {
  providerId: string
  modelTier: NonNullable<WorkflowDefinition["defaultModelTier"]>
}

export class WorkflowService {
  private _seq = 0
  private readonly workflowsNamespace: DataNamespace<WorkflowEntryV1>

  constructor(dataRepository: DataRepository) {
    this.workflowsNamespace = dataRepository.namespace<WorkflowEntryV1>("workflows")
  }

  private versionHash(def: WorkflowDefinition): string {
    const ts = Date.now()
    const seq = String(this._seq++).padStart(8, "0")
    const hash = createHash("sha256").update(JSON.stringify(def)).digest("hex").slice(0, 8)
    return `v_${ts}_${seq}_${hash}`
  }

  async list(): Promise<WorkflowMeta[]> {
    try {
      const defs = await this.workflowsNamespace.list()
      logger.info("workflow list loaded", { count: defs.length })
      return defs.map((d) => ({
        id: d.id,
        name: d.name,
        description: d.description,
        version: d.version,
        nodeCount: (d.nodes ?? []).length,
        createdAt: d.createdAt as number,
        updatedAt: d.updatedAt as number,
      }))
    } catch (err) {
      logger.warn("workflow list failed", {
        boundary: "workflow-service.list",
        ...errorLogMeta(err),
      })
      throw err
    }
  }

  async get(id: string): Promise<WorkflowDefinition | null> {
    try {
      const entry = await this.workflowsNamespace.get(id)
      if (!entry) {
        logger.info("workflow get: not found", { id })
        return null
      }
      const def: WorkflowDefinition = {
        id: entry.id,
        name: entry.name as string,
        description: entry.description as string | undefined,
        version: entry.version as string,
        createdAt: entry.createdAt as number,
        updatedAt: entry.updatedAt as number,
        defaultProjectId: entry.defaultProjectId as string | undefined,
        defaultProviderId: entry.defaultProviderId as string | undefined,
        defaultModelTier: entry.defaultModelTier as WorkflowDefinition["defaultModelTier"],
        params: entry.params as WorkflowDefinition["params"],
        nodes: entry.nodes as WorkflowDefinition["nodes"],
        edges: entry.edges as WorkflowDefinition["edges"],
      }
      logger.info("workflow get: loaded", { id, version: def.version })
      return def
    } catch (err) {
      logger.warn("workflow get failed", {
        boundary: "workflow-service.get",
        id,
        ...errorLogMeta(err),
      })
      throw err
    }
  }

  async save(def: WorkflowDefinition): Promise<WorkflowSaveResult | WorkflowSaveError> {
    const validation = validateWorkflow(def)
    if (!validation.valid) {
      logger.warn("workflow save blocked by validation", { id: def.id, name: def.name, errorCount: validation.errors.length, errors: validation.errors })
      return { errors: validation.errors }
    }
    const versionHash = this.versionHash(def)
    const now = Date.now()
    const versioned: WorkflowEntryV1 = {
      id: def.id,
      schemaVersion: 1,
      name: def.name,
      description: def.description,
      version: versionHash,
      createdAt: def.createdAt || now,
      updatedAt: now,
      defaultProjectId: def.defaultProjectId,
      defaultProviderId: def.defaultProviderId,
      defaultModelTier: def.defaultModelTier,
      params: def.params as WorkflowEntryV1["params"],
      nodes: def.nodes as WorkflowEntryV1["nodes"],
      edges: def.edges as WorkflowEntryV1["edges"],
    }
    try {
      await this.workflowsNamespace.upsert(versioned)
    } catch (err) {
      logger.error("workflow save failed", {
        boundary: "workflow-service.save",
        id: def.id,
        name: def.name,
        ...errorLogMeta(err),
      })
      return { errors: [{ type: "invalid_config", message: "保存失败：存储异常，请检查后重试" }] }
    }
    logger.info("workflow saved", { id: def.id, name: def.name, nodeCount: def.nodes.length, versionHash })
    return { versionHash }
  }

  async create(defaultProjectId?: string, defaultProviderModel?: WorkflowDefaultProviderModel): Promise<{ id: string; versionHash: string } | WorkflowSaveError> {
    const id = randomUUID()
    const now = Date.now()
    const def: WorkflowDefinition = {
      id, name: "新工作流", version: "", createdAt: now, updatedAt: now, params: [],
      defaultProjectId,
      defaultProviderId: defaultProviderModel?.providerId,
      defaultModelTier: defaultProviderModel?.modelTier,
      nodes: [{ id: "end", name: "结束", type: "end", position: { x: 600, y: 200 }, config: { outputType: "text", template: "", variables: [] } }],
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
      await this.workflowsNamespace.remove(id)
      logger.info("workflow deleted", { id })
    } catch (err) {
      logger.warn("workflow delete error", {
        boundary: "workflow-service.delete",
        id,
        ...errorLogMeta(err),
      })
      throw err
    }
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
