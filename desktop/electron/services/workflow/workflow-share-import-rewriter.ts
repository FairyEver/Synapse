import type { WorkflowDefinition, WorkflowResourceRef } from "../../../src/types/workflow"
import type {
  WorkflowShareImportSelections,
  WorkflowShareModelMapping,
  WorkflowSharePackageV4,
  WorkflowShareResourceMapping,
} from "../../../src/types/workflow-package"
import { nodeTypeRegistry } from "../../../workflow-nodes/registry"
import { resolveNodeShareValues } from "./workflow-share-dependency-collector"

export interface WorkflowShareRewriteResult {
  readonly definitions: WorkflowDefinition[]
  readonly targetIds: ReadonlyMap<string, string>
  readonly entrypointIds: string[]
}

export function rewriteWorkflowSharePackage(options: {
  readonly package: WorkflowSharePackageV4
  readonly selections: WorkflowShareImportSelections
  readonly createId: () => string
  readonly now: number
  readonly existingTargetIds?: ReadonlyMap<string, string>
}): WorkflowShareRewriteResult {
  assertCompleteSelections(options.package, options.selections)
  const targetIds = new Map<string, string>()
  const usedIds = new Set<string>()
  for (const item of options.package.manifest.workflows) {
    const existingId = options.existingTargetIds?.get(item.ref)
    const targetId = existingId ?? createUniqueId(options.createId, usedIds)
    if (usedIds.has(targetId)) throw new Error("工作流导入目标 ID 重复。")
    usedIds.add(targetId)
    targetIds.set(item.ref, targetId)
  }

  const sourceIdToTargetId = new Map(options.package.manifest.workflows.map((item) => [
    item.sourceWorkflowId,
    targetIds.get(item.ref)!,
  ]))
  const modelMappings = new Map(options.selections.models.map((mapping) => [mapping.sourceRefId, mapping]))
  const projectMappings = new Map(options.selections.projects.map((mapping) => [mapping.sourceRefId, mapping]))
  const resourceMappings = new Map(options.selections.resources.map((mapping) => [mapping.sourceRefId, mapping]))
  const environmentMappings = new Map(options.selections.environments.map((mapping) => [mapping.sourceRefId, mapping]))

  const definitions = options.package.manifest.workflows.map((item) => {
    const source = options.package.workflows[item.ref]
    if (!source) throw new Error(`工作流分享包缺少 ${item.ref}。`)
    const definition: WorkflowDefinition = structuredClone(source)
    definition.id = targetIds.get(item.ref)!
    definition.version = ""
    if (!options.existingTargetIds?.has(item.ref)) definition.createdAt = options.now
    definition.updatedAt = options.now

    rewriteWorkflowCalls(definition, sourceIdToTargetId)
    for (const reference of options.package.manifest.references.models) {
      const mapping = modelMappings.get(reference.id)!
      for (const itemOccurrence of reference.occurrences.filter((occurrence) => occurrence.workflowRef === item.ref)) {
        applyModelMapping(definition, itemOccurrence, mapping)
      }
    }
    for (const reference of options.package.manifest.references.projects) {
      const mapping = projectMappings.get(reference.id)!
      for (const itemOccurrence of reference.occurrences.filter((occurrence) => occurrence.workflowRef === item.ref)) {
        if (itemOccurrence.inherited) continue
        setOccurrenceValue(definition, itemOccurrence, mapping.targetProjectId)
      }
    }
    for (const reference of options.package.manifest.references.resources) {
      const mapping = resourceMappings.get(reference.id)!
      for (const itemOccurrence of reference.occurrences.filter((occurrence) => occurrence.workflowRef === item.ref)) {
        applyResourceMapping(definition, itemOccurrence, mapping)
      }
    }
    for (const reference of options.package.manifest.references.environments) {
      const mapping = environmentMappings.get(reference.id)!
      for (const itemOccurrence of reference.occurrences.filter((occurrence) => occurrence.workflowRef === item.ref)) {
        if (mapping.action === "reuse") {
          if (reference.sourceValue === undefined) throw new Error(`环境引用缺少可复用值：${reference.id}`)
          setOccurrenceValue(definition, itemOccurrence, reference.sourceValue)
        } else if (mapping.action === "local-default") {
          deleteOccurrenceValue(definition, itemOccurrence)
        } else {
          setOccurrenceValue(definition, itemOccurrence, mapping.targetValue)
        }
      }
    }
    return definition
  })

  return {
    definitions: sortChildrenBeforeParents(definitions),
    targetIds,
    entrypointIds: options.package.manifest.entrypoints.map((ref) => targetIds.get(ref)!),
  }
}

function assertCompleteSelections(pkg: WorkflowSharePackageV4, selections: WorkflowShareImportSelections): void {
  assertUniqueMappings(selections.models, "模型")
  assertUniqueMappings(selections.projects, "项目")
  assertUniqueMappings(selections.resources, "资源")
  assertUniqueMappings(selections.environments, "环境")
  const models = new Map(selections.models.map((mapping) => [mapping.sourceRefId, mapping]))
  for (const reference of pkg.manifest.references.models) {
    const mapping = models.get(reference.id)
    if (!mapping) throw new Error(`缺少模型映射：${reference.id}`)
    if (mapping.action === "map" && reference.environment === "synapse" && (!mapping.targetProviderId || !mapping.targetModelTier)) {
      throw new Error(`模型映射不完整：${reference.id}`)
    }
    if (mapping.action === "map" && reference.environment !== "synapse" && !mapping.targetModelName) {
      throw new Error(`模型映射不完整：${reference.id}`)
    }
  }
  assertReferenceMappings(pkg.manifest.references.projects, selections.projects, "项目")
  assertReferenceMappings(pkg.manifest.references.resources, selections.resources, "资源")
  assertReferenceMappings(pkg.manifest.references.environments, selections.environments, "环境")
  if (pkg.manifest.references.resources.some((reference) => reference.kind === "inline_file")) {
    throw new Error("当前版本不能导入包含内联文件的工作流分享包。")
  }
}

function assertReferenceMappings(
  references: readonly { readonly id: string }[],
  mappings: readonly { readonly sourceRefId: string }[],
  label: string,
): void {
  const ids = new Set(mappings.map((mapping) => mapping.sourceRefId))
  for (const reference of references) {
    if (!ids.has(reference.id)) throw new Error(`缺少${label}映射：${reference.id}`)
  }
}

function assertUniqueMappings(mappings: readonly { readonly sourceRefId: string }[], label: string): void {
  if (new Set(mappings.map((mapping) => mapping.sourceRefId)).size !== mappings.length) {
    throw new Error(`${label}映射重复。`)
  }
}

function applyModelMapping(
  definition: WorkflowDefinition,
  itemOccurrence: WorkflowSharePackageV4["manifest"]["references"]["models"][number]["occurrences"][number],
  mapping: WorkflowShareModelMapping,
): void {
  if (itemOccurrence.inherited) return
  if (mapping.action === "local-default") {
    deleteOccurrenceValue(definition, itemOccurrence)
    if (!itemOccurrence.nodeId && itemOccurrence.fieldPath[0] === "defaultProviderId") {
      delete definition.defaultModelTier
    }
    return
  }
  if (mapping.targetProviderId) {
    setOccurrenceValue(definition, itemOccurrence, mapping.targetProviderId)
    if (itemOccurrence.nodeId) {
      const node = definition.nodes.find((candidate) => candidate.id === itemOccurrence.nodeId)
      if (node && mapping.targetModelTier) node.config.modelTier = mapping.targetModelTier
    } else if (mapping.targetModelTier) {
      definition.defaultModelTier = mapping.targetModelTier
    }
    return
  }
  setOccurrenceValue(definition, itemOccurrence, mapping.targetModelName)
}

function applyResourceMapping(
  definition: WorkflowDefinition,
  itemOccurrence: WorkflowSharePackageV4["manifest"]["references"]["resources"][number]["occurrences"][number],
  mapping: WorkflowShareResourceMapping,
): void {
  const current = getOccurrenceValue(definition, itemOccurrence)
  if (isWorkflowResourceRef(current)) {
    const next: WorkflowResourceRef = mapping.target.kind === "local_path"
      ? { kind: "local_path", entryType: current.entryType, path: mapping.target.path }
      : { kind: "drive", entryType: current.entryType, id: mapping.target.id, versionId: mapping.target.versionId }
    setOccurrenceValue(definition, itemOccurrence, next)
    return
  }
  if (mapping.target.kind !== "local_path") {
    throw new Error("节点路径字段只能映射到本地文件或目录。")
  }
  setOccurrenceValue(definition, itemOccurrence, mapping.target.path)
}

function rewriteWorkflowCalls(definition: WorkflowDefinition, sourceIdToTargetId: ReadonlyMap<string, string>): void {
  for (const node of definition.nodes) {
    const manifest = nodeTypeRegistry.getManifest(node.type)
    for (const declaration of manifest.share.workflows ?? []) {
      for (const located of resolveNodeShareValues(node.config, declaration.path)) {
        if (typeof located.value !== "string") continue
        const targetId = sourceIdToTargetId.get(located.value)
        if (targetId) setAtPath(node.config, located.path, targetId)
      }
    }
  }
}

function sortChildrenBeforeParents(definitions: readonly WorkflowDefinition[]): WorkflowDefinition[] {
  const byId = new Map(definitions.map((definition) => [definition.id, definition]))
  const result: WorkflowDefinition[] = []
  const visited = new Set<string>()
  const visit = (definition: WorkflowDefinition) => {
    if (visited.has(definition.id)) return
    visited.add(definition.id)
    for (const node of definition.nodes) {
      const manifest = nodeTypeRegistry.getManifest(node.type)
      for (const declaration of manifest.share.workflows ?? []) {
        for (const located of resolveNodeShareValues(node.config, declaration.path)) {
          if (typeof located.value !== "string") continue
          const child = byId.get(located.value)
          if (child) visit(child)
        }
      }
    }
    result.push(definition)
  }
  definitions.forEach(visit)
  return result
}

function getOccurrenceValue(
  definition: WorkflowDefinition,
  itemOccurrence: { readonly nodeId?: string; readonly fieldPath: readonly (string | number)[] },
): unknown {
  const root = itemOccurrence.nodeId
    ? definition.nodes.find((node) => node.id === itemOccurrence.nodeId)?.config
    : definition
  return root ? getAtPath(root, itemOccurrence.fieldPath) : undefined
}

function setOccurrenceValue(
  definition: WorkflowDefinition,
  itemOccurrence: { readonly nodeId?: string; readonly fieldPath: readonly (string | number)[] },
  value: unknown,
): void {
  const root = itemOccurrence.nodeId
    ? definition.nodes.find((node) => node.id === itemOccurrence.nodeId)?.config
    : definition
  if (!root) throw new Error(`找不到映射位置 ${itemOccurrence.nodeId ?? "workflow"}。`)
  setAtPath(root, itemOccurrence.fieldPath, value)
}

function deleteOccurrenceValue(
  definition: WorkflowDefinition,
  itemOccurrence: { readonly nodeId?: string; readonly fieldPath: readonly (string | number)[] },
): void {
  const root = itemOccurrence.nodeId
    ? definition.nodes.find((node) => node.id === itemOccurrence.nodeId)?.config
    : definition
  if (!root) return
  deleteAtPath(root, itemOccurrence.fieldPath)
}

function getAtPath(root: unknown, path: readonly (string | number)[]): unknown {
  let current = root
  for (const segment of path) {
    if ((typeof current !== "object" || current === null)) return undefined
    current = (current as Record<string | number, unknown>)[segment]
  }
  return current
}

function setAtPath(root: unknown, path: readonly (string | number)[], value: unknown): void {
  if (path.length === 0) throw new Error("映射位置不能为空。")
  let current = root as Record<string | number, unknown>
  for (const segment of path.slice(0, -1)) {
    const next = current[segment]
    if (typeof next !== "object" || next === null) throw new Error("映射位置不存在。")
    current = next as Record<string | number, unknown>
  }
  current[path[path.length - 1]] = value
}

function deleteAtPath(root: unknown, path: readonly (string | number)[]): void {
  if (path.length === 0) return
  let current = root as Record<string | number, unknown>
  for (const segment of path.slice(0, -1)) {
    const next = current[segment]
    if (typeof next !== "object" || next === null) return
    current = next as Record<string | number, unknown>
  }
  delete current[path[path.length - 1]]
}

function createUniqueId(createId: () => string, usedIds: ReadonlySet<string>): string {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const id = createId()
    if (id && !usedIds.has(id)) return id
  }
  throw new Error("无法生成唯一工作流 ID。")
}

function isWorkflowResourceRef(value: unknown): value is WorkflowResourceRef {
  return typeof value === "object"
    && value !== null
    && ["local_path", "drive", "staged", "inline_file"].includes(String((value as { kind?: unknown }).kind))
}
