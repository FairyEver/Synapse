import { randomUUID } from "node:crypto"
import type { WorkflowDefinition, WorkflowNode } from "../../../src/types/workflow"
import type {
  SynapseWorkflowPackage,
  SynapseWorkflowExportPackageV3,
  SynapseWorkflowPackageV3,
  WorkflowImportPreview,
  WorkflowImportOptions,
  WorkflowImportProviderOption,
  WorkflowModelMapping,
  WorkflowModelReference,
  WorkflowPackageModelTier,
} from "../../../src/types/workflow-package"
import { migrateWorkflowDocumentOrThrow } from "./workflow-document-migration"
import type { ProviderService } from "../provider"
import type { CCProvider } from "../provider/types"
import { createMainLogger } from "../log-store"
import type { WorkflowSaveError, WorkflowService } from "./workflow-service"

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
  readonly workflowService: Pick<WorkflowService, "getExportDocument" | "save">
  readonly providerService: Pick<ProviderService, "listProviders">
  readonly now?: () => Date
  readonly createId?: () => string
}

export class WorkflowPackageService {
  private readonly workflowService: Pick<WorkflowService, "getExportDocument" | "save">
  private readonly providerService: Pick<ProviderService, "listProviders">
  private readonly now: () => Date
  private readonly createId: () => string

  constructor(deps: WorkflowPackageServiceDeps) {
    this.workflowService = deps.workflowService
    this.providerService = deps.providerService
    this.now = deps.now ?? (() => new Date())
    this.createId = deps.createId ?? randomUUID
  }

  async buildExportPackage(workflowId: string): Promise<SynapseWorkflowExportPackageV3> {
    const exportDocument = await this.workflowService.getExportDocument(workflowId)
    if (!exportDocument) throw new Error(`Workflow ${workflowId} not found`)
    if (exportDocument.kind === "future") {
      return {
        format: PACKAGE_FORMAT,
        formatVersion: PACKAGE_FORMAT_VERSION,
        exportedAt: this.now().toISOString(),
        workflow: exportDocument.document,
        modelReferences: [],
      }
    }
    const workflow = exportDocument.document
    const providers = await this.providerService.listProviders()
    return {
      format: PACKAGE_FORMAT,
      formatVersion: PACKAGE_FORMAT_VERSION,
      exportedAt: this.now().toISOString(),
      workflow,
      modelReferences: buildModelReferences(workflow, providers),
    }
  }

  async buildImportPreview(packagePath: string, pkg: SynapseWorkflowPackage, packageDigest: string): Promise<WorkflowImportPreview> {
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

    const imported = rewriteWorkflowForImport(currentPackage.workflow, currentPackage.modelReferences, mappingByRef, this.createId(), this.now().getTime(), options)
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
