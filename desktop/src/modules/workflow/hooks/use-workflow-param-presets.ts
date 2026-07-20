import { useCallback, useEffect, useRef, useState } from "react"
import type {
  SaveWorkflowParamPresetInput,
  WorkflowParamPreset,
  WorkflowParamPresetResourceEntryType,
} from "@/types/workflow"

interface UseWorkflowParamPresetsOptions {
  enabled: boolean
  workflowId: string
}

type PresetMutation =
  | { readonly kind: "save"; readonly preset: WorkflowParamPreset }
  | { readonly kind: "delete"; readonly presetId: string }

interface PendingPresetList {
  readonly workflowId: string
  readonly mutations: PresetMutation[]
}

function requirePresetBridge() {
  const bridge = window.synapse?.workflow.paramPreset
  if (!bridge) throw new Error("Workflow 参数预设服务不可用")
  return bridge
}

export function useWorkflowParamPresets({ enabled, workflowId }: UseWorkflowParamPresetsOptions) {
  const [presets, setPresets] = useState<WorkflowParamPreset[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const activeWorkflowId = useRef(workflowId)
  const pendingList = useRef<PendingPresetList | null>(null)
  activeWorkflowId.current = workflowId

  useEffect(() => {
    setLoadError(null)
    if (!enabled) {
      pendingList.current = null
      setPresets([])
      setLoading(false)
      return
    }
    const bridge = window.synapse?.workflow.paramPreset
    if (!bridge) {
      setPresets([])
      setLoading(false)
      return
    }

    let cancelled = false
    const request: PendingPresetList = { mutations: [], workflowId }
    pendingList.current = request
    setPresets([])
    setLoading(true)
    bridge.list(workflowId)
      .then((items) => {
        if (!cancelled) {
          setPresets(applyPresetMutations(items, request.mutations))
        }
      })
      .catch(() => {
        if (!cancelled) {
          if (request.mutations.length === 0) setPresets([])
          setLoadError("读取预设失败")
        }
      })
      .finally(() => {
        if (!cancelled) {
          if (pendingList.current === request) pendingList.current = null
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
      if (pendingList.current === request) pendingList.current = null
    }
  }, [enabled, workflowId])

  const resolveResourceEntryTypes = useCallback(async (
    presetId: string,
  ): Promise<Record<string, WorkflowParamPresetResourceEntryType>> => {
    const resourceEntryTypes = await requirePresetBridge().resolveResourceEntryTypes(presetId)
    setPresets((current) => current.map((preset) => preset.id === presetId
      ? { ...preset, resourceEntryTypes }
      : preset))
    return resourceEntryTypes
  }, [])

  const savePreset = useCallback(async (input: SaveWorkflowParamPresetInput): Promise<WorkflowParamPreset> => {
    const saved = await requirePresetBridge().save(input)
    if (pendingList.current?.workflowId === saved.workflowId) {
      pendingList.current.mutations.push({ kind: "save", preset: saved })
    }
    if (activeWorkflowId.current === saved.workflowId) {
      setPresets((current) => upsertPreset(current, saved))
    }
    return saved
  }, [])

  const deletePreset = useCallback(async (presetId: string): Promise<void> => {
    const targetWorkflowId = workflowId
    await requirePresetBridge().delete(presetId)
    if (pendingList.current?.workflowId === targetWorkflowId) {
      pendingList.current.mutations.push({ kind: "delete", presetId })
    }
    if (activeWorkflowId.current === targetWorkflowId) {
      setPresets((current) => current.filter((preset) => preset.id !== presetId))
    }
  }, [workflowId])

  return {
    deletePreset,
    loadError,
    loading,
    presets,
    resolveResourceEntryTypes,
    savePreset,
  }
}

function upsertPreset(items: WorkflowParamPreset[], next: WorkflowParamPreset): WorkflowParamPreset[] {
  const updated = items.filter((item) => item.id !== next.id)
  updated.push(next)
  return updated.sort((first, second) => second.updatedAt - first.updatedAt)
}

function applyPresetMutations(
  items: WorkflowParamPreset[],
  mutations: readonly PresetMutation[],
): WorkflowParamPreset[] {
  return mutations.reduce((current, mutation) => {
    return mutation.kind === "save"
      ? upsertPreset(current, mutation.preset)
      : current.filter((preset) => preset.id !== mutation.presetId)
  }, items)
}
