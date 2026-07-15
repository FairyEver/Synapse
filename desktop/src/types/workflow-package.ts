import type { WorkflowDefinition } from "./workflow"

export type WorkflowPackageModelTier = "default" | "haiku" | "sonnet" | "opus"

export type WorkflowModelOccurrence =
  | { kind: "workflowDefault" }
  | {
      kind: "node"
      nodeId: string
      nodeName: string
      nodeType: string
      inherited: boolean
    }

export interface WorkflowModelReference {
  id: string
  sourceProviderId?: string
  sourceProviderName?: string
  sourceModelTier: WorkflowPackageModelTier
  sourceModelName?: string
  missingOnExporter?: boolean
  occurrences: WorkflowModelOccurrence[]
}

export interface SynapseWorkflowPackageV1 {
  format: "synapse-workflow-package-v1"
  exportedAt: string
  workflow: WorkflowDefinition
  modelReferences: WorkflowModelReference[]
}

export interface SynapseWorkflowPackageV2 {
  format: "synapse-workflow-package-v2"
  exportedAt: string
  workflow: WorkflowDefinition
  modelReferences: WorkflowModelReference[]
}

export interface SynapseWorkflowPackageV3<TWorkflow = WorkflowDefinition> {
  format: "synapse-workflow-package"
  formatVersion: "3.0.0"
  exportedAt: string
  workflow: TWorkflow
  modelReferences: WorkflowModelReference[]
}

export type SynapseWorkflowExportPackageV3 = SynapseWorkflowPackageV3

export type SynapseWorkflowPackage =
  | SynapseWorkflowPackageV1
  | SynapseWorkflowPackageV2
  | SynapseWorkflowPackageV3

export interface WorkflowModelMapping {
  sourceRefId: string
  targetProviderId: string
  targetModelTier: WorkflowPackageModelTier
}

export interface WorkflowImportOptions {
  targetProjectId?: string
}

export interface WorkflowImportProviderOption {
  providerId: string
  providerName: string
  active?: boolean
  models: Record<WorkflowPackageModelTier, string | undefined>
}

export interface WorkflowImportPreview {
  packagePath: string
  packageDigest: string
  workflow: {
    id: string
    name: string
    nodeCount: number
    modelReferenceCount: number
    requiresProjectMapping: boolean
  }
  modelReferences: WorkflowModelReference[]
  providerOptions: WorkflowImportProviderOption[]
  suggestedMappings: WorkflowModelMapping[]
}
