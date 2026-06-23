import { createHash, randomUUID } from "node:crypto"
import type { WorkflowDefinition, WorkflowMeta, ValidationError } from "../../../src/types/workflow"
import { normalizeWorkflowEntry, type DataNamespace, type DataRepository, type WorkflowEntryV1 } from "../../runtime/data-repo"
import { validateWorkflow, type WorkflowValidationOptions } from "./workflow-validator"
import { createMainLogger } from "../log-store"
import { errorLogMeta as baseErrorLogMeta } from "../error-sanitize"
import { sanitizeAgentError } from "./workflow-utils"
import { DEFAULT_AGENT_TIMEOUT_MINS } from "../../../workflow-nodes/agent-timeout"
import type { WorkflowParamPresetService } from "./workflow-param-preset-service"

const logger = createMainLogger("service.workflow")

export interface WorkflowSaveResult { versionHash: string }
export interface WorkflowSaveError { errors: ValidationError[] }
export interface WorkflowDefaultProviderModel {
  providerId: string
  modelTier: NonNullable<WorkflowDefinition["defaultModelTier"]>
}
export type WorkflowValidationOptionsProvider = () => Promise<WorkflowValidationOptions> | WorkflowValidationOptions

export class WorkflowService {
  private _seq = 0
  private readonly workflowsNamespace: DataNamespace<WorkflowEntryV1>
  private readonly validationOptionsProvider?: WorkflowValidationOptionsProvider
  private readonly paramPresetService?: Pick<WorkflowParamPresetService, "deleteForWorkflow">

  constructor(
    dataRepository: DataRepository,
    validationOptionsProvider?: WorkflowValidationOptionsProvider,
    paramPresetService?: Pick<WorkflowParamPresetService, "deleteForWorkflow">,
  ) {
    this.workflowsNamespace = dataRepository.namespace<WorkflowEntryV1>("workflows")
    this.validationOptionsProvider = validationOptionsProvider
    this.paramPresetService = paramPresetService
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
        loadError: d.loadError as string | undefined,
        nodeCount: (d.nodes ?? []).length,
        createdAt: d.createdAt as number,
        updatedAt: d.updatedAt as number,
      })).sort((left, right) => (
        right.updatedAt - left.updatedAt
        || right.createdAt - left.createdAt
      ))
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
        loadError: entry.loadError as string | undefined,
        defaultProjectId: entry.defaultProjectId as string | undefined,
        defaultProviderId: entry.defaultProviderId as string | undefined,
        defaultModelTier: entry.defaultModelTier as WorkflowDefinition["defaultModelTier"],
        defaultNodeTimeoutMins: entry.defaultNodeTimeoutMins as number | undefined,
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
    if (typeof def.id !== "string" || !def.id.trim()) {
      return { errors: [{ type: "invalid_config", message: "工作流 ID 不能为空" }] }
    }
    let validationOptions: WorkflowValidationOptions | undefined
    try {
      validationOptions = await this.validationOptionsProvider?.()
    } catch (err) {
      logger.warn("workflow save project validation context failed", {
        id: def.id,
        name: def.name,
        ...errorLogMeta(err),
      })
      return { errors: [{ type: "invalid_config", message: "保存失败：项目配置读取失败，请重试" }] }
    }
    let availableWorkflowIds: string[]
    try {
      availableWorkflowIds = (await this.workflowsNamespace.list()).map((entry) => entry.id)
    } catch (err) {
      logger.warn("workflow save workflow validation context failed", {
        id: def.id,
        name: def.name,
        ...errorLogMeta(err),
      })
      return { errors: [{ type: "invalid_config", message: "保存失败：工作流列表读取失败，请重试" }] }
    }
    validationOptions = {
      ...validationOptions,
      availableWorkflowIds,
    }
    const validation = validateWorkflow(def, validationOptions)
    if (!validation.valid) {
      logger.warn("workflow save blocked by validation", { id: def.id, name: def.name, errorCount: validation.errors.length, errors: validation.errors })
      return { errors: validation.errors }
    }
    const versionHash = this.versionHash(def)
    const now = Date.now()
    const versioned = normalizeWorkflowEntry({
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
      defaultNodeTimeoutMins: def.defaultNodeTimeoutMins,
      params: def.params as WorkflowEntryV1["params"],
      nodes: def.nodes as WorkflowEntryV1["nodes"],
      edges: def.edges as WorkflowEntryV1["edges"],
    })
    if (!versioned) {
      return { errors: [{ type: "invalid_config", message: "保存失败：工作流数据格式异常，请检查后重试" }] }
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
      defaultNodeTimeoutMins: DEFAULT_AGENT_TIMEOUT_MINS,
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
      await this.paramPresetService?.deleteForWorkflow(id)
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

function errorLogMeta(error: unknown): Record<string, unknown> {
  return baseErrorLogMeta(error, {
    includeCode: true,
    includeMessage: true,
    messageLimit: 200,
    sanitizeMessage: sanitizeAgentError,
  })
}
