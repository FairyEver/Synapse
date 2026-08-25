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

export type SanitizedConfigPatchForLog = Omit<SynapseConfigPatch, "global" | "agent"> & {
  global?: SanitizedGlobalPatchForLog
  agent?: Omit<NonNullable<SynapseConfigPatch["agent"]>, "recentSlashSkills"> & {
    recentSlashSkillCount?: number
  }
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
  const { global: globalPatch, agent: agentPatch, ...patchRest } = patch
  const sanitized: SanitizedConfigPatchForLog = { ...patchRest }

  if (globalPatch) {
    const { variables, quickInputs, ...globalRest } = globalPatch
    const global: SanitizedGlobalPatchForLog = { ...globalRest }

    if (variables) {
      global.variables = variables.map(sanitizeVariableForLog)
    }

    if (quickInputs) {
      global.quickInputs = quickInputs.map(summarizeQuickInputForLog)
      global.quickInputCount = quickInputs.length
    }
    sanitized.global = global
  }

  if (agentPatch) {
    const { recentSlashSkills, ...agentRest } = agentPatch
    sanitized.agent = {
      ...agentRest,
      ...(recentSlashSkills ? { recentSlashSkillCount: recentSlashSkills.length } : {}),
    }
  }

  return sanitized
}
