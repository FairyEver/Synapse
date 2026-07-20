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

export const SYNAPSE_WORKFLOW_PACKAGE_FORMAT = "synapse-workflow-package" as const
export const SYNAPSE_WORKFLOW_PACKAGE_FORMAT_VERSION = "4.0.0" as const

export type WorkflowShareFieldPath = readonly (string | number)[]

export interface WorkflowShareFieldLocation {
  workflowRef: string
  nodeId?: string
  nodeName?: string
  nodeType?: string
  fieldPath: WorkflowShareFieldPath
}

export interface WorkflowShareDiagnosticLocation extends WorkflowShareFieldLocation {
  code: string
  message?: string
}

export interface WorkflowShareOccurrence extends WorkflowShareFieldLocation {
  inherited: boolean
}

export interface WorkflowShareModelReference {
  id: string
  environment: "synapse" | "codex" | "claude-code"
  sourceProviderId?: string
  sourceProviderName?: string
  sourceProviderCategory?: string
  sourceModelTier?: WorkflowPackageModelTier
  sourceModelName?: string
  missingOnExporter?: boolean
  occurrences: WorkflowShareOccurrence[]
}

export interface WorkflowShareProjectReference {
  id: string
  sourceProjectId?: string
  sourceProjectName?: string
  sourceProjectType?: string
  gitRemoteFingerprint?: string
  occurrences: WorkflowShareOccurrence[]
}

export type WorkflowShareResourceKind = "local_path" | "drive" | "staged" | "inline_file"

export interface WorkflowShareResourceReference {
  id: string
  kind: WorkflowShareResourceKind
  entryType: "file" | "directory"
  cardinality: "one" | "many"
  access: "read" | "write" | "read-write"
  displayName?: string
  sourceIdentity?: string
  driveId?: string
  driveVersionId?: string
  occurrences: WorkflowShareOccurrence[]
}

export interface WorkflowShareEnvironmentReference {
  id: string
  kind: string
  sourceValue?: string
  occurrences: WorkflowShareOccurrence[]
}

export interface WorkflowShareRuntimeReference {
  id: string
  minVersion: string
  occurrences: WorkflowShareOccurrence[]
}

export interface WorkflowShareRequiredCapability {
  id: string
  minVersion: string
  installSourceId?: string
}

export interface WorkflowShareManifestFile {
  path: string
  size: number
  sha256: string
  mediaType: string
}

export interface WorkflowShareManifestV4 {
  format: typeof SYNAPSE_WORKFLOW_PACKAGE_FORMAT
  formatVersion: string
  artifactId: string
  lineageId: string
  exportedAt: string
  createdWith: {
    appVersion: string
    platform?: "darwin" | "win32" | "linux"
  }
  derivedFrom?: {
    lineageId: string
    artifactId?: string
  }
  shareNote?: string
  entrypoints: string[]
  workflows: Array<{
    ref: string
    sourceWorkflowId: string
    sourceRevision: string
    schemaVersion: string
    path: string
  }>
  references: {
    models: WorkflowShareModelReference[]
    projects: WorkflowShareProjectReference[]
    resources: WorkflowShareResourceReference[]
    environments: WorkflowShareEnvironmentReference[]
    runtimes: WorkflowShareRuntimeReference[]
  }
  requiredCapabilities: WorkflowShareRequiredCapability[]
  risks: {
    sensitiveLocations: WorkflowShareFieldLocation[]
    highRiskLocations: WorkflowShareDiagnosticLocation[]
    portabilityWarnings: WorkflowShareDiagnosticLocation[]
    excludedAutomationCount: number
  }
  files: WorkflowShareManifestFile[]
  extensions?: Record<string, unknown>
  signatures?: Array<Record<string, unknown>>
}

export interface WorkflowSharePackageV4 {
  manifest: WorkflowShareManifestV4
  workflows: Record<string, WorkflowDefinition>
}

export interface WorkflowShareDeletePlan {
  workflowId: string
  imported: boolean
  isEntrypoint: boolean
  lineageId?: string
  cleanupCandidates: Array<{ workflowId: string; name: string }>
  retainedChildren: Array<{ workflowId: string; name: string; reason: "reference" | "history" }>
}

export type SynapseWorkflowImportPackage = SynapseWorkflowPackage | WorkflowSharePackageV4

export interface WorkflowShareProjectMapping {
  sourceRefId: string
  targetProjectId: string
}

export interface WorkflowShareModelMapping {
  sourceRefId: string
  action: "map" | "local-default"
  targetProviderId?: string
  targetModelTier?: WorkflowPackageModelTier
  targetModelName?: string
}

export type WorkflowShareResourceTarget =
  | { kind: "local_path"; path: string }
  | { kind: "drive"; id: string; versionId?: string }

export interface WorkflowShareResourceMapping {
  sourceRefId: string
  target: WorkflowShareResourceTarget
}

export interface WorkflowShareEnvironmentMapping {
  sourceRefId: string
  action: "reuse" | "replace" | "local-default"
  targetValue?: string
}

export interface WorkflowShareImportSelections {
  models: WorkflowShareModelMapping[]
  projects: WorkflowShareProjectMapping[]
  resources: WorkflowShareResourceMapping[]
  environments: WorkflowShareEnvironmentMapping[]
}

export type WorkflowShareImportMode = "create" | "duplicate" | "update"

export interface WorkflowShareImportPreview {
  packagePath: string
  packageDigest: string
  formatVersion: string
  artifactId: string
  lineageId: string
  shareNote?: string
  sourceVerified: boolean
  mode: WorkflowShareImportMode
  content: {
    entrypoints: string[]
    workflows: Array<{
      ref: string
      name: string
      nodeCount: number
      sourceRevision: string
      action: "create" | "update" | "keep" | "detach" | "delete"
      targetWorkflowId?: string
    }>
  }
  compatibility: {
    supported: boolean
    issues: string[]
    requiredCapabilities: WorkflowShareRequiredCapability[]
    sensitiveLocations: WorkflowShareFieldLocation[]
    highRiskLocations: WorkflowShareDiagnosticLocation[]
    portabilityWarnings: WorkflowShareDiagnosticLocation[]
    excludedAutomationCount: number
    automationUpdates: Array<{ id: string; name: string; action: "disable"; reason: string }>
  }
  mappings: {
    models: WorkflowShareModelReference[]
    projects: WorkflowShareProjectReference[]
    resources: WorkflowShareResourceReference[]
    environments: WorkflowShareEnvironmentReference[]
  }
  providerOptions: WorkflowImportProviderOption[]
  projectOptions: Array<{ id: string; name: string; type?: string }>
  suggestions: WorkflowShareImportSelections
  summary: {
    createCount: number
    updateCount: number
    deleteCount: number
    detachCount: number
    preserveRunHistory: boolean
    undoAvailable: boolean
    transactionalBackup: boolean
    incompatiblePresetCount: number
  }
}

export interface WorkflowShareExportPreflight {
  workflowId: string
  workflowName: string
  shareNote: string
  entrypoints: string[]
  workflows: Array<{ ref: string; id: string; name: string; revision: string; nodeCount: number }>
  references: WorkflowShareManifestV4["references"]
  requiredCapabilities: WorkflowShareRequiredCapability[]
  risks: WorkflowShareManifestV4["risks"]
  blockers: string[]
  packageDigestSeed: string
}

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
