import { createHash, randomUUID } from "node:crypto"
import os from "node:os"
import path from "node:path"
import { lstat, readFile } from "node:fs/promises"
import type { AuditSink, PermissionGuard } from "../../runtime/security"
import { writeBinaryFileAtomic } from "../../runtime/data-repo"
import { normalizeContentFileNameSegment } from "../../../src/lib/content-attachments"
import type { WorkflowDefinition, WorkflowFutureDocument, WorkflowNode } from "../../../src/types/workflow"
import type {
  SynapseWorkflowPackage,
  SynapseWorkflowExportPackageV3,
  SynapseWorkflowPackageV3,
  SynapseWorkflowImportPackage,
  WorkflowImportPreview,
  WorkflowImportOptions,
  WorkflowImportProviderOption,
  WorkflowModelMapping,
  WorkflowModelReference,
  WorkflowPackageModelTier,
  WorkflowShareExportPreflight,
  WorkflowShareDeletePlan,
  WorkflowShareManifestV4,
  WorkflowShareImportPreview,
  WorkflowShareImportSelections,
  WorkflowShareModelMapping,
  WorkflowShareModelReference,
  WorkflowSharePackageV4,
  WorkflowShareResourceReference,
  WorkflowShareResourceMapping,
  WorkflowShareResourceTarget,
} from "../../../src/types/workflow-package"
import {
  SYNAPSE_WORKFLOW_PACKAGE_FORMAT,
  SYNAPSE_WORKFLOW_PACKAGE_FORMAT_VERSION,
} from "../../../src/types/workflow-package"
import { migrateWorkflowDocumentOrThrow, WORKFLOW_SCHEMA_VERSION } from "./workflow-document-migration"
import type { ProviderService } from "../provider"
import type { CCProvider } from "../provider/types"
import { createMainLogger } from "../log-store"
import type { WorkflowAtomicBatchSnapshot, WorkflowSaveError, WorkflowService } from "./workflow-service"
import {
  collectWorkflowShareGraph,
  stableWorkflowReference,
  validateWorkflowSharePackageGraph,
  workflowChildIds,
} from "./workflow-share-graph"
import { collectWorkflowShareDependencies, type WorkflowShareProjectSummary } from "./workflow-share-dependency-collector"
import { buildWorkflowShareArchive } from "./workflow-share-package-v4"
import { checkWorkflowShareCapabilities, installedWorkflowShareCapabilities } from "./workflow-share-capabilities"
import { rewriteWorkflowSharePackage } from "./workflow-share-import-rewriter"
import type { WorkflowShareStateService } from "./workflow-share-state-service"
import type { WorkflowShareTransactionEntryV1 } from "../../runtime/data-repo"
import {
  collectUnconfirmedImportedScripts,
  type ImportedScriptPreview,
  type ImportedScriptReview,
} from "./imported-script-trust"

const PACKAGE_FORMAT = "synapse-workflow-package" as const
const PACKAGE_FORMAT_VERSION = "3.0.0" as const
const SUPPORTED_PACKAGE_FORMATS: readonly SynapseWorkflowPackage["format"][] = [
  "synapse-workflow-package-v1",
  "synapse-workflow-package-v2",
  PACKAGE_FORMAT,
]
const MODEL_TIERS: readonly WorkflowPackageModelTier[] = ["default", "haiku", "sonnet", "opus"]
const logger = createMainLogger("service.workflow.package")

interface WorkflowPackageServiceDeps {
  readonly workflowService:
    & Pick<WorkflowService, "getExportDocument" | "getLegacyMigrationExportDocument" | "save" | "commitAtomicBatch">
    & Partial<Pick<WorkflowService, "get">>
  readonly shareStateService?: Pick<WorkflowShareStateService, "initialize" | "getOrigin" | "findOriginByWorkflowId" | "getOrCreateExportLineage" | "prepareImport" | "prepareDelete" | "getUndoPlan" | "prepareUndo" | "commitImport" | "rollbackImport">
  readonly providerService: Pick<ProviderService, "listProviders">
  readonly permissionGuard: Pick<PermissionGuard, "check">
  readonly auditSink: Pick<AuditSink, "record">
  readonly now?: () => Date
  readonly createId?: () => string
  readonly appVersion?: string
  readonly platform?: NodeJS.Platform
  readonly loadProjects?: () => Promise<readonly WorkflowShareProjectSummary[]>
  readonly countLinkedAutomations?: (workflowIds: readonly string[]) => Promise<number>
  readonly assertCanCommit?: (workflowIds: readonly string[]) => Promise<void>
  readonly assertCanExport?: (workflowIds: readonly string[]) => Promise<void>
  readonly onCommitted?: (workflowIds: readonly string[]) => void
  readonly inspectAutomationCompatibility?: (definitions: readonly WorkflowDefinition[]) => Promise<Array<{
    id: string
    name: string
    action: "disable"
    reason: string
  }>>
  readonly classifyRemovedWorkflows?: (
    workflowIds: readonly string[],
    lineageWorkflowIds: readonly string[],
  ) => Promise<ReadonlyMap<string, "delete" | "detach">>
  readonly countIncompatiblePresets?: (definitions: readonly WorkflowDefinition[]) => Promise<number>
  readonly inspectDeleteCandidates?: (
    workflowIds: readonly string[],
    ignoredCallerIds: readonly string[],
  ) => Promise<ReadonlyMap<string, { name: string; hasReference: boolean; hasHistory: boolean }>>
  readonly cleanupParamPresets?: (workflowIds: readonly string[]) => Promise<void>
  readonly validateDriveResource?: (
    target: Extract<WorkflowShareResourceTarget, { kind: "drive" }>,
    reference: WorkflowShareResourceReference,
  ) => Promise<void>
}

export interface WorkflowExportDestinationOptions {
  readonly title: string
  readonly defaultPath: string
}

export interface WorkflowExportResult {
  readonly path: string
  readonly kind: WorkflowExportArtifact["kind"]
}

export type WorkflowExportArtifact =
  | {
      readonly kind: "package"
      readonly package: SynapseWorkflowPackageV3
      readonly workflowName: string
    }
  | {
      readonly kind: "future-raw"
      readonly document: WorkflowFutureDocument
      readonly sourceVersion: string
      readonly workflowName: string
    }

export interface WorkflowShareExportArtifactV4 {
  readonly kind: "package"
  readonly package: WorkflowSharePackageV4
  readonly archive: Buffer
  readonly workflowName: string
  readonly preflight: WorkflowShareExportPreflight
}

export type ImportedScriptRunPreparation =
  | {
      readonly status: "ready"
      readonly definition: WorkflowDefinition
      readonly snapshotDefinitions: readonly WorkflowDefinition[]
    }
  | {
      readonly status: "confirmation_required"
      readonly errors: [{
        readonly type: "script_confirmation_required"
        readonly message: string
        readonly retryable: true
        readonly details: {
          readonly scripts: readonly ImportedScriptPreview[]
          readonly confirmationToken: string
        }
      }]
    }
  | {
      readonly status: "save_failed"
      readonly errors: WorkflowSaveError["errors"]
    }
  | {
      readonly status: "version_conflict"
      readonly errors: WorkflowSaveError["errors"]
    }

function importedScriptReviewToken(review: ImportedScriptReview): string {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(review.reachableRevisions))
    .digest("hex")}`
}

function importedScriptConfirmationRequired(
  review: ImportedScriptReview,
  confirmationToken: string,
): Extract<ImportedScriptRunPreparation, { status: "confirmation_required" }> {
  return {
    status: "confirmation_required",
    errors: [{
      type: "script_confirmation_required",
      message: "导入的工作流包含脚本。首次运行前请确认将执行完整脚本及其副作用。",
      retryable: true,
      details: {
        scripts: review.scripts,
        confirmationToken,
      },
    }],
  }
}

export class WorkflowPackageService {
  private readonly workflowService: WorkflowPackageServiceDeps["workflowService"]
  private readonly shareStateService?: Pick<WorkflowShareStateService, "initialize" | "getOrigin" | "findOriginByWorkflowId" | "getOrCreateExportLineage" | "prepareImport" | "prepareDelete" | "getUndoPlan" | "prepareUndo" | "commitImport" | "rollbackImport">
  private readonly providerService: Pick<ProviderService, "listProviders">
  private readonly permissionGuard: Pick<PermissionGuard, "check">
  private readonly auditSink: Pick<AuditSink, "record">
  private readonly now: () => Date
  private readonly createId: () => string
  private readonly appVersion: string
  private readonly platform: NodeJS.Platform
  private readonly loadProjects: () => Promise<readonly WorkflowShareProjectSummary[]>
  private readonly countLinkedAutomations: (workflowIds: readonly string[]) => Promise<number>
  private readonly assertCanCommit: (workflowIds: readonly string[]) => Promise<void>
  private readonly assertCanExport: (workflowIds: readonly string[]) => Promise<void>
  private readonly onCommitted: (workflowIds: readonly string[]) => void
  private readonly inspectAutomationCompatibility: NonNullable<WorkflowPackageServiceDeps["inspectAutomationCompatibility"]>
  private readonly classifyRemovedWorkflows: NonNullable<WorkflowPackageServiceDeps["classifyRemovedWorkflows"]>
  private readonly countIncompatiblePresets: NonNullable<WorkflowPackageServiceDeps["countIncompatiblePresets"]>
  private readonly inspectDeleteCandidates: NonNullable<WorkflowPackageServiceDeps["inspectDeleteCandidates"]>
  private readonly cleanupParamPresets: NonNullable<WorkflowPackageServiceDeps["cleanupParamPresets"]>
  private readonly validateDriveResource: NonNullable<WorkflowPackageServiceDeps["validateDriveResource"]>

  constructor(deps: WorkflowPackageServiceDeps) {
    this.workflowService = deps.workflowService
    this.shareStateService = deps.shareStateService
    this.providerService = deps.providerService
    this.permissionGuard = deps.permissionGuard
    this.auditSink = deps.auditSink
    this.now = deps.now ?? (() => new Date())
    this.createId = deps.createId ?? randomUUID
    this.appVersion = deps.appVersion ?? "unknown"
    this.platform = deps.platform ?? process.platform
    this.loadProjects = deps.loadProjects ?? (async () => [])
    this.countLinkedAutomations = deps.countLinkedAutomations ?? (async () => 0)
    this.assertCanCommit = deps.assertCanCommit ?? (async () => {})
    this.assertCanExport = deps.assertCanExport ?? (async () => {})
    this.onCommitted = deps.onCommitted ?? (() => {})
    this.inspectAutomationCompatibility = deps.inspectAutomationCompatibility ?? (async () => [])
    this.classifyRemovedWorkflows = deps.classifyRemovedWorkflows ?? (async (ids) => new Map(ids.map((id) => [id, "detach" as const])))
    this.countIncompatiblePresets = deps.countIncompatiblePresets ?? (async () => 0)
    this.inspectDeleteCandidates = deps.inspectDeleteCandidates ?? (async (ids) => new Map(ids.map((id) => [id, {
      name: id,
      hasReference: false,
      hasHistory: false,
    }])))
    this.cleanupParamPresets = deps.cleanupParamPresets ?? (async () => {})
    this.validateDriveResource = deps.validateDriveResource ?? (async () => {
      throw new Error("当前环境无法验证 Drive 资源，请改为映射本地文件或目录。")
    })
  }

  async initialize(): Promise<void> {
    await this.shareStateService?.initialize()
  }

  async prepareImportedScriptsForRun(
    entry: WorkflowDefinition,
    confirmationToken?: string,
    options: { readonly allowHistoricalEntry?: boolean } = {},
  ): Promise<ImportedScriptRunPreparation> {
    const storedEntry = await this.workflowService.get?.(entry.id) ?? null
    if (
      !options.allowHistoricalEntry
      && storedEntry
      && storedEntry.version !== entry.version
    ) {
      return {
        status: "version_conflict",
        errors: [{
          type: "invalid_config",
          message: "工作流已更新，请重新加载后再运行",
          retryable: true,
        }],
      }
    }
    const authoritativeEntry = options.allowHistoricalEntry ? entry : (storedEntry ?? entry)
    const collectReview = () => collectUnconfirmedImportedScripts({
      entry: authoritativeEntry,
      loadWorkflow: async (id) => this.workflowService.get?.(id) ?? null,
    })
    const review = await collectReview()
    if (review.scripts.length === 0) {
      return {
        status: "ready",
        definition: authoritativeEntry,
        snapshotDefinitions: review.snapshotDefinitions,
      }
    }
    const currentToken = importedScriptReviewToken(review)
    if (confirmationToken !== currentToken) {
      return importedScriptConfirmationRequired(review, currentToken)
    }

    const confirmedDefinitions = review.definitions.map((definition): WorkflowDefinition => ({
      ...definition,
      scriptTrust: { source: "imported", confirmed: true },
    }))
    const definitionsToPersist = options.allowHistoricalEntry
      ? confirmedDefinitions.filter((definition) => definition.id !== authoritativeEntry.id)
      : confirmedDefinitions
    const expectedRevisions = new Map(
      review.reachableRevisions
        .filter(({ workflowId }) => !options.allowHistoricalEntry || workflowId !== authoritativeEntry.id)
        .map(({ workflowId, revision }) => [workflowId, revision]),
    )
    const saved = definitionsToPersist.length === 0 && expectedRevisions.size === 0
      ? { snapshot: { next: [] as WorkflowDefinition[] } }
      : await this.workflowService.commitAtomicBatch(
          definitionsToPersist,
          [],
          expectedRevisions,
        )
    if ("errors" in saved) {
      const refreshedEntry = options.allowHistoricalEntry
        ? authoritativeEntry
        : await this.workflowService.get?.(entry.id) ?? authoritativeEntry
      const refreshedReview = await collectUnconfirmedImportedScripts({
        entry: refreshedEntry,
        loadWorkflow: async (id) => this.workflowService.get?.(id) ?? null,
      })
      if (refreshedReview.scripts.length > 0) {
        const refreshedToken = importedScriptReviewToken(refreshedReview)
        if (refreshedToken !== confirmationToken) {
          return importedScriptConfirmationRequired(refreshedReview, refreshedToken)
        }
      }
      return { status: "save_failed", errors: saved.errors }
    }
    const confirmedById = new Map(
      saved.snapshot.next.map((definition) => [definition.id, definition]),
    )
    const reviewedById = new Map(
      confirmedDefinitions.map((definition) => [definition.id, definition]),
    )
    const snapshotDefinitions = review.snapshotDefinitions.map((definition) =>
      confirmedById.get(definition.id) ?? reviewedById.get(definition.id) ?? definition)
    const definition = confirmedById.get(entry.id)
      ?? reviewedById.get(entry.id)
      ?? authoritativeEntry
    return {
      status: "ready",
      definition,
      snapshotDefinitions,
    }
  }

  async buildDeletePlan(workflowId: string): Promise<WorkflowShareDeletePlan> {
    const origin = await this.shareStateService?.findOriginByWorkflowId(workflowId)
    if (!origin) {
      return {
        workflowId,
        imported: false,
        isEntrypoint: false,
        cleanupCandidates: [],
        retainedChildren: [],
      }
    }
    const entrypointRefs = origin.entrypointRefs?.length
      ? origin.entrypointRefs
      : [Object.keys(origin.workflowIds)[0]].filter((ref): ref is string => Boolean(ref))
    const entrypointIds = new Set(entrypointRefs.map((ref) => origin.workflowIds[ref]).filter(Boolean))
    const isEntrypoint = entrypointIds.has(workflowId)
    const childIds = isEntrypoint
      ? Object.values(origin.workflowIds).filter((id) => id !== workflowId)
      : []
    const inspections = await this.inspectDeleteCandidates(childIds, Object.values(origin.workflowIds))
    const cleanupCandidates: WorkflowShareDeletePlan["cleanupCandidates"] = []
    const retainedChildren: WorkflowShareDeletePlan["retainedChildren"] = []
    for (const childId of childIds) {
      const inspection = inspections.get(childId) ?? { name: childId, hasReference: true, hasHistory: false }
      if (!inspection.hasReference && !inspection.hasHistory) {
        cleanupCandidates.push({ workflowId: childId, name: inspection.name })
      } else {
        retainedChildren.push({
          workflowId: childId,
          name: inspection.name,
          reason: inspection.hasReference ? "reference" : "history",
        })
      }
    }
    return {
      workflowId,
      imported: true,
      isEntrypoint,
      lineageId: origin.lineageId,
      cleanupCandidates,
      retainedChildren,
    }
  }

  async assertDeleteAllowed(workflowId: string): Promise<boolean> {
    const origin = await this.shareStateService?.findOriginByWorkflowId(workflowId)
    if (!origin) return false
    const inspection = (await this.inspectDeleteCandidates([workflowId], [])).get(workflowId)
    if (inspection?.hasReference) {
      throw new Error("该工作流仍被其它工作流调用，请先解除引用。")
    }
    await this.buildDeletePlan(workflowId)
    return true
  }

  async deleteImportedWorkflow(
    workflowId: string,
    cleanupImportedChildren: boolean,
  ): Promise<{ handled: boolean; workflowIds: string[] }> {
    if (!this.shareStateService) return { handled: false, workflowIds: [] }
    const origin = await this.shareStateService.findOriginByWorkflowId(workflowId)
    if (!origin) return { handled: false, workflowIds: [] }
    await this.assertDeleteAllowed(workflowId)
    const plan = await this.buildDeletePlan(workflowId)
    const removeIds = [
      workflowId,
      ...(cleanupImportedChildren ? plan.cleanupCandidates.map((item) => item.workflowId) : []),
    ]
    await this.assertCanCommit(removeIds)
    const expectedRevisions = new Map<string, string | null>()
    for (const id of removeIds) {
      const current = await this.workflowService.getExportDocument(id)
      expectedRevisions.set(id, current?.kind === "current" ? current.document.version : null)
    }
    let transaction: WorkflowShareTransactionEntryV1 | undefined
    const result = await this.workflowService.commitAtomicBatch([], removeIds, expectedRevisions, {
      beforeCommit: async (snapshot) => {
        await this.assertCanCommit(removeIds)
        const currentOrigin = await this.shareStateService!.getOrigin(origin.lineageId)
        if (!sameShareOriginSnapshot(origin, currentOrigin)) {
          throw new Error("工作流分享关系在删除确认期间发生变化，请重试。")
        }
        transaction = await this.shareStateService!.prepareDelete(
          origin.lineageId,
          removeIds,
          plan.isEntrypoint,
          snapshot,
        )
      },
      afterCommit: async () => {
        if (!transaction) throw new Error("工作流删除事务未准备。")
        await this.shareStateService!.commitImport(transaction)
      },
      rollback: async () => {
        if (transaction) await this.shareStateService!.rollbackImport(transaction)
      },
    })
    if ("errors" in result) throw new Error(result.errors[0]?.message ?? "工作流删除失败。")
    await this.cleanupParamPresets(removeIds)
    this.onCommitted(removeIds)
    return { handled: true, workflowIds: removeIds }
  }

  async buildExportPreflight(workflowId: string): Promise<WorkflowShareExportPreflight> {
    return (await this.prepareV4Export(workflowId)).preflight
  }

  async buildV4ExportArtifact(
    workflowId: string,
    shareNote?: string,
    expectedDigestSeed?: string,
  ): Promise<WorkflowShareExportArtifactV4> {
    const prepared = await this.prepareV4Export(workflowId)
    if (expectedDigestSeed !== undefined && prepared.preflight.packageDigestSeed !== expectedDigestSeed) {
      throw new Error("工作流在导出确认期间发生变化，请重新预检。")
    }
    if (prepared.preflight.blockers.length > 0) {
      throw new Error(prepared.preflight.blockers.join("\n"))
    }
    await this.assertWorkflowRevisionsUnchanged(prepared.graph.workflows)
    await this.assertCanExport(prepared.graph.workflows.map((workflow) => workflow.id))
    const artifactId = this.createId()
    const exportedAt = this.now().toISOString()
    const sourceOrigin = await this.shareStateService?.findOriginByWorkflowId(workflowId)
    const exportState = await this.shareStateService?.getOrCreateExportLineage({
      workflowId,
      createLineageId: this.createId,
      ...(sourceOrigin ? { derivedFrom: { lineageId: sourceOrigin.lineageId, artifactId: sourceOrigin.artifactId } } : {}),
    })
    const lineageId = exportState?.lineageId ?? this.createId()
    const exportWorkflows = prepared.graph.workflows.map((workflow): WorkflowDefinition => {
      const document = structuredClone(workflow)
      document.meta = { ...document.meta, schemaVersion: document.meta?.schemaVersion ?? WORKFLOW_SCHEMA_VERSION }
      return document
    })
    redactWorkflowShareSourceIdentities(
      new Map(exportWorkflows.map((workflow) => [prepared.graph.workflowRefs.get(workflow.id)!, workflow])),
      prepared.collection.references,
    )
    const workflowItems = exportWorkflows.map((workflow) => {
      const ref = prepared.graph.workflowRefs.get(workflow.id)
      if (!ref) throw new Error(`Missing workflow reference for ${workflow.id}`)
      return {
        ref,
        sourceWorkflowId: workflow.id,
        sourceRevision: workflow.version,
        schemaVersion: workflow.meta?.schemaVersion ?? WORKFLOW_SCHEMA_VERSION,
        path: `workflows/${ref}.json`,
      }
    })
    const manifest: Omit<WorkflowShareManifestV4, "files"> = {
      format: SYNAPSE_WORKFLOW_PACKAGE_FORMAT,
      formatVersion: SYNAPSE_WORKFLOW_PACKAGE_FORMAT_VERSION,
      artifactId,
      lineageId,
      exportedAt,
      createdWith: {
        appVersion: this.appVersion,
        ...(this.platform === "darwin" || this.platform === "win32" || this.platform === "linux"
          ? { platform: this.platform }
          : {}),
      },
      ...(exportState?.derivedFrom ? { derivedFrom: exportState.derivedFrom } : sourceOrigin ? { derivedFrom: { lineageId: sourceOrigin.lineageId, artifactId: sourceOrigin.artifactId } } : {}),
      shareNote: shareNote?.trim() || prepared.preflight.shareNote,
      entrypoints: prepared.graph.entrypoints,
      workflows: workflowItems,
      references: prepared.collection.references,
      requiredCapabilities: prepared.collection.requiredCapabilities,
      risks: prepared.collection.risks,
    }
    const workflows = new Map(exportWorkflows.map((workflow) => [prepared.graph.workflowRefs.get(workflow.id)!, workflow]))
    const archive = buildWorkflowShareArchive({ manifest, workflows })
    const packageData: WorkflowSharePackageV4 = {
      manifest: archive.manifest,
      workflows: Object.fromEntries(workflows),
    }
    return {
      kind: "package",
      package: packageData,
      archive: archive.bytes,
      workflowName: prepared.graph.workflows[0]?.name ?? "workflow",
      preflight: prepared.preflight,
    }
  }

  async buildExportPackage(workflowId: string): Promise<SynapseWorkflowExportPackageV3> {
    const artifact = await this.buildExportArtifact(workflowId)
    if (artifact.kind === "future-raw") {
      throw new Error(`Future workflow ${workflowId} requires raw export`)
    }
    return artifact.package
  }

  async buildExportArtifact(
    workflowId: string,
    migrationDiagnosticId?: string,
  ): Promise<WorkflowExportArtifact> {
    const exportDocument = migrationDiagnosticId
      ? await this.workflowService.getLegacyMigrationExportDocument(migrationDiagnosticId)
      : await this.workflowService.getExportDocument(workflowId)
    if (!exportDocument) throw new Error(`Workflow ${workflowId} not found`)
    if (exportDocument.kind === "future") {
      return {
        kind: "future-raw",
        document: exportDocument.document,
        sourceVersion: exportDocument.sourceVersion,
        workflowName: typeof exportDocument.document.name === "string"
          ? exportDocument.document.name
          : "workflow",
      }
    }
    const workflow = exportDocument.document
    const providers = await this.providerService.listProviders()
    return {
      kind: "package",
      workflowName: workflow.name,
      package: {
        format: PACKAGE_FORMAT,
        formatVersion: PACKAGE_FORMAT_VERSION,
        exportedAt: this.now().toISOString(),
        workflow,
        modelReferences: buildModelReferences(workflow, providers),
      },
    }
  }

  async exportToFile(options: {
    readonly workflowId: string
    readonly workflowName?: string
    readonly migrationDiagnosticId?: string
    readonly shareNote?: string
    readonly expectedDigestSeed?: string
    readonly chooseDestination: (options: WorkflowExportDestinationOptions) => Promise<string | null>
  }): Promise<WorkflowExportResult | null> {
    const exportDocument = options.migrationDiagnosticId
      ? await this.workflowService.getLegacyMigrationExportDocument(options.migrationDiagnosticId)
      : await this.workflowService.getExportDocument(options.workflowId)
    if (!exportDocument) throw new Error(`Workflow ${options.workflowId} not found`)
    const artifact = exportDocument.kind === "future"
      ? {
          kind: "future-raw" as const,
          document: exportDocument.document,
          sourceVersion: exportDocument.sourceVersion,
          workflowName: typeof exportDocument.document.name === "string" ? exportDocument.document.name : "workflow",
        }
      : await this.buildV4ExportArtifact(options.workflowId, options.shareNote, options.expectedDigestSeed)
    const isFutureRaw = artifact.kind === "future-raw"
    const safeName = normalizeContentFileNameSegment(options.workflowName || artifact.workflowName || "workflow")
    const filePath = await options.chooseDestination({
      title: isFutureRaw ? "导出未来版本工作流原文" : "导出工作流",
      defaultPath: isFutureRaw
        ? `${safeName}.synapse-workflow-future.json`
        : `${safeName}.synapse-workflow`,
    })
    if (!filePath) return null

    const action = "fs.write" as const
    const source = isFutureRaw ? "workflow.exportRawDocument" : "workflow.exportPackage"
    const permission = await this.permissionGuard.check({
      action,
      actor: { kind: "user" },
      resource: filePath,
      context: { source },
    })
    if (!permission.allowed) {
      this.auditSink.record({
        action,
        actor: { kind: "user" },
        resource: filePath,
        outcome: "denied",
        metadata: {
          source,
          reason: permission.reason,
          policyId: permission.policyId,
        },
      })
      throw new Error(permission.reason)
    }
    this.auditSink.record({
      action,
      actor: { kind: "user" },
      resource: filePath,
      outcome: "allowed",
      metadata: { source },
    })

    const content = isFutureRaw
      ? Buffer.from(`${JSON.stringify(artifact.document, null, 2)}\n`, "utf8")
      : artifact.archive
    try {
      await assertWorkflowExportDestination(filePath)
      await writeBinaryFileAtomic(filePath, content, { mode: 0o600 })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.auditSink.record({
        action,
        actor: { kind: "user" },
        resource: filePath,
        outcome: "failed",
        metadata: {
          source,
          errorName: error instanceof Error ? error.name : typeof error,
          errorLength: message.length,
        },
      })
      throw error
    }

    this.auditSink.record({
      action,
      actor: { kind: "user" },
      resource: filePath,
      outcome: "allowed",
      metadata: {
        source: isFutureRaw ? "workflow.exportRawDocument.write" : "workflow.exportPackage.write",
        workflowId: options.workflowId,
        exportKind: artifact.kind,
        ...(isFutureRaw ? { sourceVersion: artifact.sourceVersion } : {}),
      },
    })
    logger.info("workflow exported", {
      workflowId: options.workflowId,
      exportKind: artifact.kind,
      fileBase: path.basename(filePath),
    })
    return { path: filePath, kind: artifact.kind }
  }

  private async prepareV4Export(workflowId: string) {
    const graph = await collectWorkflowShareGraph({
      entryWorkflowIds: [workflowId],
      loadWorkflow: (id) => this.workflowService.getExportDocument(id),
    })
    await this.assertCanExport(graph.workflows.map((workflow) => workflow.id))
    const [providers, projects, excludedAutomationCount] = await Promise.all([
      this.providerService.listProviders(),
      this.loadProjects(),
      this.countLinkedAutomations(graph.workflows.map((workflow) => workflow.id)),
    ])
    const collection = collectWorkflowShareDependencies({
      workflows: graph.workflows,
      workflowRefs: graph.workflowRefs,
      providers,
      projects,
      excludedAutomationCount,
    })
    const root = graph.workflows[0]
    if (!root) throw new Error(`Workflow ${workflowId} not found`)
    const shareNote = buildAutomaticShareNote(root, collection.references.resources.length)
    const revisions = graph.workflows.map((workflow) => `${workflow.id}:${workflow.version}`).sort()
    const packageDigestSeed = createHash("sha256").update(JSON.stringify({
      revisions,
      entrypoints: graph.entrypoints,
      references: collection.references,
      requiredCapabilities: collection.requiredCapabilities,
      risks: collection.risks,
      blockers: collection.blockers,
    })).digest("hex")
    const preflight: WorkflowShareExportPreflight = {
      workflowId: root.id,
      workflowName: root.name,
      shareNote,
      entrypoints: graph.entrypoints,
      workflows: graph.workflows.map((workflow) => ({
        ref: graph.workflowRefs.get(workflow.id)!,
        id: workflow.id,
        name: workflow.name,
        revision: workflow.version,
        nodeCount: workflow.nodes.length,
      })),
      references: collection.references,
      requiredCapabilities: collection.requiredCapabilities,
      risks: collection.risks,
      blockers: collection.blockers,
      packageDigestSeed,
    }
    return { graph, collection, preflight }
  }

  private async assertWorkflowRevisionsUnchanged(workflows: readonly WorkflowDefinition[]): Promise<void> {
    for (const workflow of workflows) {
      const current = await this.workflowService.getExportDocument(workflow.id)
      if (!current || current.kind !== "current" || current.document.version !== workflow.version) {
        throw new Error("工作流在导出确认期间发生变化，请重新预检。")
      }
    }
  }

  async buildImportPreview(packagePath: string, pkg: SynapseWorkflowPackage, packageDigest: string): Promise<WorkflowImportPreview>
  async buildImportPreview(packagePath: string, pkg: WorkflowSharePackageV4, packageDigest: string): Promise<WorkflowShareImportPreview>
  async buildImportPreview(
    packagePath: string,
    pkg: SynapseWorkflowImportPackage,
    packageDigest: string,
  ): Promise<WorkflowImportPreview | WorkflowShareImportPreview> {
    if (isWorkflowSharePackageV4(pkg)) {
      return this.buildV4ImportPreview(packagePath, pkg, packageDigest)
    }
    const currentPackage = normalizePackage(pkg)
    const providers = await this.providerService.listProviders()
    const providerOptions = providers.map(toProviderOption)
    logger.info("workflow package import preview built", {
      sourceWorkflowId: currentPackage.workflow.id,
      fileBase: packagePath.split(/[\\/]/).pop() ?? packagePath,
      modelReferenceCount: currentPackage.modelReferences.length,
      providerOptionCount: providerOptions.length,
      nodeCount: currentPackage.workflow.nodes.length,
    })
    return {
      packagePath,
      packageDigest,
      workflow: {
        id: currentPackage.workflow.id,
        name: currentPackage.workflow.name,
        nodeCount: currentPackage.workflow.nodes.length,
        modelReferenceCount: currentPackage.modelReferences.length,
        requiresProjectMapping: workflowNeedsProjectMapping(currentPackage.workflow),
      },
      modelReferences: currentPackage.modelReferences,
      providerOptions,
      suggestedMappings: suggestMappings(currentPackage.modelReferences, providerOptions),
    }
  }

  async adaptLegacyPackageToV4(
    pkg: SynapseWorkflowPackage,
    packageDigest: string,
  ): Promise<WorkflowSharePackageV4> {
    const currentPackage = normalizePackage(pkg)
    const workflow = currentPackage.workflow
    if (workflowChildIds(workflow).length > 0) {
      throw new Error("旧格式工作流包未包含子工作流，不能完整复现；请让分享者使用新版重新导出。")
    }
    const ref = stableWorkflowReference(workflow.id)
    const collection = collectWorkflowShareDependencies({
      workflows: [workflow],
      workflowRefs: new Map([[workflow.id, ref]]),
      providers: [],
      projects: [],
      excludedAutomationCount: 0,
    })
    const models = enrichLegacyModelReferences(collection.references.models, currentPackage.modelReferences)
    const bodyBytes = Buffer.from(`${JSON.stringify(workflow, null, 2)}\n`, "utf8")
    const digestValue = createHash("sha256").update(packageDigest).digest("hex")
    const lineageValue = createHash("sha256").update(`legacy-workflow\u0000${workflow.id}`).digest("hex")
    const workflowItem = {
      ref,
      sourceWorkflowId: workflow.id,
      sourceRevision: workflow.version,
      schemaVersion: workflow.meta?.schemaVersion ?? WORKFLOW_SCHEMA_VERSION,
      path: `workflows/${ref}.json`,
    }
    return {
      manifest: {
        format: SYNAPSE_WORKFLOW_PACKAGE_FORMAT,
        formatVersion: SYNAPSE_WORKFLOW_PACKAGE_FORMAT_VERSION,
        artifactId: `legacy_${digestValue}`,
        lineageId: `legacy_${lineageValue}`,
        exportedAt: currentPackage.exportedAt,
        createdWith: { appVersion: "legacy-adapter" },
        shareNote: workflow.description?.trim() || workflow.name,
        entrypoints: [ref],
        workflows: [workflowItem],
        references: { ...collection.references, models },
        requiredCapabilities: collection.requiredCapabilities,
        risks: collection.risks,
        files: [{
          path: workflowItem.path,
          size: bodyBytes.length,
          sha256: createHash("sha256").update(bodyBytes).digest("hex"),
          mediaType: "application/vnd.synapse.workflow+json",
        }],
        extensions: { legacyFormat: currentPackage.format },
      },
      workflows: { [ref]: workflow },
    }
  }

  private async buildV4ImportPreview(
    packagePath: string,
    pkg: WorkflowSharePackageV4,
    packageDigest: string,
  ): Promise<WorkflowShareImportPreview> {
    const providers = await this.providerService.listProviders()
    const providerOptions = providers.map(toProviderOption)
    const projects = await this.loadProjects()
    const workflows = Object.fromEntries(Object.entries(pkg.workflows).map(([ref, workflow]) => [
      ref,
      migrateWorkflowDocumentOrThrow(workflow),
    ]))
    validateWorkflowSharePackageGraph({ manifest: pkg.manifest, workflows })
    const runtimeCapabilities = this.platform === "win32"
      ? [
          { id: "runtime.shell.cmd", minVersion: "1.0.0" },
          { id: "runtime.shell.powershell", minVersion: "1.0.0" },
        ]
      : [{ id: "runtime.shell.posix", minVersion: "1.0.0" }]
    const capabilitySupport = checkWorkflowShareCapabilities(
      pkg.manifest.requiredCapabilities,
      installedWorkflowShareCapabilities(runtimeCapabilities),
    )
    const origin = await this.shareStateService?.getOrigin(pkg.manifest.lineageId)
    const modelSuggestions = mergeMappingsByReference(
      pkg.manifest.references.models,
      origin?.selections.models ?? [],
      suggestV4ModelMappings(pkg.manifest.references.models, providerOptions),
    )
    const inferredProjectSuggestions = pkg.manifest.references.projects.flatMap((reference) => {
      const candidates = reference.gitRemoteFingerprint
        ? projects.filter((project) => project.gitRemoteFingerprint === reference.gitRemoteFingerprint)
        : projects.filter((project) => (
            project.name === reference.sourceProjectName
            && (!reference.sourceProjectType || project.type === reference.sourceProjectType)
          ))
      return candidates.length === 1 ? [{ sourceRefId: reference.id, targetProjectId: candidates[0].id }] : []
    })
    const projectSuggestions = mergeMappingsByReference(
      pkg.manifest.references.projects,
      origin?.selections.projects ?? [],
      inferredProjectSuggestions,
    )
    const accessibleDriveCandidates = await Promise.all(pkg.manifest.references.resources.map(async (reference) => {
      if (reference.kind !== "drive" || !reference.driveId) return null
      const target = {
        kind: "drive" as const,
        id: reference.driveId,
        ...(reference.driveVersionId ? { versionId: reference.driveVersionId } : {}),
      }
      try {
        await this.validateDriveResource(target, reference)
        return { sourceRefId: reference.id, target }
      } catch {
        return null
      }
    }))
    const accessibleDriveSuggestions: WorkflowShareResourceMapping[] = []
    for (const mapping of accessibleDriveCandidates) {
      if (mapping) accessibleDriveSuggestions.push(mapping)
    }
    const sourceRevisions = Object.fromEntries(pkg.manifest.workflows.map((item) => [item.ref, item.sourceRevision]))
    const originTargetExistence = new Map<string, boolean>()
    if (origin) {
      await Promise.all(Object.entries(origin.workflowIds).map(async ([ref, workflowId]) => {
        const current = await this.workflowService.getExportDocument(workflowId)
        originTargetExistence.set(ref, current?.kind === "current")
      }))
    }
    const revisionsMatch = Boolean(origin && (
      origin.artifactId === pkg.manifest.artifactId
      || sameStringRecord(origin.sourceRevisions, sourceRevisions)
    ))
    const allOriginTargetsExist = Boolean(origin && Object.keys(origin.workflowIds).every((ref) => originTargetExistence.get(ref)))
    const isDuplicate = revisionsMatch && allOriginTargetsExist
    const isUpdate = Boolean(origin && Array.from(originTargetExistence.values()).some(Boolean) && !isDuplicate)
    const content = pkg.manifest.workflows.map((item) => ({
      ref: item.ref,
      name: workflows[item.ref]?.name ?? item.sourceWorkflowId,
      nodeCount: workflows[item.ref]?.nodes.length ?? 0,
      sourceRevision: item.sourceRevision,
      action: isDuplicate
        ? "keep" as const
        : originTargetExistence.get(item.ref)
          ? "update" as const
          : "create" as const,
      ...(origin?.workflowIds[item.ref] ? { targetWorkflowId: origin.workflowIds[item.ref] } : {}),
    }))
    const removedEntries = origin
      ? Object.entries(origin.workflowIds).filter(([ref]) => !(ref in sourceRevisions))
      : []
    const removedActions = await this.classifyRemovedWorkflows(
      removedEntries.map(([, targetWorkflowId]) => targetWorkflowId),
      Object.values(origin?.workflowIds ?? {}),
    )
    const removedNames = new Map(await Promise.all(removedEntries.map(async ([, targetWorkflowId]) => {
      const current = await this.workflowService.getExportDocument(targetWorkflowId)
      return [targetWorkflowId, current?.kind === "current" ? current.document.name : targetWorkflowId] as const
    })))
    const removedContent = removedEntries.map(([ref, targetWorkflowId]) => ({
            ref,
            name: removedNames.get(targetWorkflowId) ?? targetWorkflowId,
            nodeCount: 0,
            sourceRevision: origin?.sourceRevisions[ref] ?? "",
            action: removedActions.get(targetWorkflowId) ?? "detach" as const,
            targetWorkflowId,
          }))
    const targetDefinitions = origin ? pkg.manifest.workflows.flatMap((item) => {
      const definition = workflows[item.ref]
      const targetId = origin.workflowIds[item.ref]
      return definition && targetId ? [{ ...definition, id: targetId }] : []
    }) : []
    const automationUpdates = await this.inspectAutomationCompatibility(targetDefinitions)
    const incompatiblePresetCount = await this.countIncompatiblePresets(targetDefinitions)
    return {
      packagePath,
      packageDigest,
      formatVersion: pkg.manifest.formatVersion,
      artifactId: pkg.manifest.artifactId,
      lineageId: pkg.manifest.lineageId,
      shareNote: pkg.manifest.shareNote,
      sourceVerified: false,
      mode: isDuplicate ? "duplicate" : isUpdate ? "update" : "create",
      content: { entrypoints: pkg.manifest.entrypoints, workflows: [...content, ...removedContent] },
      compatibility: {
        supported: isDuplicate || capabilitySupport.supported,
        issues: isDuplicate ? [] : capabilitySupport.issues,
        requiredCapabilities: pkg.manifest.requiredCapabilities,
        sensitiveLocations: pkg.manifest.risks.sensitiveLocations,
        highRiskLocations: pkg.manifest.risks.highRiskLocations,
        portabilityWarnings: pkg.manifest.risks.portabilityWarnings,
        excludedAutomationCount: pkg.manifest.risks.excludedAutomationCount,
        automationUpdates,
      },
      mappings: {
        models: pkg.manifest.references.models,
        projects: pkg.manifest.references.projects,
        resources: pkg.manifest.references.resources,
        environments: pkg.manifest.references.environments,
      },
      providerOptions,
      projectOptions: projects.map((project) => ({ id: project.id, name: project.name, type: project.type })),
      suggestions: {
        models: modelSuggestions,
        projects: projectSuggestions,
        resources: mergeMappingsByReference(
          pkg.manifest.references.resources,
          origin?.selections.resources ?? [],
          accessibleDriveSuggestions,
        ),
        environments: mergeMappingsByReference(pkg.manifest.references.environments, origin?.selections.environments ?? [], []),
      },
      summary: {
        createCount: content.filter((item) => item.action === "create").length,
        updateCount: content.filter((item) => item.action === "update").length,
        deleteCount: removedContent.filter((item) => item.action === "delete").length,
        detachCount: removedContent.filter((item) => item.action === "detach").length,
        preserveRunHistory: true,
        undoAvailable: !isDuplicate && Boolean(this.shareStateService),
        transactionalBackup: !isDuplicate && Boolean(this.shareStateService),
        incompatiblePresetCount,
      },
    }
  }

  async importPackage(
    pkg: SynapseWorkflowPackage,
    mappings: readonly WorkflowModelMapping[],
    options: WorkflowImportOptions = {},
  ): Promise<{ workflowId: string; versionHash: string } | WorkflowSaveError> {
    const currentPackage = normalizePackage(pkg)
    const providers = await this.providerService.listProviders()
    const providerIds = new Set(providers.map((provider) => provider.id))
    const mappingByRef = new Map(mappings.map((mapping) => [mapping.sourceRefId, mapping]))
    const importLogBase = {
      sourceWorkflowId: currentPackage.workflow.id,
      modelReferenceCount: currentPackage.modelReferences.length,
      mappingCount: mappings.length,
    }

    for (const ref of currentPackage.modelReferences) {
      const mapping = mappingByRef.get(ref.id)
      if (!mapping) {
        logger.warn("workflow package import missing model mapping", { ...importLogBase, sourceRefId: ref.id })
        throw new Error(`Missing model mapping for ${ref.id}`)
      }
      if (!providerIds.has(mapping.targetProviderId)) {
        logger.warn("workflow package import unknown target provider", { ...importLogBase, sourceRefId: ref.id, targetProviderId: mapping.targetProviderId })
        throw new Error(`Unknown target provider ${mapping.targetProviderId}`)
      }
      if (!MODEL_TIERS.includes(mapping.targetModelTier)) {
        logger.warn("workflow package import invalid target model tier", { ...importLogBase, sourceRefId: ref.id, targetModelTier: mapping.targetModelTier })
        throw new Error(`Invalid target model tier ${mapping.targetModelTier}`)
      }
    }

    if (workflowNeedsProjectMapping(currentPackage.workflow) && !options.targetProjectId?.trim()) {
      return {
        errors: [{
          type: "invalid_config",
          field: "defaultProjectId",
          message: "请选择项目。",
          retryable: true,
        }],
      }
    }

    const imported = markImportedScriptTrust(
      rewriteWorkflowForImport(currentPackage.workflow, currentPackage.modelReferences, mappingByRef, this.createId(), this.now().getTime(), options),
    )
    const saveResult = await this.workflowService.save(imported)
    if ("errors" in saveResult) {
      logger.warn("workflow package import blocked by validation", {
        ...importLogBase,
        workflowId: imported.id,
        errorCount: saveResult.errors.length,
        errors: saveResult.errors,
      })
      return saveResult
    }
    logger.info("workflow package import succeeded", {
      ...importLogBase,
      workflowId: imported.id,
      nodeCount: imported.nodes.length,
      versionHash: saveResult.versionHash,
    })
    return { workflowId: imported.id, versionHash: saveResult.versionHash }
  }

  async importV4Package(
    pkg: WorkflowSharePackageV4,
    selections: WorkflowShareImportSelections,
    packageDigest: string,
  ): Promise<{
    workflowId: string
    workflowIds: string[]
    versionHash: string
    mutated: boolean
    undoCreated: boolean
  } | WorkflowSaveError> {
    if (!packageDigest.trim()) throw new Error("导入预检已失效，请重新选择文件。")
    const currentPackage: WorkflowSharePackageV4 = {
      manifest: pkg.manifest,
      workflows: Object.fromEntries(Object.entries(pkg.workflows).map(([ref, workflow]) => [
        ref,
        migrateWorkflowDocumentOrThrow(workflow),
      ])),
    }
    validateWorkflowSharePackageGraph(currentPackage)
    const origin = await this.shareStateService?.getOrigin(currentPackage.manifest.lineageId)
    const sourceRevisions = Object.fromEntries(currentPackage.manifest.workflows.map((item) => [item.ref, item.sourceRevision]))
    if (origin && (origin.artifactId === currentPackage.manifest.artifactId || sameStringRecord(origin.sourceRevisions, sourceRevisions))) {
      const workflowId = origin.workflowIds[currentPackage.manifest.entrypoints[0]]
      if (!workflowId) throw new Error("已导入记录缺少入口工作流。")
      const currentEntries = await Promise.all(Object.values(origin.workflowIds).map((id) => this.workflowService.getExportDocument(id)))
      if (currentEntries.every((entry) => entry?.kind === "current")) {
        const current = currentEntries.find((entry) => entry?.kind === "current" && entry.document.id === workflowId)
        if (!current || current.kind !== "current") throw new Error("已导入记录缺少入口工作流。")
        return {
          workflowId,
          workflowIds: Object.values(origin.workflowIds),
          versionHash: current.document.version,
          mutated: false,
          undoCreated: false,
        }
      }
    }
    await assertWorkflowShareResourceMappings(currentPackage.manifest, selections, this.validateDriveResource)
    await assertWorkflowShareEnvironmentMappings(currentPackage.manifest, selections)
    const providers = await this.providerService.listProviders()
    const providerIds = new Set(providers.map((provider) => provider.id))
    const projects = await this.loadProjects()
    const projectIds = new Set(projects.map((project) => project.id))
    for (const mapping of selections.models) {
      if (mapping.action !== "map" || !mapping.targetProviderId) continue
      if (!providerIds.has(mapping.targetProviderId)) throw new Error(`Unknown target provider ${mapping.targetProviderId}`)
      if (!mapping.targetModelTier || !MODEL_TIERS.includes(mapping.targetModelTier)) {
        throw new Error(`Invalid target model tier ${mapping.targetModelTier ?? ""}`)
      }
    }
    for (const mapping of selections.projects) {
      if (!projectIds.has(mapping.targetProjectId)) throw new Error(`Unknown target project ${mapping.targetProjectId}`)
    }
    const capabilitySupport = checkWorkflowShareCapabilities(
      currentPackage.manifest.requiredCapabilities,
      installedWorkflowShareCapabilities(this.platform === "win32"
        ? [
            { id: "runtime.shell.cmd", minVersion: "1.0.0" },
            { id: "runtime.shell.powershell", minVersion: "1.0.0" },
          ]
        : [{ id: "runtime.shell.posix", minVersion: "1.0.0" }]),
    )
    if (!capabilitySupport.supported) throw new Error(capabilitySupport.issues.join("\n"))

    const existingTargetIds = origin ? new Map(Object.entries(origin.workflowIds)) : undefined
    const rewritten = rewriteWorkflowSharePackage({
      package: currentPackage,
      selections,
      createId: this.createId,
      now: this.now().getTime(),
      existingTargetIds,
    })
    const workflowId = rewritten.entrypointIds[0]
    if (!workflowId) throw new Error("工作流分享包没有入口工作流。")
    await this.assertCanCommit(rewritten.definitions.map((definition) => definition.id))
    const automationUpdates = await this.inspectAutomationCompatibility(rewritten.definitions)
    const removedWorkflowIds = origin
      ? Object.entries(origin.workflowIds).filter(([ref]) => !(ref in sourceRevisions)).map(([, id]) => id)
      : []
    const removedActions = await this.classifyRemovedWorkflows(removedWorkflowIds, Object.values(origin?.workflowIds ?? {}))
    const removeIds = removedWorkflowIds.filter((id) => removedActions.get(id) === "delete")
    const expectedRevisions = new Map<string, string | null>()
    for (const definition of rewritten.definitions) {
      const existingRef = Array.from(rewritten.targetIds.entries()).find(([, id]) => id === definition.id)?.[0]
      const expected = existingRef ? origin?.workflowIds[existingRef] : undefined
      if (!expected) expectedRevisions.set(definition.id, null)
      else {
        const current = await this.workflowService.getExportDocument(definition.id)
        expectedRevisions.set(definition.id, current?.kind === "current" ? current.document.version : null)
      }
    }
    for (const id of removeIds) {
      const current = await this.workflowService.getExportDocument(id)
      expectedRevisions.set(id, current?.kind === "current" ? current.document.version : null)
    }
    let transaction: WorkflowShareTransactionEntryV1 | undefined
    const workflowIds = Object.fromEntries(rewritten.targetIds)
    const importedDefinitions = rewritten.definitions.map(markImportedScriptTrust)
    const batchResult = await this.workflowService.commitAtomicBatch(
      importedDefinitions,
      removeIds,
      expectedRevisions,
      this.shareStateService ? {
        beforeCommit: async (snapshot: WorkflowAtomicBatchSnapshot) => {
          await this.assertCanCommit(rewritten.definitions.map((definition) => definition.id))
          const currentOrigin = await this.shareStateService!.getOrigin(currentPackage.manifest.lineageId)
          if (!sameShareOriginSnapshot(origin ?? null, currentOrigin)) {
            throw new Error("工作流导入计划已变化，请重新预检。")
          }
          transaction = await this.shareStateService!.prepareImport({
            lineageId: currentPackage.manifest.lineageId,
            artifactId: currentPackage.manifest.artifactId,
            packageDigest,
            sourceRevisions,
            workflowIds,
            entrypointRefs: currentPackage.manifest.entrypoints,
            selections,
            nextRemoveIds: removeIds,
            automationChanges: automationUpdates.map((item) => ({ id: item.id, enabled: false })),
          }, snapshot)
        },
        afterCommit: async () => {
          if (!transaction) throw new Error("工作流分享事务未准备。")
          await this.shareStateService!.commitImport(transaction)
        },
        rollback: async () => {
          if (transaction) await this.shareStateService!.rollbackImport(transaction)
        },
      } : {},
    )
    if ("errors" in batchResult) return batchResult
    this.onCommitted(importedDefinitions.map((definition) => definition.id))
    return {
      workflowId,
      workflowIds: importedDefinitions.map((definition) => definition.id),
      versionHash: batchResult.versions.get(workflowId) ?? "",
      mutated: true,
      undoCreated: Boolean(this.shareStateService),
    }
  }

  async undoV4Import(lineageId: string): Promise<{ workflowIds: string[] }> {
    if (!this.shareStateService) throw new Error("工作流分享状态服务不可用。")
    const undo = await this.shareStateService.getUndoPlan(lineageId)
    if (!undo) throw new Error("没有可撤销的工作流更新。")
    for (const [workflowId, expectedRevision] of Object.entries(undo.expectedRevisions)) {
      const current = await this.workflowService.getExportDocument(workflowId)
      if (!current || current.kind !== "current" || current.document.version !== expectedRevision) {
        throw new Error("工作流在导入后已被修改，不能再撤销这次更新。")
      }
    }
    const affectedIds = [...new Set([
      ...Object.keys(undo.expectedRevisions),
      ...undo.previousWorkflows.map((workflow) => workflow.id),
      ...undo.removeOnUndoIds,
    ])]
    await this.assertCanCommit(affectedIds)
    const expectedRevisions = new Map<string, string | null>()
    for (const workflow of undo.previousWorkflows) {
      expectedRevisions.set(workflow.id, undo.expectedRevisions[workflow.id] ?? null)
    }
    for (const workflowId of undo.removeOnUndoIds) {
      const expectedRevision = undo.expectedRevisions[workflowId]
      if (!expectedRevision) throw new Error("撤销记录缺少工作流修订。")
      expectedRevisions.set(workflowId, expectedRevision)
    }
    let transaction: WorkflowShareTransactionEntryV1 | undefined
    const result = await this.workflowService.commitAtomicBatch(
      undo.previousWorkflows,
      undo.removeOnUndoIds,
      expectedRevisions,
      {
        beforeCommit: async (snapshot) => {
          await this.assertCanCommit(affectedIds)
          const currentUndo = await this.shareStateService!.getUndoPlan(lineageId)
          if (!currentUndo || currentUndo.createdAt !== undo.createdAt) {
            throw new Error("工作流撤销点已变化，请重试。")
          }
          transaction = await this.shareStateService!.prepareUndo(lineageId, undo, snapshot)
        },
        afterCommit: async () => {
          if (!transaction) throw new Error("工作流撤销事务未准备。")
          await this.shareStateService!.commitImport(transaction)
        },
        rollback: async () => {
          if (transaction) await this.shareStateService!.rollbackImport(transaction)
        },
      },
    )
    if ("errors" in result) throw new Error(result.errors[0]?.message ?? "撤销工作流更新失败。")
    this.onCommitted(affectedIds)
    return { workflowIds: affectedIds }
  }
}

async function assertWorkflowExportDestination(filePath: string): Promise<void> {
  try {
    const target = await lstat(filePath)
    if (target.isSymbolicLink()) throw new Error("工作流导出文件不能是符号链接。")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return
    throw error
  }
}

async function assertWorkflowShareResourceMappings(
  manifest: WorkflowShareManifestV4,
  selections: WorkflowShareImportSelections,
  validateDriveResource: NonNullable<WorkflowPackageServiceDeps["validateDriveResource"]>,
): Promise<void> {
  const mappings = new Map(selections.resources.map((mapping) => [mapping.sourceRefId, mapping]))
  for (const reference of manifest.references.resources) {
    const mapping = mappings.get(reference.id)
    if (!mapping) continue
    if (mapping.target.kind === "drive") {
      await validateDriveResource(mapping.target, reference)
      continue
    }
    const targetPath = mapping.target.path.trim()
    if (!targetPath) throw new Error(`资源映射缺少本地路径：${reference.displayName ?? reference.id}`)
    let target
    try {
      target = await lstat(targetPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(`映射的本地资源不存在：${reference.displayName ?? targetPath}`, { cause: error })
      }
      throw error
    }
    if (target.isSymbolicLink()) {
      throw new Error(`映射的本地资源不能是符号链接：${reference.displayName ?? targetPath}`)
    }
    const matchesEntryType = reference.entryType === "file" ? target.isFile() : target.isDirectory()
    if (!matchesEntryType) {
      throw new Error(`映射的资源类型不匹配：${reference.displayName ?? targetPath}`)
    }
  }
}

async function assertWorkflowShareEnvironmentMappings(
  manifest: WorkflowShareManifestV4,
  selections: WorkflowShareImportSelections,
): Promise<void> {
  const mappings = new Map(selections.environments.map((mapping) => [mapping.sourceRefId, mapping]))
  for (const reference of manifest.references.environments) {
    if (reference.kind !== "codex.profile") continue
    const mapping = mappings.get(reference.id)
    if (!mapping || mapping.action === "local-default") continue
    const profile = (mapping.action === "replace" ? mapping.targetValue : reference.sourceValue)?.trim()
    if (!profile) throw new Error(`Codex Profile 映射不完整：${reference.id}`)
    if (!await codexProfileExists(profile)) throw new Error(`本机不存在 Codex Profile：${profile}`)
  }
}

async function codexProfileExists(profile: string): Promise<boolean> {
  let content: string
  try {
    content = await readFile(path.join(resolveCodexHomePath(), "config.toml"), "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false
    throw error
  }
  for (const line of content.split(/\r?\n/)) {
    const match = /^\s*\[\s*profiles\.(?:"((?:\\.|[^"\\])*)"|'([^']*)'|([A-Za-z0-9_-]+))\s*]\s*(?:#.*)?$/.exec(line)
    if (!match) continue
    const parsed = match[1] !== undefined
      ? JSON.parse(`"${match[1]}"`) as string
      : match[2] ?? match[3]
    if (parsed === profile) return true
  }
  return false
}

function resolveCodexHomePath(): string {
  const configuredPath = process.env.CODEX_HOME?.trim()
  if (!configuredPath) return path.join(os.homedir(), ".codex")
  if (configuredPath === "~") return os.homedir()
  if (configuredPath.startsWith(`~${path.sep}`)) {
    return path.resolve(os.homedir(), configuredPath.slice(2))
  }
  return path.resolve(configuredPath)
}

function buildAutomaticShareNote(workflow: WorkflowDefinition, externalResourceCount: number): string {
  const lines = [workflow.description?.trim() || workflow.name]
  if (workflow.params.length > 0) lines.push(`运行参数：${workflow.params.map((param) => param.name).join("、")}`)
  if (externalResourceCount > 0) lines.push(`外部资源：${externalResourceCount} 项，需在导入时映射`)
  return lines.join("\n")
}

function redactWorkflowShareSourceIdentities(
  workflows: ReadonlyMap<string, WorkflowDefinition>,
  references: WorkflowShareManifestV4["references"],
): void {
  const redact = (referenceId: string, itemOccurrence: WorkflowShareManifestV4["references"]["models"][number]["occurrences"][number]) => {
    if (itemOccurrence.inherited) return
    const workflow = workflows.get(itemOccurrence.workflowRef)
    if (!workflow) throw new Error(`找不到工作流分享引用位置：${itemOccurrence.workflowRef}`)
    const root = itemOccurrence.nodeId
      ? workflow.nodes.find((node) => node.id === itemOccurrence.nodeId)?.config
      : workflow
    if (!root) throw new Error(`找不到工作流分享节点：${itemOccurrence.nodeId ?? "workflow"}`)
    replaceShareValueAtPath(root, itemOccurrence.fieldPath, `synapse-share-ref:${referenceId}`)
  }
  for (const reference of references.models) {
    reference.occurrences.forEach((itemOccurrence) => redact(reference.id, itemOccurrence))
  }
  for (const reference of references.projects) {
    reference.occurrences.forEach((itemOccurrence) => redact(reference.id, itemOccurrence))
  }
  for (const reference of references.environments) {
    reference.occurrences.forEach((itemOccurrence) => redact(reference.id, itemOccurrence))
  }
  for (const reference of references.resources) {
    for (const itemOccurrence of reference.occurrences) {
      const workflow = workflows.get(itemOccurrence.workflowRef)
      if (!workflow) throw new Error(`找不到工作流分享引用位置：${itemOccurrence.workflowRef}`)
      const root = itemOccurrence.nodeId
        ? workflow.nodes.find((node) => node.id === itemOccurrence.nodeId)?.config
        : workflow
      if (!root) throw new Error(`找不到工作流分享节点：${itemOccurrence.nodeId ?? "workflow"}`)
      const marker = `synapse-share-ref:${reference.id}`
      const current = valueAtPath(root, itemOccurrence.fieldPath)
      if (isRecordValue(current) && current.kind === "local_path") {
        replaceShareValueAtPath(root, itemOccurrence.fieldPath, { ...current, path: marker })
      } else if (isRecordValue(current) && current.kind === "staged") {
        replaceShareValueAtPath(root, itemOccurrence.fieldPath, { ...current, id: marker })
      } else if (isRecordValue(current) && (current.kind === "drive" || current.kind === "inline_file")) {
        continue
      } else {
        replaceShareValueAtPath(root, itemOccurrence.fieldPath, marker)
      }
    }
  }
}

function valueAtPath(root: unknown, fieldPath: readonly (string | number)[]): unknown {
  let current = root
  for (const segment of fieldPath) {
    if (!isRecordValue(current) && !Array.isArray(current)) return undefined
    current = (current as Record<string | number, unknown>)[segment]
  }
  return current
}

function replaceShareValueAtPath(root: unknown, fieldPath: readonly (string | number)[], value: unknown): void {
  if (fieldPath.length === 0) throw new Error("工作流分享引用位置不能为空。")
  let current = root as Record<string | number, unknown>
  for (const segment of fieldPath.slice(0, -1)) {
    const next = current[segment]
    if (!isRecordValue(next) && !Array.isArray(next)) throw new Error("工作流分享引用位置不存在。")
    current = next as Record<string | number, unknown>
  }
  current[fieldPath[fieldPath.length - 1]] = value
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function buildModelReferences(workflow: WorkflowDefinition, providers: readonly CCProvider[]): WorkflowModelReference[] {
  const providerById = new Map(providers.map((provider) => [provider.id, provider]))
  const refs = new Map<string, WorkflowModelReference>()

  function add(
    providerId: string | undefined,
    tier: WorkflowPackageModelTier,
    occurrence: WorkflowModelReference["occurrences"][number],
  ) {
    if (!providerId) return
    const provider = providerById.get(providerId)
    const modelName = provider ? modelNameForTier(provider, tier) : undefined
    const key = `${providerId}\u0000${tier}\u0000${modelName ?? ""}`
    const existing = refs.get(key)
    if (existing) {
      existing.occurrences.push(occurrence)
      return
    }
    refs.set(key, {
      id: `model-ref-${refs.size + 1}`,
      sourceProviderId: providerId,
      sourceProviderName: provider?.name,
      sourceModelTier: tier,
      sourceModelName: modelName,
      ...(provider ? {} : { missingOnExporter: true }),
      occurrences: [occurrence],
    })
  }

  const defaultTier = workflow.defaultModelTier ?? "default"
  let workflowDefaultReferenced = false
  const addWorkflowDefaultReference = () => {
    if (workflowDefaultReferenced) return
    workflowDefaultReferenced = true
    add(workflow.defaultProviderId, defaultTier, { kind: "workflowDefault" })
  }

  for (const node of workflow.nodes) {
    if (!isModelNode(node)) continue
    const config = node.config as { providerId?: unknown; modelTier?: unknown }
    const explicitProviderId = typeof config.providerId === "string" && config.providerId.length > 0 ? config.providerId : undefined
    const explicitTier = isModelTier(config.modelTier) ? config.modelTier : "default"
    if (explicitProviderId) {
      add(explicitProviderId, explicitTier, modelNodeOccurrence(node, false))
    } else if (workflow.defaultProviderId) {
      addWorkflowDefaultReference()
      add(workflow.defaultProviderId, defaultTier, modelNodeOccurrence(node, true))
    }
  }

  return Array.from(refs.values())
}

function rewriteWorkflowForImport(
  workflow: WorkflowDefinition,
  refs: readonly WorkflowModelReference[],
  mappingByRef: ReadonlyMap<string, WorkflowModelMapping>,
  id: string,
  timestamp: number,
  options: WorkflowImportOptions,
): WorkflowDefinition {
  let next: WorkflowDefinition = {
    ...workflow,
    id,
    version: "",
    createdAt: timestamp,
    updatedAt: timestamp,
    defaultProjectId: workflowNeedsProjectMapping(workflow) ? options.targetProjectId : undefined,
    nodes: workflow.nodes.map((node) => ({ ...node, config: { ...node.config } })),
    edges: workflow.edges.map((edge) => ({ ...edge })),
    params: workflow.params.map((param) => ({ ...param })),
  }

  for (const ref of refs) {
    const mapping = mappingByRef.get(ref.id)
    if (!mapping) continue
    for (const occurrence of ref.occurrences) {
      if (occurrence.kind === "workflowDefault") {
        next = { ...next, defaultProviderId: mapping.targetProviderId, defaultModelTier: mapping.targetModelTier }
      } else if (!occurrence.inherited) {
        next = {
          ...next,
          nodes: next.nodes.map((node) =>
            node.id === occurrence.nodeId
              ? { ...node, config: { ...node.config, providerId: mapping.targetProviderId, modelTier: mapping.targetModelTier } }
              : node,
          ),
        }
      }
    }
  }

  next = {
    ...next,
    nodes: next.nodes.map((node) =>
      isProjectBoundNode(node)
        ? { ...node, config: withoutProjectId(node.config) }
        : node,
    ),
  }

  return next
}

export function markImportedScriptTrust(definition: WorkflowDefinition): WorkflowDefinition {
  return {
    ...definition,
    scriptTrust: {
      source: "imported",
      confirmed: false,
    },
  }
}

function workflowNeedsProjectMapping(workflow: WorkflowDefinition): boolean {
  return workflow.nodes.some(isProjectBoundNode)
}

function withoutProjectId(config: WorkflowNode["config"]): WorkflowNode["config"] {
  const rest = { ...(config as Record<string, unknown>) }
  delete rest.projectId
  return rest
}

function modelNodeOccurrence(node: WorkflowNode, inherited: boolean): WorkflowModelReference["occurrences"][number] {
  return { kind: "node", nodeId: node.id, nodeName: node.name, nodeType: node.type, inherited }
}

function isModelNode(node: WorkflowNode): boolean {
  return node.type === "prompt" || node.type === "switch"
}

function isProjectBoundNode(node: WorkflowNode): boolean {
  return isModelNode(node) || node.type === "codex" || node.type === "claude_code" || node.type === "script"
}

function isModelTier(value: unknown): value is WorkflowPackageModelTier {
  return typeof value === "string" && MODEL_TIERS.includes(value as WorkflowPackageModelTier)
}

function modelNameForTier(provider: CCProvider, tier: WorkflowPackageModelTier): string | undefined {
  if (tier === "haiku") return provider.haikuModel ?? provider.model
  if (tier === "sonnet") return provider.sonnetModel ?? provider.model
  if (tier === "opus") return provider.opusModel ?? provider.model
  return provider.model
}

function toProviderOption(provider: CCProvider): WorkflowImportProviderOption {
  return {
    providerId: provider.id,
    providerName: provider.name,
    active: provider.active,
    models: {
      default: provider.model,
      haiku: provider.haikuModel ?? provider.model,
      sonnet: provider.sonnetModel ?? provider.model,
      opus: provider.opusModel ?? provider.model,
    },
  }
}

function suggestMappings(
  refs: readonly WorkflowModelReference[],
  providers: readonly WorkflowImportProviderOption[],
): WorkflowModelMapping[] {
  const active = providers.find((provider) => provider.active) ?? providers[0]
  if (!active) return []
  return refs.map((ref) => {
    const byProviderName = providers.find((provider) => provider.providerName === ref.sourceProviderName)
    const byModelName = providers.find((provider) =>
      Object.values(provider.models).some((model) => model && model === ref.sourceModelName),
    )
    const target = byProviderName ?? byModelName ?? active
    return {
      sourceRefId: ref.id,
      targetProviderId: target.providerId,
      targetModelTier: ref.sourceModelTier,
    }
  })
}

function suggestV4ModelMappings(
  refs: WorkflowShareManifestV4["references"]["models"],
  providers: readonly WorkflowImportProviderOption[],
): WorkflowShareModelMapping[] {
  return refs.flatMap((ref) => {
    if (ref.environment !== "synapse" || !ref.sourceModelName) return []
    const matches = providers.flatMap((provider) => MODEL_TIERS.flatMap((tier) => (
      provider.models[tier] === ref.sourceModelName
        ? [{ providerId: provider.providerId, tier }]
        : []
    )))
    if (matches.length !== 1) return []
    return [{
      sourceRefId: ref.id,
      action: "map" as const,
      targetProviderId: matches[0].providerId,
      targetModelTier: matches[0].tier,
      targetModelName: ref.sourceModelName,
    }]
  })
}

function mergeMappingsByReference<TReference extends { readonly id: string }, TMapping extends { readonly sourceRefId: string }>(
  references: readonly TReference[],
  preferred: readonly TMapping[],
  fallback: readonly TMapping[],
): TMapping[] {
  const preferredById = new Map(preferred.map((mapping) => [mapping.sourceRefId, mapping]))
  const fallbackById = new Map(fallback.map((mapping) => [mapping.sourceRefId, mapping]))
  return references.flatMap((reference) => {
    const mapping = preferredById.get(reference.id) ?? fallbackById.get(reference.id)
    return mapping ? [mapping] : []
  })
}

function enrichLegacyModelReferences(
  references: readonly WorkflowShareModelReference[],
  legacyReferences: readonly WorkflowModelReference[],
): WorkflowShareModelReference[] {
  return references.map((reference) => {
    const legacy = legacyReferences.find((candidate) => (
      candidate.sourceModelTier === reference.sourceModelTier
      && candidate.occurrences.some((legacyOccurrence) => reference.occurrences.some((itemOccurrence) => (
        legacyOccurrence.kind === "workflowDefault"
          ? itemOccurrence.nodeId === undefined
          : itemOccurrence.nodeId === legacyOccurrence.nodeId
      )))
    ))
    if (!legacy) return reference
    return {
      ...reference,
      sourceProviderName: legacy.sourceProviderName,
      sourceModelName: legacy.sourceModelName,
      missingOnExporter: legacy.missingOnExporter,
    }
  })
}

function sameStringRecord(left: Readonly<Record<string, string>>, right: Readonly<Record<string, string>>): boolean {
  const leftEntries = Object.entries(left).sort(([a], [b]) => a.localeCompare(b))
  const rightEntries = Object.entries(right).sort(([a], [b]) => a.localeCompare(b))
  return JSON.stringify(leftEntries) === JSON.stringify(rightEntries)
}

function sameShareOriginSnapshot(
  left: Awaited<ReturnType<WorkflowShareStateService["getOrigin"]>>,
  right: Awaited<ReturnType<WorkflowShareStateService["getOrigin"]>>,
): boolean {
  if (!left || !right) return left === right
  return left.artifactId === right.artifactId
    && left.importedAt === right.importedAt
    && sameStringRecord(left.sourceRevisions, right.sourceRevisions)
    && sameStringRecord(left.workflowIds, right.workflowIds)
}

function isWorkflowSharePackageV4(value: SynapseWorkflowImportPackage): value is WorkflowSharePackageV4 {
  return "manifest" in value && "workflows" in value
}

function assertPackage(value: SynapseWorkflowPackage): void {
  if (!value || !SUPPORTED_PACKAGE_FORMATS.includes(value.format)) throw new Error("Invalid workflow package format")
  if (value.format === PACKAGE_FORMAT && value.formatVersion !== PACKAGE_FORMAT_VERSION) {
    throw new Error("Unsupported workflow package version")
  }
  if (!value.workflow || typeof value.workflow.id !== "string") throw new Error("Invalid workflow package workflow")
  if (!Array.isArray(value.modelReferences)) throw new Error("Invalid workflow package model references")
}

function normalizePackage(value: SynapseWorkflowPackage): SynapseWorkflowPackage & { workflow: WorkflowDefinition } {
  assertPackage(value)
  return { ...value, workflow: migrateWorkflowDocumentOrThrow(value.workflow) }
}
