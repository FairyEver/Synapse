import type { SynapseConfigPatch, SynapseQuickInput, SynapseVariable } from "../types/config"

type SanitizedVariableForLog = Omit<SynapseVariable, "value"> & {
  value: string
}

type SanitizedQuickInputForLog = Pick<SynapseQuickInput, "id" | "directSend"> & {
  contentLength: number
}

type SanitizedGlobalPatchForLog = Omit<
  NonNullable<SynapseConfigPatch["global"]>,
  "variables" | "quickInputs"
> & {
  variables?: SanitizedVariableForLog[]
  quickInputs?: SanitizedQuickInputForLog[]
  quickInputCount?: number
}

export type SanitizedConfigPatchForLog = Omit<SynapseConfigPatch, "global"> & {
  global?: SanitizedGlobalPatchForLog
}

function sanitizeVariableForLog(variable: SynapseVariable): SanitizedVariableForLog {
  return {
    ...variable,
    value: variable.value ? "[redacted]" : variable.value,
  }
}

function summarizeQuickInputForLog(quickInput: SynapseQuickInput): SanitizedQuickInputForLog {
  return {
    id: quickInput.id,
    directSend: quickInput.directSend,
    contentLength: quickInput.content.length,
  }
}

export function sanitizeConfigPatchForLog(patch: SynapseConfigPatch): SanitizedConfigPatchForLog {
  if (!patch.global) {
    const { global: _global, ...patchRest } = patch
    return patchRest
  }

  const { variables, quickInputs, ...globalRest } = patch.global
  const global: SanitizedGlobalPatchForLog = { ...globalRest }

  if (variables) {
    global.variables = variables.map(sanitizeVariableForLog)
  }

  if (quickInputs) {
    global.quickInputs = quickInputs.map(summarizeQuickInputForLog)
    global.quickInputCount = quickInputs.length
  }

  return {
    ...patch,
    global,
  }
}
