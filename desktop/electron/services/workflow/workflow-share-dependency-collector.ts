import { createHash } from "node:crypto"
import type { WorkflowDefinition, WorkflowResourceRef } from "../../../src/types/workflow"
import type {
  WorkflowPackageModelTier,
  WorkflowShareDiagnosticLocation,
  WorkflowShareEnvironmentReference,
  WorkflowShareFieldLocation,
  WorkflowShareManifestV4,
  WorkflowShareModelReference,
  WorkflowShareOccurrence,
  WorkflowShareProjectReference,
  WorkflowShareRequiredCapability,
  WorkflowShareResourceReference,
  WorkflowShareRuntimeReference,
} from "../../../src/types/workflow-package"
import { nodeTypeRegistry } from "../../../workflow-nodes/registry"
import type {
  NodeShareCapabilityRequirement,
  NodeShareConfigPath,
  NodeShareRiskDeclaration,
} from "../../../workflow-nodes/types"

export interface WorkflowShareProviderSummary {
  readonly id: string
  readonly name: string
  readonly category?: string
  readonly model?: string
  readonly haikuModel?: string
  readonly sonnetModel?: string
  readonly opusModel?: string
}

export interface WorkflowShareProjectSummary {
  readonly id: string
  readonly name: string
  readonly type?: string
  readonly gitRemoteFingerprint?: string
}

export function workflowShareGitRemoteFingerprint(remoteUrl: string): string | undefined {
  const normalized = normalizeGitRemote(remoteUrl)
  return normalized ? createHash("sha256").update(`git-remote\u0000${normalized}`).digest("hex") : undefined
}

function normalizeGitRemote(remoteUrl: string): string | undefined {
  const value = remoteUrl.trim()
  if (!value) return undefined
  const scp = /^(?:[^@\s]+@)?([^:\s]+):(.+)$/.exec(value)
  if (scp && !value.includes("://")) {
    return `${scp[1].toLowerCase()}/${scp[2].replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "")}`
  }
  try {
    const parsed = new URL(value)
    return `${parsed.hostname.toLowerCase()}/${parsed.pathname.replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "")}`
  } catch {
    return value.replace(/\.git$/i, "").replace(/\/+$/g, "")
  }
}

export interface WorkflowShareDependencyCollectorInput {
  readonly workflows: readonly WorkflowDefinition[]
  readonly workflowRefs: ReadonlyMap<string, string>
  readonly providers: readonly WorkflowShareProviderSummary[]
  readonly projects?: readonly WorkflowShareProjectSummary[]
  readonly excludedAutomationCount?: number
}

export interface WorkflowShareDependencyCollection {
  readonly references: WorkflowShareManifestV4["references"]
  readonly requiredCapabilities: WorkflowShareRequiredCapability[]
  readonly risks: WorkflowShareManifestV4["risks"]
  readonly childWorkflowIds: string[]
  readonly blockers: string[]
}

export type LocatedNodeShareValue = { readonly path: (string | number)[]; readonly value: unknown }

export function collectWorkflowShareDependencies(
  input: WorkflowShareDependencyCollectorInput,
): WorkflowShareDependencyCollection {
  const providers = new Map(input.providers.map((provider) => [provider.id, provider]))
  const projects = new Map((input.projects ?? []).map((project) => [project.id, project]))
  const modelRefs = new Map<string, WorkflowShareModelReference>()
  const projectRefs = new Map<string, WorkflowShareProjectReference>()
  const resourceRefs = new Map<string, WorkflowShareResourceReference>()
  const environmentRefs = new Map<string, WorkflowShareEnvironmentReference>()
  const runtimeRefs = new Map<string, WorkflowShareRuntimeReference>()
  const capabilities = new Map<string, WorkflowShareRequiredCapability>()
  const sensitiveLocations: WorkflowShareFieldLocation[] = []
  const highRiskLocations: WorkflowShareDiagnosticLocation[] = []
  const portabilityWarnings: WorkflowShareDiagnosticLocation[] = []
  const childWorkflowIds = new Set<string>()
  const blockers: string[] = []

  for (const workflow of input.workflows) {
    const workflowRef = input.workflowRefs.get(workflow.id)
    if (!workflowRef) throw new Error(`Missing package reference for workflow ${workflow.id}`)

    if (workflow.defaultProviderId) {
      addModelReference(modelRefs, providers, {
        environment: "synapse",
        providerId: workflow.defaultProviderId,
        tier: workflow.defaultModelTier ?? "default",
        occurrence: occurrence(workflowRef, ["defaultProviderId"], false),
      })
    }
    if (workflow.defaultProjectId) {
      addProjectReference(projectRefs, projects, workflow.defaultProjectId, occurrence(workflowRef, ["defaultProjectId"], false))
    }
    collectParamResources(workflow, workflowRef, resourceRefs, blockers)

    for (const node of workflow.nodes) {
      let manifest
      try {
        manifest = nodeTypeRegistry.getManifest(node.type)
      } catch {
        blockers.push(`${workflow.name} / ${node.name}：缺少节点分享契约`)
        continue
      }
      addCapability(capabilities, manifest.share.capability)
      const baseLocation = {
        workflowRef,
        nodeId: node.id,
        nodeName: node.name,
        nodeType: node.type,
      }

      for (const declaration of manifest.share.models ?? []) {
        const explicitProvider = stringAt(node.config, declaration.providerPath)
        const providerId = explicitProvider ?? (declaration.inheritProvider ? workflow.defaultProviderId : undefined)
        const explicitTier = modelTierAt(node.config, declaration.tierPath)
        const tier = explicitTier ?? (declaration.inheritTier ? workflow.defaultModelTier : undefined) ?? "default"
        const modelName = stringAt(node.config, declaration.modelPath)
        if (!providerId && !modelName) continue
        const fieldPath = declaration.modelPath ?? declaration.providerPath ?? declaration.tierPath ?? []
        addModelReference(modelRefs, providers, {
          environment: declaration.environment ?? "synapse",
          providerId,
          tier,
          modelName,
          occurrence: {
            ...baseLocation,
            fieldPath,
            inherited: !explicitProvider && Boolean(providerId),
          },
        })
      }

      for (const declaration of manifest.share.projects ?? []) {
        const explicitProjectId = stringAt(node.config, declaration.path)
        const projectId = explicitProjectId ?? (declaration.inheritFromWorkflow ? workflow.defaultProjectId : undefined)
        if (!projectId) continue
        addProjectReference(projectRefs, projects, projectId, {
          ...baseLocation,
          fieldPath: declaration.path,
          inherited: !explicitProjectId,
        })
      }

      for (const declaration of manifest.share.workflows ?? []) {
        for (const located of resolveNodeShareValues(node.config, declaration.path)) {
          if (typeof located.value !== "string" || !located.value.trim()) continue
          childWorkflowIds.add(located.value)
        }
      }

      for (const declaration of manifest.share.resources ?? []) {
        for (const located of resolveNodeShareValues(node.config, declaration.path)) {
          const values = declaration.cardinality === "many" && Array.isArray(located.value)
            ? located.value
            : [located.value]
          values.forEach((value, index) => {
            if (typeof value !== "string" || !value.trim()) return
            if (isResourcePathDerivedFromRuntimeVariable(node.config, value)) return
            const resourcePath = declaration.cardinality === "many" ? [...located.path, index] : located.path
            addResourceReference(resourceRefs, {
              kind: "local_path",
              entryType: declaration.entryType,
              cardinality: declaration.cardinality,
              access: declaration.access,
              sourceIdentity: opaqueLocalResourceIdentity(value),
              displayName: localResourceDisplayName(value),
              occurrence: { ...baseLocation, fieldPath: resourcePath, inherited: false },
            })
          })
        }
      }

      for (const declaration of manifest.share.environments ?? []) {
        for (const located of resolveNodeShareValues(node.config, declaration.path)) {
          if (!isPresent(located.value)) continue
          const sourceValue = typeof located.value === "string" ? located.value : JSON.stringify(located.value)
          const key = `${declaration.kind}\u0000${sourceValue}`
          const ref = environmentRefs.get(key) ?? {
            id: stableReferenceId("environment", key),
            kind: declaration.kind,
            sourceValue,
            occurrences: [],
          }
          ref.occurrences.push({ ...baseLocation, fieldPath: located.path, inherited: false })
          environmentRefs.set(key, ref)
        }
      }

      for (const declaration of manifest.share.sensitive ?? []) {
        for (const located of resolveNodeShareValues(node.config, declaration.path)) {
          if (!isPresent(located.value)) continue
          sensitiveLocations.push({ ...baseLocation, fieldPath: located.path })
        }
      }

      for (const declaration of manifest.share.risks ?? []) {
        for (const located of resolveNodeShareValues(node.config, declaration.path)) {
          if (!matchesRisk(located.value, declaration)) continue
          highRiskLocations.push({ ...baseLocation, fieldPath: located.path, code: declaration.id })
        }
      }

      for (const declaration of manifest.share.runtimes ?? []) {
        const requirements = declaration.capability
          ? [declaration.capability]
          : resolveNodeShareValues(node.config, declaration.path ?? []).flatMap((located) => {
            const requirement = declaration.capabilityByValue?.[String(located.value)]
            return requirement ? [requirement] : []
          })
        for (const requirement of requirements) {
          addCapability(capabilities, requirement)
          const ref = runtimeRefs.get(requirement.id) ?? {
            id: requirement.id,
            minVersion: requirement.minVersion,
            occurrences: [],
          }
          ref.occurrences.push({ ...baseLocation, fieldPath: declaration.path ?? [], inherited: false })
          runtimeRefs.set(requirement.id, ref)
        }
      }

      for (const code of manifest.share.portabilityWarnings ?? []) {
        portabilityWarnings.push({ ...baseLocation, fieldPath: [], code })
      }
    }
  }

  return {
    references: {
      models: sortReferences(modelRefs),
      projects: sortReferences(projectRefs),
      resources: sortReferences(resourceRefs),
      environments: sortReferences(environmentRefs),
      runtimes: sortReferences(runtimeRefs),
    },
    requiredCapabilities: [...capabilities.values()].sort((left, right) => left.id.localeCompare(right.id)),
    risks: {
      sensitiveLocations,
      highRiskLocations,
      portabilityWarnings,
      excludedAutomationCount: input.excludedAutomationCount ?? 0,
    },
    childWorkflowIds: [...childWorkflowIds],
    blockers,
  }
}

function addModelReference(
  refs: Map<string, WorkflowShareModelReference>,
  providers: ReadonlyMap<string, WorkflowShareProviderSummary>,
  input: {
    readonly environment: WorkflowShareModelReference["environment"]
    readonly providerId?: string
    readonly tier: WorkflowPackageModelTier
    readonly modelName?: string
    readonly occurrence: WorkflowShareOccurrence
  },
): void {
  const provider = input.providerId ? providers.get(input.providerId) : undefined
  const resolvedModelName = input.modelName ?? (provider ? modelNameForTier(provider, input.tier) : undefined)
  const key = [input.environment, input.providerId ?? "", resolvedModelName ?? `tier:${input.tier}`].join("\u0000")
  const ref = refs.get(key) ?? {
    id: stableReferenceId("model", key),
    environment: input.environment,
    sourceProviderName: provider?.name,
    sourceProviderCategory: provider?.category,
    sourceModelTier: input.tier,
    sourceModelName: resolvedModelName,
    ...(input.providerId && !provider ? { missingOnExporter: true } : {}),
    occurrences: [],
  }
  ref.occurrences.push(input.occurrence)
  refs.set(key, ref)
}

function addProjectReference(
  refs: Map<string, WorkflowShareProjectReference>,
  projects: ReadonlyMap<string, WorkflowShareProjectSummary>,
  projectId: string,
  itemOccurrence: WorkflowShareOccurrence,
): void {
  const project = projects.get(projectId)
  const key = projectId
  const ref = refs.get(key) ?? {
    id: stableReferenceId("project", key),
    sourceProjectName: project?.name,
    sourceProjectType: project?.type,
    gitRemoteFingerprint: project?.gitRemoteFingerprint,
    occurrences: [],
  }
  ref.occurrences.push(itemOccurrence)
  refs.set(key, ref)
}

function collectParamResources(
  workflow: WorkflowDefinition,
  workflowRef: string,
  refs: Map<string, WorkflowShareResourceReference>,
  blockers: string[],
): void {
  workflow.params.forEach((param, paramIndex) => {
    if (param.type !== "file" && param.type !== "directory") return
    const values = Array.isArray(param.default) ? param.default : [param.default]
    values.forEach((value, valueIndex) => {
      if (!isWorkflowResourceRef(value)) return
      if (value.kind === "inline_file") {
        blockers.push(`${workflow.name} / 参数 ${param.name}：内联文件不能导出`)
      }
      const fieldPath: (string | number)[] = ["params", paramIndex, "default"]
      if (Array.isArray(param.default)) fieldPath.push(valueIndex)
      addResourceReference(refs, {
        kind: value.kind,
        entryType: value.entryType,
        cardinality: param.allowMultiple ? "many" : "one",
        access: "read",
        sourceIdentity: value.kind === "local_path"
          ? opaqueLocalResourceIdentity(value.path)
          : value.kind === "staged"
            ? stableReferenceId("staged-resource", value.id)
            : undefined,
        displayName: value.kind === "local_path" ? localResourceDisplayName(value.path) : value.kind === "inline_file" ? value.name : undefined,
        driveId: value.kind === "drive" ? value.id : undefined,
        driveVersionId: value.kind === "drive" ? value.versionId : undefined,
        occurrence: { workflowRef, fieldPath, inherited: false },
      })
    })
  })
}

function addResourceReference(
  refs: Map<string, WorkflowShareResourceReference>,
  input: Omit<WorkflowShareResourceReference, "id" | "occurrences"> & { readonly occurrence: WorkflowShareOccurrence },
): void {
  const key = [input.kind, input.entryType, input.sourceIdentity ?? "", input.driveId ?? "", input.driveVersionId ?? ""].join("\u0000")
  const ref = refs.get(key) ?? {
    id: stableReferenceId("resource", key),
    kind: input.kind,
    entryType: input.entryType,
    cardinality: input.cardinality,
    access: input.access,
    displayName: input.displayName,
    sourceIdentity: input.sourceIdentity,
    driveId: input.driveId,
    driveVersionId: input.driveVersionId,
    occurrences: [],
  }
  ref.occurrences.push(input.occurrence)
  refs.set(key, ref)
}

function addCapability(
  capabilities: Map<string, WorkflowShareRequiredCapability>,
  requirement: NodeShareCapabilityRequirement,
): void {
  const current = capabilities.get(requirement.id)
  if (!current || compareVersions(requirement.minVersion, current.minVersion) > 0) {
    capabilities.set(requirement.id, { ...requirement })
  }
}

function occurrence(workflowRef: string, fieldPath: (string | number)[], inherited: boolean): WorkflowShareOccurrence {
  return { workflowRef, fieldPath, inherited }
}

export function resolveNodeShareValues(root: unknown, path: NodeShareConfigPath): LocatedNodeShareValue[] {
  const results: LocatedNodeShareValue[] = []
  const visit = (value: unknown, index: number, resolvedPath: (string | number)[]) => {
    if (index === path.length) {
      results.push({ path: resolvedPath, value })
      return
    }
    const segment = path[index]
    if (segment === "*") {
      if (Array.isArray(value)) {
        value.forEach((item, itemIndex) => visit(item, index + 1, [...resolvedPath, itemIndex]))
      } else if (isRecord(value)) {
        Object.entries(value).forEach(([key, item]) => visit(item, index + 1, [...resolvedPath, key]))
      }
      return
    }
    if (!isRecord(value) && !Array.isArray(value)) return
    visit((value as Record<string | number, unknown>)[segment], index + 1, [...resolvedPath, segment])
  }
  visit(root, 0, [])
  return results
}

function stringAt(root: unknown, path?: NodeShareConfigPath): string | undefined {
  if (!path) return undefined
  const value = resolveNodeShareValues(root, path)[0]?.value
  return typeof value === "string" && value.trim() ? value : undefined
}

function modelTierAt(root: unknown, path?: NodeShareConfigPath): WorkflowPackageModelTier | undefined {
  const value = stringAt(root, path)
  return value === "default" || value === "haiku" || value === "sonnet" || value === "opus" ? value : undefined
}

function matchesRisk(value: unknown, declaration: NodeShareRiskDeclaration): boolean {
  if (declaration.equals !== undefined) return value === declaration.equals
  if (declaration.when === "truthy") return Boolean(value)
  return isPresent(value)
}

function isPresent(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return false
  if (Array.isArray(value)) return value.length > 0
  if (isRecord(value)) return Object.keys(value).length > 0
  return true
}

function isWorkflowResourceRef(value: unknown): value is WorkflowResourceRef {
  return isRecord(value) && ["local_path", "drive", "staged", "inline_file"].includes(String(value.kind))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function modelNameForTier(provider: WorkflowShareProviderSummary, tier: WorkflowPackageModelTier): string | undefined {
  if (tier === "haiku") return provider.haikuModel ?? provider.model
  if (tier === "sonnet") return provider.sonnetModel ?? provider.model
  if (tier === "opus") return provider.opusModel ?? provider.model
  return provider.model
}

function localResourceDisplayName(value: string): string {
  return value.replace(/\\/g, "/").split("/").filter(Boolean).at(-1) ?? "resource"
}

function isResourcePathDerivedFromRuntimeVariable(config: unknown, value: string): boolean {
  const variableName = /^\s*\{\{\s*\$?([\p{L}\p{N}_.-]+)\s*\}\}/u.exec(value)?.[1]
  if (!variableName || !isRecord(config) || !Array.isArray(config.variables)) return false
  const binding = config.variables.find((candidate) => isRecord(candidate) && candidate.name === variableName)
  if (!isRecord(binding) || !isRecord(binding.source)) return false
  return binding.source.type === "param" || binding.source.type === "node_output"
}

function opaqueLocalResourceIdentity(value: string): string {
  return stableReferenceId("local-resource", value)
}

function stableReferenceId(kind: string, identity: string): string {
  return `${kind}_${createHash("sha256").update(`${kind}\u0000${identity}`).digest("hex").slice(0, 20)}`
}

function compareVersions(left: string, right: string): number {
  const leftParts = left.split(".").map(Number)
  const rightParts = right.split(".").map(Number)
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

function sortReferences<T extends { readonly id: string }>(refs: ReadonlyMap<string, T>): T[] {
  return [...refs.values()].sort((left, right) => left.id.localeCompare(right.id))
}
