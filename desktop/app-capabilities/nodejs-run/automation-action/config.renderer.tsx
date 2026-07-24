import { ScriptAutomationConfigForm } from "../../script-runtime/renderer/automation-config-form"
import type { NodejsAutomationConfig } from "../../script-runtime/shared/schema"

export function NodejsRunActionConfigForm(props: {
  readonly value: NodejsAutomationConfig
  readonly onChange: (value: NodejsAutomationConfig) => void
}) {
  return <ScriptAutomationConfigForm {...props} nodejs />
}
