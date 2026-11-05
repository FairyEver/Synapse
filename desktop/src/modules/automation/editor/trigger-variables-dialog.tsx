import { FunctionSquare } from "lucide-react"

import { ActionVariablesDialog } from "@/action-runtime/action-variables-dialog"
import { Button } from "@/components/ui/button"
import type { AutomationTriggerVariableDescriptor } from "../../../../automation-trigger-packages/types.shared"

export function TriggerVariablesDialog({ triggerTitle, variables }: {
  readonly triggerTitle: string
  readonly variables: readonly AutomationTriggerVariableDescriptor[]
}) {
  return <ActionVariablesDialog mode="view" triggerTitle={triggerTitle} variables={variables}
    trigger={<Button type="button" variant="ghost" size="icon" aria-label="查看触发变量" title="查看触发变量"><FunctionSquare /></Button>} />
}
