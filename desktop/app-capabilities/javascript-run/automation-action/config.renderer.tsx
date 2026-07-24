import { ScriptAutomationConfigForm } from "../../script-runtime/renderer/automation-config-form"
import type { JavascriptAutomationConfig } from "../../script-runtime/shared/schema"

export function JavascriptRunActionConfigForm(props: {
  readonly value: JavascriptAutomationConfig
  readonly onChange: (value: JavascriptAutomationConfig) => void
}) {
  return <ScriptAutomationConfigForm {...props} />
}
