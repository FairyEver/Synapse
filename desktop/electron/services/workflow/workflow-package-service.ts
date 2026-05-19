import { randomUUID } from "node:crypto"
import type { WorkflowDefinition, WorkflowNode } from "../../../src/types/workflow"
import type {
  SynapseWorkflowPackageV1,
  WorkflowImportPreview,
  WorkflowImportProviderOption,
  WorkflowModelMapping,
  WorkflowModelReference,
  WorkflowPackageModelTier,
} from "../../../src/types/workflow-package"
import type { ProviderService } from "../provider"
import type { CCProvider } from "../provider/types"
import type { WorkflowSaveError, WorkflowService } from "./workflow-service"

const PACKAGE_FORMAT = "synapse-workflow-package-v1" as const
const MODEL_TIERS: readonly WorkflowPackageModelTier[] = ["default", "haiku", "sonnet", "opus"]

interface WorkflowPackageServiceDeps {
  readonly workflowService: Pick<WorkflowService, "get" | "save">
  readonly providerService: Pick<ProviderService, "listProviders">
  readonly now?: () => Date
  readonly createId?: () => string
}

export class WorkflowPackageService {
  private readonly workflowService: Pick<WorkflowService, "get" | "save">
  private readonly providerService: Pick<ProviderService, "listProviders">
  private readonly now: () => Date
  private readonly createId: () => string

  constructor(deps: WorkflowPackageServiceDeps) {
    this.workflowService = deps.workflowService
    this.providerService = deps.providerService
    this.now = deps.now ?? (() => new Date())
    this.createId = deps.createId ?? randomUUID
  }

  async buildExportPackage(workflowId: string): Promise<SynapseWorkflowPackageV1> {
    const workflow = await this.workflowService.get(workflowId)
    if (!workflow) throw new Error(`Workflow ${workflowId} not found`)
    const providers = await this.providerService.listProviders()
    return {
      format: PACKAGE_FORMAT,
      exportedAt: this.now().toISOString(),
      workflow,
      modelReferences: buildModelReferences(workflow, providers),
    }
  }

  async buildImportPreview(packagePath: string, pkg: SynapseWorkflowPackageV1): Promise<WorkflowImportPreview> {
    assertPackage(pkg)
    const providers = await this.providerService.listProviders()
    const providerOptions = providers.map(toProviderOption)
    return {
      packagePath,
      workflow: {
        id: pkg.workflow.id,
        name: pkg.workflow.name,
        nodeCount: pkg.workflow.nodes.length,
        modelReferenceCount: pkg.modelReferences.length,
      },
      modelReferences: pkg.modelReferences,
      providerOptions,
      suggestedMappings: suggestMappings(pkg.modelReferences, providerOptions),
    }
  }

  async importPackage(
    pkg: SynapseWorkflowPackageV1,
    mappings: readonly WorkflowModelMapping[],
  ): Promise<{ workflowId: string; versionHash: string } | WorkflowSaveError> {
    assertPackage(pkg)
    const providers = await this.providerService.listProviders()
    const providerIds = new Set(providers.map((provider) => provider.id))
    const mappingByRef = new Map(mappings.map((mapping) => [mapping.sourceRefId, mapping]))

    for (const ref of pkg.modelReferences) {
      const mapping = mappingByRef.get(ref.id)
      if (!mapping) throw new Error(`Missing model mapping for ${ref.id}`)
      if (!providerIds.has(mapping.targetProviderId)) throw new Error(`Unknown target provider ${mapping.targetProviderId}`)
      if (!MODEL_TIERS.includes(mapping.targetModelTier)) throw new Error(`Invalid target model tier ${mapping.targetModelTier}`)
    }

    const imported = rewriteWorkflowForImport(pkg.workflow, pkg.modelReferences, mappingByRef, this.createId(), this.now().getTime())
    const saveResult = await this.workflowService.save(imported)
    if ("errors" in saveResult) return saveResult
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
  add(workflow.defaultProviderId, defaultTier, { kind: "workflowDefault" })

  for (const node of workflow.nodes) {
    if (!isModelNode(node)) continue
    const config = node.config as { providerId?: unknown; modelTier?: unknown }
    const explicitProviderId = typeof config.providerId === "string" && config.providerId.length > 0 ? config.providerId : undefined
    const explicitTier = isModelTier(config.modelTier) ? config.modelTier : "default"
    if (explicitProviderId) {
      add(explicitProviderId, explicitTier, modelNodeOccurrence(node, false))
    } else if (workflow.defaultProviderId) {
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
): WorkflowDefinition {
  let next: WorkflowDefinition = {
    ...workflow,
    id,
    version: "",
    createdAt: timestamp,
    updatedAt: timestamp,
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

  return next
}

function modelNodeOccurrence(node: WorkflowNode, inherited: boolean): WorkflowModelReference["occurrences"][number] {
  return { kind: "node", nodeId: node.id, nodeName: node.name, nodeType: node.type, inherited }
}

function isModelNode(node: WorkflowNode): boolean {
  return node.type === "prompt" || node.type === "switch"
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

function assertPackage(value: SynapseWorkflowPackageV1): void {
  if (!value || value.format !== PACKAGE_FORMAT) throw new Error("Invalid workflow package format")
  if (!value.workflow || typeof value.workflow.id !== "string") throw new Error("Invalid workflow package workflow")
  if (!Array.isArray(value.modelReferences)) throw new Error("Invalid workflow package model references")
}
