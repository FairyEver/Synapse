import { useRef } from "react"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import type { VariableBinding } from "./schemas/variable-binding"

interface PromptEditorProps {
  value: string
  onChange: (value: string) => void
  onBlur: () => void
  variables: VariableBinding[]
  placeholder?: string
  rows?: number
}

export function PromptEditor({ value, onChange, onBlur, variables, placeholder, rows = 8 }: PromptEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const insertVariable = (name: string) => {
    const el = textareaRef.current
    if (!el) return
    const insertion = `{{${name}}}`
    const start = el.selectionStart
    const end = el.selectionEnd
    const next = value.slice(0, start) + insertion + value.slice(end)
    onChange(next)
    requestAnimationFrame(() => {
      el.focus()
      const cursor = start + insertion.length
      el.setSelectionRange(cursor, cursor)
    })
  }

  const namedVariables = variables.filter((v) => v.name.trim())

  return (
    <div className="grid gap-0">
      <Textarea
        ref={textareaRef}
        className="text-xs resize-none rounded-b-none border-b-0 focus-visible:z-10"
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
      />
      <div className="flex items-center gap-1.5 flex-wrap border rounded-b-md px-2 py-1.5 bg-muted/30">
        {namedVariables.map((v) => (
          <Badge
            key={v.name}
            variant="secondary"
            className="cursor-pointer text-[10px] h-4 px-1.5"
            onClick={() => insertVariable(v.name)}
          >
            {v.name}
          </Badge>
        ))}
        <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">{value.length}字</span>
      </div>
    </div>
  )
}
