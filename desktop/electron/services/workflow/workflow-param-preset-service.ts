import { randomUUID } from "node:crypto"
import type { DataNamespace, DataRepository, WorkflowParamPresetEntryV1 } from "../../runtime/data-repo"
import { createMainLogger } from "../log-store"

const logger = createMainLogger("service.workflow-param-presets")

export interface WorkflowParamPreset {
  readonly id: string
  readonly workflowId: string
  readonly name: string
  readonly values: Record<string, string>
  readonly createdAt: number
  readonly updatedAt: number
}

export interface SaveWorkflowParamPresetInput {
  readonly workflowId: string
  readonly name: string
  readonly values: Record<string, string>
  readonly overwritePresetId?: string
}

export class WorkflowParamPresetService {
  private readonly presets: DataNamespace<WorkflowParamPresetEntryV1>

  constructor(dataRepository: DataRepository) {
    this.presets = dataRepository.namespace<WorkflowParamPresetEntryV1>("workflow.param-presets")
  }

  async list(workflowId: string): Promise<WorkflowParamPreset[]> {
    const items = await this.presets.list()
    return items
      .filter((preset) => preset.workflowId === workflowId)
      .sort((left, right) => right.updatedAt - left.updatedAt || left.name.localeCompare(right.name))
      .map(toPublicPreset)
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
    const entry: WorkflowParamPresetEntryV1 = {
      id,
      schemaVersion: 1,
      workflowId,
      name,
      values: { ...input.values },
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

function toPublicPreset(entry: WorkflowParamPresetEntryV1): WorkflowParamPreset {
  return {
    id: entry.id,
    workflowId: entry.workflowId,
    name: entry.name,
    values: { ...entry.values },
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  }
}
