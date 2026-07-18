import type {
  WorkflowParam,
  WorkflowParamPresetResourceEntryType,
  WorkflowParamPresetValue,
} from "@/types/workflow"

export type WorkflowLastRunValues = {
  readonly values: Record<string, WorkflowParamPresetValue>
  readonly resourceEntryTypes: Record<string, WorkflowParamPresetResourceEntryType>
}

export function createWorkflowLastRunValues(
  params: readonly WorkflowParam[],
  values: Record<string, WorkflowParamPresetValue>,
): WorkflowLastRunValues {
  const resourceEntryTypes: Record<string, WorkflowParamPresetResourceEntryType> = {}
  for (const param of params) {
    if ((param.type === "file" || param.type === "directory") && values[param.name] !== undefined) {
      resourceEntryTypes[param.name] = param.type
    }
  }
  return { values, resourceEntryTypes }
}
