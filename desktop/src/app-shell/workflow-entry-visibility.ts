import { WORKFLOW_ENTRY_CHEAT_CODE_NAME } from "@/lib/cheat-codes/names"
import type { SynapseCheatCodeStateMap } from "@/types/cheat-code"
import { WORKFLOW_ENTRY_VISIBLE_BY_DEFAULT } from "../../config"

type WorkflowEntryVisibilityOptions = {
  readonly visibleByDefault?: boolean
}

export function isWorkflowEntryVisible(
  states: SynapseCheatCodeStateMap,
  options: WorkflowEntryVisibilityOptions = {},
): boolean {
  return (options.visibleByDefault ?? WORKFLOW_ENTRY_VISIBLE_BY_DEFAULT)
    || states[WORKFLOW_ENTRY_CHEAT_CODE_NAME] === true
}
