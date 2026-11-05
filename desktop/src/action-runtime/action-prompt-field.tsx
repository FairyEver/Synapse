import { useRef, useState } from "react"
import { Braces, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Field, FieldContent, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Textarea } from "@/components/ui/textarea"
import type { AutomationTriggerVariableDescriptor } from "../../automation-trigger-packages/types.shared"

type ActionPromptFieldProps = {
  readonly id: string
  readonly value: string
  readonly onChange: (value: string) => void
  readonly variables?: readonly AutomationTriggerVariableDescriptor[]
}

export function ActionPromptField({ id, value, onChange, variables = [] }: ActionPromptFieldProps) {
  const prompt = useRef<HTMLTextAreaElement>(null)
  const selection = useRef({ start: value.length, end: value.length })
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [paths, setPaths] = useState<Record<string, string>>({})
  const restoreCaret = useRef<number | null>(null)
  const query = search.trim().toLowerCase()
  const filtered = variables.filter(variable => `${variable.label} ${variable.key}`.toLowerCase().includes(query))

  function insert(key: string) {
    const template = `{{${key}}}`
    const { start, end } = selection.current
    onChange(value.slice(0, start) + template + value.slice(end))
    restoreCaret.current = start + template.length
    setOpen(false)
  }

  return <Field>
    <div className="flex min-w-0 items-center justify-between gap-2">
      <FieldLabel htmlFor={id}>提示词</FieldLabel>
      {variables.length ? <Popover open={open} onOpenChange={setOpen} data-track="automation.prompt.variables">
        <PopoverTrigger asChild><Button type="button" variant="ghost" size="sm" onClick={() => {
          if (prompt.current) selection.current = { start: prompt.current.selectionStart, end: prompt.current.selectionEnd }
          setOpen(true)
        }}><Braces />插入变量</Button></PopoverTrigger>
        <PopoverContent align="end" aria-label="插入触发变量" className="w-80 max-w-[calc(100vw-2rem)]" onCloseAutoFocus={event => {
          if (restoreCaret.current === null) return
          event.preventDefault()
          prompt.current?.focus()
          prompt.current?.setSelectionRange(restoreCaret.current, restoreCaret.current)
          selection.current = { start: restoreCaret.current, end: restoreCaret.current }
          restoreCaret.current = null
        }}>
          <Input aria-label="搜索可插入变量" placeholder="搜索变量" value={search} onChange={event => setSearch(event.target.value)} />
          <div className="max-h-64 overflow-y-auto">
            {filtered.map(variable => {
              const path = (paths[variable.key] ?? "").trim().replace(/^\.+/u, "")
              const key = variable.dynamic && path ? `${variable.key}.${path}` : variable.key
              return <div key={variable.key} className="min-w-0">
                <Button type="button" variant="ghost" className="h-auto w-full justify-start whitespace-normal text-left" aria-label={`插入 {{${key}}}`} onClick={() => insert(key)}>
                  <Plus /><span className="grid min-w-0 gap-1"><span>{variable.label}</span><code className="break-all text-xs font-normal text-muted-foreground">{`{{${key}}}`}</code></span>
                </Button>
                {variable.dynamic ? <Input aria-label={`${variable.label} 字段路径`} placeholder="字段路径（可选）" value={paths[variable.key] ?? ""} className="mb-2" onChange={event => setPaths(current => ({ ...current, [variable.key]: event.target.value }))} /> : null}
              </div>
            })}
            {!filtered.length ? <p className="p-3 text-sm text-muted-foreground">没有匹配变量</p> : null}
          </div>
        </PopoverContent>
      </Popover> : null}
    </div>
    <FieldContent><Textarea ref={prompt} id={id} rows={6} placeholder="输入要发送给 Agent 的提示词..." value={value} onChange={event => onChange(event.target.value)} /></FieldContent>
  </Field>
}
