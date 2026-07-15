import path from "node:path"
import { createHash, randomUUID } from "node:crypto"
import type { WorkflowDefinition, WorkflowFutureDocument, WorkflowMeta, WorkflowParam, ValidationError } from "../../../src/types/workflow"
import type {
  DataNamespace,
  DataRepository,
  WorkflowEntryV1,
  WorkflowMigrationStateEntryV1,
  WorkflowMigrationStateStatus,
} from "../../runtime/data-repo"
import { AtomicSourceChangedError, JsonNamespace } from "../../runtime/data-repo"
import { validateWorkflow, type WorkflowValidationOptions } from "./workflow-validator"
import { createMainLogger } from "../log-store"
import { errorLogMeta as baseErrorLogMeta } from "../error-sanitize"
import { sanitizeAgentError } from "./workflow-utils"
import { DEFAULT_AGENT_TIMEOUT_MINS } from "../../../workflow-nodes/agent-timeout"
import type { WorkflowParamPresetService } from "./workflow-param-preset-service"
import {
  migrateWorkflowDocument,
  WORKFLOW_SCHEMA_VERSION,
  workflowDocumentDigest,
  type WorkflowDocumentMigrationResult,
} from "./workflow-document-migration"
import {
  listLegacyWorkflowSources,
  WorkflowMigrationStorage,
} from "./workflow-migration-storage"

const logger = createMainLogger("service.workflow")

export interface WorkflowSaveResult { versionHash: string }
export interface WorkflowSaveError { errors: ValidationError[] }
export type WorkflowExportDocumentResult =
  | { readonly kind: "current"; readonly document: WorkflowDefinition }
  | { readonly kind: "future"; readonly document: WorkflowFutureDocument; readonly sourceVersion: string }
export interface WorkflowDefaultProviderModel {
  providerId: string
  modelTier: NonNullable<WorkflowDefinition["defaultModelTier"]>
}
export type WorkflowValidationOptionsProvider = () => Promise<WorkflowValidationOptions> | WorkflowValidationOptions

export interface WorkflowServiceMigrationOptions {
  readonly dataRootPath?: string
  readonly listLegacyRepositoryPaths?: () => Promise<readonly string[]>
  readonly now?: () => number
}

interface WorkflowMigrationStateWrite {
  readonly id: string
  readonly workflowId: string
  readonly sourceDigest: string
  readonly sourceKind: WorkflowMigrationStateEntryV1["sourceKind"]
  readonly status: WorkflowMigrationStateStatus
  readonly error?: Error
}

export class WorkflowService {
  private _seq = 0
  private readonly workflowsNamespace: DataNamespace<WorkflowEntryV1>
  private readonly workflowsJsonNamespace: JsonNamespace<WorkflowEntryV1> | null
  private readonly migrationStateNamespace: DataNamespace<WorkflowMigrationStateEntryV1>
  private readonly validationOptionsProvider?: WorkflowValidationOptionsProvider
  private readonly paramPresetService?: Pick<WorkflowParamPresetService, "deleteForWorkflow">
  private readonly migrationOptions: WorkflowServiceMigrationOptions
  private readonly migrationStorage: WorkflowMigrationStorage
  private initialization: Promise<void> | null = null

  constructor(
    dataRepository: DataRepository,
    validationOptionsProvider?: WorkflowValidationOptionsProvider,
    paramPresetService?: Pick<WorkflowParamPresetService, "deleteForWorkflow">,
    migrationOptions: WorkflowServiceMigrationOptions = {},
  ) {
    this.workflowsNamespace = dataRepository.namespace<WorkflowEntryV1>("workflows")
    this.workflowsJsonNamespace = this.workflowsNamespace instanceof JsonNamespace
      ? this.workflowsNamespace
      : null
    this.migrationStateNamespace = dataRepository.namespace<WorkflowMigrationStateEntryV1>("workflow.migration-state")
    this.validationOptionsProvider = validationOptionsProvider
    this.paramPresetService = paramPresetService
    this.migrationOptions = migrationOptions
    this.migrationStorage = new WorkflowMigrationStorage(
      migrationOptions.dataRootPath ? path.join(migrationOptions.dataRootPath, "workflows.json") : undefined,
      migrationOptions.dataRootPath ? path.join(migrationOptions.dataRootPath, "workflow-migration-backups") : undefined,
    )
  }

  initialize(): Promise<void> {
    this.initialization ??= this.initializeInternal().catch((error) => {
      this.initialization = null
      throw error
    })
    return this.initialization
  }

  private async initializeInternal(): Promise<void> {
    await this.migrateCurrentStore()
    await this.recoverLegacyRepositoryWorkflows()
  }

  private versionHash(def: WorkflowDefinition): string {
    const ts = Date.now()
    const seq = String(this._seq++).padStart(8, "0")
    const hash = createHash("sha256").update(JSON.stringify(def)).digest("hex").slice(0, 8)
    return `v_${ts}_${seq}_${hash}`
  }

  async list(): Promise<WorkflowMeta[]> {
    await this.initialize()
    try {
      const entries = await this.workflowsNamespace.list()
      const workflows = entries.map((entry) => this.toWorkflowMeta(entry))
      logger.info("workflow list loaded", { count: workflows.length })
      return workflows.sort((left, right) => (
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
    await this.initialize()
    try {
      const result = await this.getExportDocument(id)
      if (!result) {
        logger.info("workflow get: not found", { id })
        return null
      }
      if (result.kind === "future") {
        throw new Error(`该工作流使用更高的数据版本（${result.sourceVersion}），请升级 Synapse 后再编辑或运行。`)
      }
      logger.info("workflow get: loaded", { id, version: result.document.version })
      return result.document
    } catch (err) {
      logger.warn("workflow get failed", {
        boundary: "workflow-service.get",
        id,
        ...errorLogMeta(err),
      })
      throw err
    }
  }

  async getExportDocument(id: string): Promise<WorkflowExportDocumentResult | null> {
    await this.initialize()
    const entry = await this.workflowsNamespace.get(id)
    if (!entry) return null
    const result = migrateWorkflowDocument(entry)
    if (result.kind === "current") return { kind: "current", document: result.document }
    if (result.kind === "unsupported_future") {
      return {
        kind: "future",
        document: structuredClone(entry) as WorkflowFutureDocument,
        sourceVersion: result.sourceVersion,
      }
    }
    throw workflowReadError(result)
  }

  async save(def: WorkflowDefinition): Promise<WorkflowSaveResult | WorkflowSaveError> {
    await this.initialize()
    if (typeof def.id !== "string" || !def.id.trim()) {
      return { errors: [{ type: "invalid_config", message: "工作流 ID 不能为空" }] }
    }
    const migrated = migrateWorkflowDocument(def)
    if (migrated.kind !== "current") {
      return { errors: [{ type: "invalid_config", message: workflowReadError(migrated).message }] }
    }
    const current = migrated.document

    let validationOptions: WorkflowValidationOptions | undefined
    try {
      validationOptions = await this.validationOptionsProvider?.()
    } catch (err) {
      logger.warn("workflow save project validation context failed", {
        id: current.id,
        name: current.name,
        ...errorLogMeta(err),
      })
      return { errors: [{ type: "invalid_config", message: "保存失败：项目配置读取失败，请重试" }] }
    }
    let workflowEntries: WorkflowDefinition[]
    try {
      const storedEntries = await this.workflowsNamespace.list()
      const existing = storedEntries.find((entry) => entry.id === current.id)
      if (existing) {
        const existingResult = migrateWorkflowDocument(existing)
        if (existingResult.kind !== "current") {
          return {
            errors: [{
              type: "invalid_config",
              message: `${workflowReadError(existingResult).message} 受保护的原始数据不能被覆盖。`,
            }],
          }
        }
      }
      workflowEntries = storedEntries.flatMap((entry) => {
        const result = migrateWorkflowDocument(entry)
        return result.kind === "current" ? [result.document] : []
      })
    } catch (err) {
      logger.warn("workflow save workflow validation context failed", {
        id: current.id,
        name: current.name,
        ...errorLogMeta(err),
      })
      return { errors: [{ type: "invalid_config", message: "保存失败：工作流列表读取失败，请重试" }] }
    }
    validationOptions = {
      ...validationOptions,
      availableWorkflowIds: workflowEntries.map((entry) => entry.id),
      workflowParamsById: new Map(
        workflowEntries.map((entry) => [entry.id, entry.params as WorkflowParam[]]),
      ),
    }
    const validation = validateWorkflow(current, validationOptions)
    if (!validation.valid) {
      logger.warn("workflow save blocked by validation", { id: current.id, name: current.name, errorCount: validation.errors.length, errors: validation.errors })
      return { errors: validation.errors }
    }
    const versionHash = this.versionHash(current)
    const now = this.migrationOptions.now?.() ?? Date.now()
    const versioned: WorkflowEntryV1 = {
      ...current,
      meta: { ...current.meta, schemaVersion: WORKFLOW_SCHEMA_VERSION },
      version: versionHash,
      createdAt: current.createdAt || now,
      updatedAt: now,
    } as WorkflowEntryV1
    delete versioned.loadError
    delete versioned.schemaVersion
    try {
      await this.workflowsNamespace.upsert(versioned)
      await this.clearCurrentMigrationState(current.id)
    } catch (err) {
      logger.error("workflow save failed", {
        boundary: "workflow-service.save",
        id: current.id,
        name: current.name,
        ...errorLogMeta(err),
      })
      return { errors: [{ type: "invalid_config", message: "保存失败：存储异常，请检查后重试" }] }
    }
    logger.info("workflow saved", { id: current.id, name: current.name, nodeCount: current.nodes.length, versionHash })
    return { versionHash }
  }

  async create(defaultProjectId?: string, defaultProviderModel?: WorkflowDefaultProviderModel): Promise<{ id: string; versionHash: string } | WorkflowSaveError> {
    const id = randomUUID()
    const now = this.migrationOptions.now?.() ?? Date.now()
    const def: WorkflowDefinition = {
      id, name: "新工作流", version: "", createdAt: now, updatedAt: now, params: [],
      meta: { schemaVersion: WORKFLOW_SCHEMA_VERSION },
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
    await this.initialize()
    logger.info("workflow deleting", { id })
    try {
      await this.workflowsNamespace.remove(id)
      await this.clearCurrentMigrationState(id)
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

  private async migrateCurrentStore(): Promise<void> {
    const entries = await this.workflowsNamespace.list()
    const migratedDocuments: WorkflowEntryV1[] = []
    const migrationStates: WorkflowMigrationStateWrite[] = []
    const currentWorkflowIds: string[] = []
    for (const entry of entries) {
      const result = migrateWorkflowDocument(entry)
      const digest = workflowDocumentDigest(entry)
      if (result.kind === "current") {
        if (result.migrated) {
          migratedDocuments.push(result.document as WorkflowEntryV1)
        }
        currentWorkflowIds.push(entry.id)
        continue
      }
      migrationStates.push({
        id: currentMigrationStateId(entry.id),
        workflowId: entry.id,
        sourceDigest: digest,
        sourceKind: "current",
        status: result.kind === "unsupported_future" ? "unsupported_future" : "failed",
        error: result.error,
      })
    }

    if (migratedDocuments.length > 0) {
      const expectedStoreBytes = await this.migrationStorage.ensureCurrentStoreBackup()
      await this.upsertMigratedWorkflows(migratedDocuments, expectedStoreBytes)
    }
    for (const workflowId of currentWorkflowIds) {
      await this.clearCurrentMigrationState(workflowId)
    }
    for (const state of migrationStates) {
      await this.writeMigrationState(state)
    }
  }

  private async recoverLegacyRepositoryWorkflows(): Promise<void> {
    if (!this.migrationOptions.listLegacyRepositoryPaths) return
    const repositoryPaths = await this.migrationOptions.listLegacyRepositoryPaths()
    const sources = await listLegacyWorkflowSources(repositoryPaths, (issue) => {
      logger.warn("legacy repository workflow scan entry skipped", {
        operation: issue.operation,
        workflowId: issue.workflowId,
        ...errorLogMeta(issue.error),
      })
    })
    const existingIds = new Set((await this.workflowsNamespace.list()).map((entry) => entry.id))
    const migrationStates = await this.migrationStateNamespace.list()
    const states = new Map(migrationStates.map((entry) => [entry.id, entry]))
    const completedLegacyWorkflowIds = new Set(
      migrationStates
        .filter((entry) => entry.sourceKind === "legacy_repository"
          && (entry.status === "legacy_recovered" || entry.status === "legacy_conflict"))
        .map((entry) => entry.workflowId),
    )
    let expectedStoreBytes: Uint8Array | null | undefined
    let backupPrepared = false

    for (const source of sources) {
      if (completedLegacyWorkflowIds.has(source.workflowId)) continue
      const stateId = legacyMigrationStateId(source.workflowId)
      const previousState = states.get(stateId)
      if (previousState?.status === "legacy_recovered" || previousState?.status === "legacy_conflict") continue

      if (existingIds.has(source.workflowId)) {
        await this.writeMigrationState({
          id: stateId,
          workflowId: source.workflowId,
          sourceDigest: source.digest,
          sourceKind: "legacy_repository",
          status: "legacy_conflict",
        })
        completedLegacyWorkflowIds.add(source.workflowId)
        continue
      }

      const legacyDocument = source.document.id
        ? source.document
        : { ...source.document, id: source.workflowId }
      const result = migrateWorkflowDocument(legacyDocument)
      if (result.kind !== "current") {
        await this.writeMigrationState({
          id: stateId,
          workflowId: source.workflowId,
          sourceDigest: source.digest,
          sourceKind: "legacy_repository",
          status: result.kind === "unsupported_future" ? "unsupported_future" : "failed",
          error: result.error,
        })
        continue
      }

      if (!backupPrepared) {
        expectedStoreBytes = await this.migrationStorage.ensureCurrentStoreBackup()
        backupPrepared = true
      }
      expectedStoreBytes = await this.upsertMigratedWorkflow(
        result.document as WorkflowEntryV1,
        expectedStoreBytes,
      )
      existingIds.add(source.workflowId)
      await this.writeMigrationState({
        id: stateId,
        workflowId: source.workflowId,
        sourceDigest: source.digest,
        sourceKind: "legacy_repository",
        status: "legacy_recovered",
      })
      completedLegacyWorkflowIds.add(source.workflowId)
      logger.info("legacy repository workflow recovered", {
        workflowId: source.workflowId,
        sourceDigest: source.digest,
      })
    }
  }

  private async upsertMigratedWorkflow(
    document: WorkflowEntryV1,
    expectedStoreBytes: Uint8Array | null | undefined,
  ): Promise<Uint8Array | null | undefined> {
    if (expectedStoreBytes === undefined) {
      await this.workflowsNamespace.upsert(document)
      return undefined
    }
    if (!this.workflowsJsonNamespace) {
      throw new Error("Workflow migration requires the JSON DataRepository backend.")
    }
    try {
      return await this.workflowsJsonNamespace.upsertIfFileUnchanged(document, expectedStoreBytes)
    } catch (error) {
      if (error instanceof AtomicSourceChangedError) {
        logger.warn("workflow migration write blocked because the store changed", {
          boundary: "workflow-migration.write",
          workflowId: document.id,
          errorName: error.name,
        })
      }
      throw error
    }
  }

  private async upsertMigratedWorkflows(
    documents: readonly WorkflowEntryV1[],
    expectedStoreBytes: Uint8Array | null | undefined,
  ): Promise<void> {
    if (expectedStoreBytes === undefined) {
      if (this.workflowsJsonNamespace) {
        await this.workflowsJsonNamespace.upsertMany(documents)
        return
      }
      for (const document of documents) {
        await this.workflowsNamespace.upsert(document)
      }
      return
    }
    if (!this.workflowsJsonNamespace) {
      throw new Error("Workflow migration requires the JSON DataRepository backend.")
    }
    try {
      await this.workflowsJsonNamespace.upsertManyIfFileUnchanged(documents, expectedStoreBytes)
    } catch (error) {
      if (error instanceof AtomicSourceChangedError) {
        logger.warn("workflow migration batch write blocked because the store changed", {
          boundary: "workflow-migration.batch-write",
          workflowCount: documents.length,
          errorName: error.name,
        })
      }
      throw error
    }
  }

  private toWorkflowMeta(entry: WorkflowEntryV1): WorkflowMeta {
    const result = migrateWorkflowDocument(entry)
    if (result.kind === "current") {
      const document = result.document
      return {
        id: document.id,
        name: document.name,
        description: document.description,
        version: document.version,
        nodeCount: document.nodes.length,
        createdAt: document.createdAt,
        updatedAt: document.updatedAt,
      }
    }
    return {
      id: entry.id,
      name: typeof entry.name === "string" && entry.name ? entry.name : "无法读取的工作流",
      description: typeof entry.description === "string" ? entry.description : undefined,
      version: typeof entry.version === "string" ? entry.version : "",
      loadError: workflowReadError(result).message,
      rawExportAvailable: result.kind === "unsupported_future" || undefined,
      nodeCount: Array.isArray(entry.nodes) ? entry.nodes.length : 0,
      createdAt: typeof entry.createdAt === "number" ? entry.createdAt : 0,
      updatedAt: typeof entry.updatedAt === "number" ? entry.updatedAt : 0,
    }
  }

  private async clearCurrentMigrationState(workflowId: string): Promise<void> {
    await this.migrationStateNamespace.remove(currentMigrationStateId(workflowId))
  }

  private async writeMigrationState(input: WorkflowMigrationStateWrite): Promise<void> {
    await this.migrationStateNamespace.upsert({
      id: input.id,
      schemaVersion: 1,
      workflowId: input.workflowId,
      sourceDigest: input.sourceDigest,
      sourceKind: input.sourceKind,
      targetSchemaVersion: WORKFLOW_SCHEMA_VERSION,
      status: input.status,
      ...(input.error ? {
        errorCode: input.error.name,
        errorMessage: sanitizeAgentError(input.error.message).slice(0, 200),
      } : {}),
      updatedAt: this.migrationOptions.now?.() ?? Date.now(),
    })
  }
}

function currentMigrationStateId(workflowId: string): string {
  return `current:${workflowId}`
}

function legacyMigrationStateId(workflowId: string): string {
  return `legacy:${workflowId}`
}

function workflowReadError(result: Exclude<WorkflowDocumentMigrationResult, { kind: "current" }>): Error {
  if (result.kind === "unsupported_future") {
    return new Error(`该工作流使用更高的数据版本（${result.sourceVersion}），请升级 Synapse 后再编辑或运行。`)
  }
  return new Error("工作流数据迁移失败，原始数据已保留。")
}

function errorLogMeta(error: unknown): Record<string, unknown> {
  return baseErrorLogMeta(error, {
    includeCode: true,
    includeMessage: true,
    messageLimit: 200,
    sanitizeMessage: sanitizeAgentError,
  })
}
