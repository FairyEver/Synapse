import { useRef } from "react"
import { FunctionSquare } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Field, FieldContent, FieldLabel } from "@/components/ui/field"
import { InputGroup, InputGroupAddon, InputGroupTextarea } from "@/components/ui/input-group"
import { ConfigurationFieldError, configurationFieldProps, type ConfigurationFieldErrors } from "@/components/configuration-field-error"
import { ActionVariablesDialog } from "./action-variables-dialog"
import type { AutomationTriggerVariableDescriptor } from "../../automation-trigger-packages/types.shared"

type ActionPromptFieldProps = {
  readonly id: string
  readonly value: string
  readonly onChange: (value: string) => void
  readonly variables?: readonly AutomationTriggerVariableDescriptor[]
  readonly triggerTitle?: string
  readonly fieldErrors?: ConfigurationFieldErrors
  readonly placeholder?: string
}

export function ActionPromptField({ fieldErrors, id, value, onChange, variables = [], triggerTitle, placeholder = "输入要发送给 Agent 的提示词..." }: ActionPromptFieldProps) {
  const prompt = useRef<HTMLTextAreaElement>(null)
  const selection = useRef({ start: value.length, end: value.length })

  function insert(template: string) {
    const { start, end } = selection.current
    onChange(value.slice(0, start) + template + value.slice(end))
    selection.current = { start: start + template.length, end: start + template.length }
  }

  return <Field>
    <FieldLabel htmlFor={id}>提示词</FieldLabel>
    <FieldContent>
      <InputGroup>
        <InputGroupTextarea {...configurationFieldProps(fieldErrors, "prompt", id)} ref={prompt} id={id} rows={6}
          placeholder={placeholder} value={value} onChange={event => onChange(event.target.value)} />
        {variables.length ? <InputGroupAddon align="block-end" className="justify-end border-t">
          <ActionVariablesDialog mode="insert" variables={variables} triggerTitle={triggerTitle} targetLabel="提示词" onInsert={insert}
            onOpenChange={open => {
              if (open && prompt.current) selection.current = { start: prompt.current.selectionStart, end: prompt.current.selectionEnd }
            }}
            onCloseAutoFocus={event => {
              event.preventDefault()
              prompt.current?.focus()
              prompt.current?.setSelectionRange(selection.current.start, selection.current.end)
            }}
            trigger={<Button type="button" variant="ghost" size="sm"><FunctionSquare />插入变量</Button>} />
        </InputGroupAddon> : null}
      </InputGroup>
      <ConfigurationFieldError errors={fieldErrors} name="prompt" id={id} />
    </FieldContent>
  </Field>
}
