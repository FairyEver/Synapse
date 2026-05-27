import { WORKFLOW_ENTRY_CHEAT_CODE_NAME } from "@/lib/cheat-codes/names"
import type { SynapseCheatCodeStateMap } from "@/types/cheat-code"

export function isWorkflowEntryVisible(states: SynapseCheatCodeStateMap): boolean {
  return states[WORKFLOW_ENTRY_CHEAT_CODE_NAME] === true
}
