import { randomUUID } from "node:crypto"
import type { DataNamespace, DataRepository, WorkflowParamPresetEntryV2, WorkflowParamPresetValueV2 } from "../../runtime/data-repo"
import { WORKFLOW_MULTI_RESOURCE_PARAM_MAX_ITEMS } from "../../../config"
import { createMainLogger } from "../log-store"
import { resolveWorkflowLocalResourceIdentity } from "./workflow-resource-identity"

const logger = createMainLogger("service.workflow-param-presets")

export interface WorkflowParamPreset {
  readonly id: string
  readonly workflowId: string
  readonly name: string
  readonly values: Record<string, WorkflowParamPresetValueV2>
  readonly resourceEntryTypes: Record<string, WorkflowParamPresetResourceEntryType>
  readonly createdAt: number
  readonly updatedAt: number
}

type WorkflowParamPresetResourceEntryType = "file" | "directory" | "mixed" | "unavailable"

export interface SaveWorkflowParamPresetInput {
  readonly workflowId: string
  readonly name: string
  readonly values: Record<string, WorkflowParamPresetValueV2>
  readonly overwritePresetId?: string
}

export class WorkflowParamPresetService {
  private readonly presets: DataNamespace<WorkflowParamPresetEntryV2>

  constructor(dataRepository: DataRepository) {
    this.presets = dataRepository.namespace<WorkflowParamPresetEntryV2>("workflow.param-presets")
  }

  async list(workflowId: string): Promise<WorkflowParamPreset[]> {
    const items = await this.presets.list()
    return items
      .filter((preset) => preset.workflowId === workflowId)
      .sort((left, right) => right.updatedAt - left.updatedAt || left.name.localeCompare(right.name))
      .map(toListedPreset)
  }

  async resolveResourceEntryTypes(id: string): Promise<Record<string, WorkflowParamPresetResourceEntryType>> {
    const entry = await this.presets.get(id)
    if (!entry) throw new Error("Preset not found")
    return resolvePresetResourceEntryTypes(entry.values)
  }

  async save(input: SaveWorkflowParamPresetInput): Promise<WorkflowParamPreset> {
    const workflowId = input.workflowId.trim()
    const name = input.name.trim()
    if (!workflowId) throw new Error("Workflow id is required")
    if (!name) throw new Error("Preset name is required")

    const now = Date.now()
    const existing = (await this.presets.list()).filter((preset) => preset.workflowId === workflowId)
    const duplicate = existing.find((preset) => preset.name === name)
    if (duplicate && duplicate.id !== input.overwritePresetId) {
      throw new Error("Preset name already exists")
    }

    const previous = input.overwritePresetId
      ? existing.find((preset) => preset.id === input.overwritePresetId)
      : null
    const id = previous?.id ?? randomUUID()
    const createdAt = previous?.createdAt ?? now
    const entry: WorkflowParamPresetEntryV2 = {
      id,
      schemaVersion: 2,
      workflowId,
      name,
      values: await validateAndClonePresetValues(input.values),
      createdAt,
      updatedAt: now,
    }
    await this.presets.upsert(entry)
    logger.info("workflow param preset saved", {
      workflowId,
      presetId: id,
      valueKeyCount: Object.keys(input.values).length,
      overwritten: Boolean(previous),
    })
    return toPublicPreset(entry)
  }

  async delete(id: string): Promise<void> {
    await this.presets.remove(id)
    logger.info("workflow param preset deleted", { presetId: id })
  }

  async deleteForWorkflow(workflowId: string): Promise<void> {
    const items = await this.presets.list()
    const targets = items.filter((preset) => preset.workflowId === workflowId)
    for (const preset of targets) {
      await this.presets.remove(preset.id)
    }
    logger.info("workflow param presets deleted for workflow", { workflowId, count: targets.length })
  }
}

async function toPublicPreset(entry: WorkflowParamPresetEntryV2): Promise<WorkflowParamPreset> {
  return {
    id: entry.id,
    workflowId: entry.workflowId,
    name: entry.name,
    values: clonePresetValues(entry.values),
    resourceEntryTypes: await resolvePresetResourceEntryTypes(entry.values),
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  }
}

function toListedPreset(entry: WorkflowParamPresetEntryV2): WorkflowParamPreset {
  return {
    id: entry.id,
    workflowId: entry.workflowId,
    name: entry.name,
    values: clonePresetValues(entry.values),
    resourceEntryTypes: {},
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  }
}

async function resolvePresetResourceEntryTypes(
  values: Record<string, WorkflowParamPresetValueV2>,
): Promise<Record<string, WorkflowParamPresetResourceEntryType>> {
  const entryTypes: Record<string, WorkflowParamPresetResourceEntryType> = {}
  for (const [paramName, value] of Object.entries(values)) {
    if (!Array.isArray(value)) continue
    entryTypes[paramName] = await resolvePresetResourceEntryType(value)
  }
  return entryTypes
}

async function resolvePresetResourceEntryType(
  resourcePaths: readonly string[],
): Promise<WorkflowParamPresetResourceEntryType> {
  let resolvedType: "file" | "directory" | undefined
  for (const resourcePath of resourcePaths) {
    try {
      const resource = await resolveWorkflowLocalResourceIdentity(resourcePath)
      const currentType = resource.isFile ? "file" : resource.isDirectory ? "directory" : undefined
      if (!currentType) return "unavailable"
      if (resolvedType && resolvedType !== currentType) return "mixed"
      resolvedType = currentType
    } catch {
      return "unavailable"
    }
  }
  return resolvedType ?? "unavailable"
}

function clonePresetValues(values: Record<string, WorkflowParamPresetValueV2>): Record<string, WorkflowParamPresetValueV2> {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, Array.isArray(value) ? [...value] : value]))
}

async function validateAndClonePresetValues(
  values: Record<string, WorkflowParamPresetValueV2>,
): Promise<Record<string, WorkflowParamPresetValueV2>> {
  for (const [paramName, value] of Object.entries(values)) {
    if (!Array.isArray(value)) continue
    if (value.length === 0) throw new Error(`Preset param ${paramName} must not be an empty array`)
    if (value.length > WORKFLOW_MULTI_RESOURCE_PARAM_MAX_ITEMS) {
      throw new Error(`Preset param ${paramName} exceeds ${WORKFLOW_MULTI_RESOURCE_PARAM_MAX_ITEMS} items`)
    }
    const identities: string[] = []
    for (const resourcePath of value) {
      if (!resourcePath.trim()) throw new Error(`Preset param ${paramName} contains an empty path`)
      try {
        const resource = await resolveWorkflowLocalResourceIdentity(resourcePath.trim())
        identities.push(resource.identity)
      } catch {
        throw new Error(`Preset param ${paramName} contains a path that does not exist or cannot be accessed`)
      }
    }
    if (new Set(identities).size !== identities.length) throw new Error(`Preset param ${paramName} contains duplicate paths`)
  }
  return clonePresetValues(values)
}
