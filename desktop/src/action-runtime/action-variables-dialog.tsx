import { useId, useRef, useState, type ComponentProps, type ReactElement } from "react"
import { ChevronDown, ChevronUp, Copy, Plus, Search, X } from "lucide-react"

import { readVariablePath } from "../../automation-trigger-packages/variable-contract"
import { previewVariableSample, variablePathSuffix } from "./variable-sample"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFrameFooter, DialogFrameHeader, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { AutomationTriggerVariableDescriptor } from "../../automation-trigger-packages/types.shared"

type VariableGroup = NonNullable<AutomationTriggerVariableDescriptor["group"]> | "other"
type GroupFilter = VariableGroup | "all"
const GROUPS: readonly VariableGroup[] = ["event", "trigger", "config", "other"]
const GROUP_LABELS: Record<GroupFilter, string> = {
  event: "事件内容", trigger: "触发信息", config: "触发器配置", other: "其它", all: "全部",
}
type ActionVariablesDialogProps = {
  readonly variables: readonly AutomationTriggerVariableDescriptor[]
  readonly triggerTitle?: string
  readonly trigger: ReactElement
  readonly onOpenChange?: (open: boolean) => void
  readonly onCloseAutoFocus?: ComponentProps<typeof DialogContent>["onCloseAutoFocus"]
} & (
  | { readonly mode: "view" }
  | { readonly mode: "insert"; readonly targetLabel: string; readonly onInsert: (template: string) => void }
)

function groupFor(variable: AutomationTriggerVariableDescriptor): VariableGroup {
  return variable.group ?? "other"
}

export function ActionVariablesDialog(props: ActionVariablesDialogProps) {
  const [open, setOpen] = useState(false)
  if (!props.variables.length) return null

  function changeOpen(nextOpen: boolean) {
    props.onOpenChange?.(nextOpen)
    setOpen(nextOpen)
  }

  function insert(template: string) {
    if (props.mode !== "insert") return
    props.onInsert(template)
    changeOpen(false)
  }

  return <Dialog open={open} onOpenChange={changeOpen} data-track={`automation.variables.${props.mode}`}>
    <DialogTrigger asChild>{props.trigger}</DialogTrigger>
    {open ? <DialogContent showCloseButton={false} onCloseAutoFocus={props.onCloseAutoFocus}
      className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
      <DialogFrameHeader title={props.mode === "view" ? "触发变量" : "插入变量"}>
        <DialogDescription className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
          <span>{props.triggerTitle ? `来自「${props.triggerTitle}」` : "触发器变量"}</span>
          {props.mode === "insert" ? <span>插入到「{props.targetLabel}」</span> : null}
        </DialogDescription>
      </DialogFrameHeader>
      <VariableCatalog key={props.triggerTitle} variables={props.variables} mode={props.mode} onInsert={insert} />
    </DialogContent> : null}
  </Dialog>
}

function VariableCatalog({ variables, mode, onInsert }: {
  readonly variables: readonly AutomationTriggerVariableDescriptor[]
  readonly mode: "view" | "insert"
  readonly onInsert: (template: string) => void
}) {
  const [search, setSearch] = useState("")
  const [group, setGroup] = useState<GroupFilter>(() => GROUPS.find(id => variables.some(v => groupFor(v) === id)) ?? "all")
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const [copyState, setCopyState] = useState<{ template: string; success: boolean } | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const availableGroups = GROUPS.filter(id => variables.some(v => groupFor(v) === id))
  const query = search.trim().toLowerCase()
  const filtered = variables.filter(variable => (group === "all" || groupFor(variable) === group)
    && [variable.label, variable.key, variable.description ?? "", variable.example ?? ""].join(" ").toLowerCase().includes(query))
  const action = mode === "view" ? "复制" : "插入"

  async function choose(template: string) {
    if (mode === "insert") { onInsert(template); return }
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable")
      await navigator.clipboard.writeText(template)
      setCopyState({ template, success: true })
    } catch {
      setCopyState({ template, success: false })
    }
  }

  function clearFilters() {
    setSearch(""); setGroup("all"); setExpandedKey(null); setCopyState(null)
    searchRef.current?.focus()
  }

  return <>
    <div className="grid shrink-0 gap-3 border-b px-5 pb-3">
      <InputGroup>
        <InputGroupAddon><Search aria-hidden="true" /></InputGroupAddon>
        <InputGroupInput ref={searchRef} autoFocus aria-label="搜索变量" placeholder="搜索名称或变量路径" value={search}
          onChange={event => { setSearch(event.target.value); setExpandedKey(null); setCopyState(null) }} />
        {search ? <InputGroupAddon align="inline-end"><InputGroupButton size="icon-xs" aria-label="清除搜索"
          onClick={() => { setSearch(""); searchRef.current?.focus() }}><X /></InputGroupButton></InputGroupAddon> : null}
      </InputGroup>
      <div className="flex flex-wrap gap-1" role="group" aria-label="变量分组">
        {[...availableGroups, "all" as const].map(id => <Button key={id} type="button" size="sm"
          variant="ghost" className={group === id ? "bg-selected hover:bg-selected" : undefined} aria-pressed={group === id}
          onClick={() => { setGroup(id); setExpandedKey(null); setCopyState(null) }}>{GROUP_LABELS[id]}</Button>)}
      </div>
    </div>
    <ScrollArea className="h-96 min-h-0 flex-1" viewportClassName="overflow-x-hidden" data-track="automation.variables.list">
      <div className="grid min-w-0 gap-2 px-3 py-2">
        {filtered.length ? availableGroups.map(id => {
          const entries = filtered.filter(v => groupFor(v) === id)
          return entries.length ? <section key={id} className="min-w-0">
            {group === "all" ? <h3 className="px-2 py-2 text-xs font-medium text-muted-foreground">{GROUP_LABELS[id]}</h3> : null}
            {entries.map(variable => <VariableRow key={variable.key} variable={variable} action={action}
              expanded={expandedKey === variable.key} onExpand={() => setExpandedKey(expandedKey === variable.key ? null : variable.key)}
              onChoose={template => void choose(template)} />)}
          </section> : null
        }) : <div className="grid justify-items-center gap-4 py-12 text-sm">
          <p className="text-muted-foreground">没有匹配变量</p><Button type="button" variant="outline" onClick={clearFilters}>清除筛选</Button>
        </div>}
      </div>
    </ScrollArea>
    <DialogFrameFooter className="flex-row items-center justify-between sm:justify-between">
      <div className="grid min-w-0 gap-2 text-xs" role="status" aria-live="polite">
        {copyState ? <>
          <p className={copyState.success ? "break-all text-muted-foreground" : "text-destructive"}>
            {copyState.success ? `已复制 ${copyState.template}` : "复制失败，请手动复制模板"}
          </p>
          {!copyState.success ? <Input aria-label="手动复制变量" readOnly value={copyState.template}
            onFocus={event => event.currentTarget.select()} /> : null}
        </> : null}
      </div>
      <DialogClose asChild><Button type="button" variant="outline">关闭</Button></DialogClose>
    </DialogFrameFooter>
  </>
}

function VariableRow({ variable, action, expanded, onExpand, onChoose }: {
  readonly variable: AutomationTriggerVariableDescriptor
  readonly action: "复制" | "插入"
  readonly expanded: boolean
  readonly onExpand: () => void
  readonly onChoose: (template: string) => void
}) {
  const [path, setPath] = useState("")
  const [sample, setSample] = useState("")
  const pathId = useId()
  const suffix = variablePathSuffix(path)
  const key = `${variable.key}${suffix}`
  const template = `{{${key}}}`
  let pathError: string | null = null
  try { readVariablePath({}, suffix) } catch (error) { pathError = error instanceof Error ? error.message : "字段路径无效" }
  const valid = !pathError
  const preview = previewVariableSample(sample, suffix)
  const ActionIcon = action === "复制" ? Copy : Plus
  return <div className="min-w-0">
    <Button type="button" variant="ghost" className="h-auto w-full justify-between gap-3 px-2 py-1.5 text-left whitespace-normal"
      aria-label={variable.dynamic ? `设置 ${variable.label}` : `${action} {{${variable.key}}}`}
      aria-expanded={variable.dynamic ? expanded : undefined} aria-controls={variable.dynamic && expanded ? pathId : undefined}
      onClick={variable.dynamic ? onExpand : () => onChoose(`{{${variable.key}}}`)}>
      <span className="grid min-w-0 gap-1">
        <span className="flex flex-wrap items-center gap-2"><span>{variable.label}</span>{variable.dynamic ? <Badge variant="outline">可指定路径</Badge> : null}</span>
        <code className="break-all text-xs font-normal text-muted-foreground">{`{{${variable.key}}}`}</code>
        {variable.description ? <span className="text-xs font-normal text-muted-foreground">{variable.description}</span> : null}
        {variable.example ? <span className="break-all text-xs font-normal text-muted-foreground">{variable.example}</span> : null}
      </span>
      {variable.dynamic ? (expanded ? <ChevronUp /> : <ChevronDown />) : <ActionIcon className="text-muted-foreground" />}
    </Button>
    {variable.dynamic && expanded ? <div id={pathId} className="grid min-w-0 gap-2 border-b px-2 pt-3 pb-4">
      <label htmlFor={`${pathId}-input`} className="text-xs text-muted-foreground">字段路径（可选）</label>
      <div className="flex flex-wrap gap-2">
        <Input id={`${pathId}-input`} autoFocus aria-label={`${variable.label} 字段路径`} value={path} placeholder="例如 order.id"
          aria-invalid={!valid} aria-describedby={`${pathId}-hint${valid ? "" : ` ${pathId}-error`}`}
          className="min-w-0 basis-48 font-mono sm:flex-1" onChange={event => setPath(event.target.value)} />
        <Button type="button" variant="outline" disabled={!valid} onClick={() => onChoose(template)}><ActionIcon />{action}</Button>
      </div>
      <p id={`${pathId}-hint`} className="text-xs text-muted-foreground">留空引用整个值；数组使用 items.0.id；含点的字段名使用 #/order.id；花括号和空格使用 %7B、%7D、%20 编码。</p>
      {!valid ? <p id={`${pathId}-error`} role="alert" className="text-xs text-destructive">{pathError}</p> : null}
      <label htmlFor={`${pathId}-sample`} className="text-xs text-muted-foreground">测试数据（JSON）</label>
      <Textarea id={`${pathId}-sample`} aria-label={`${variable.label} 测试数据`} value={sample}
        placeholder={variable.example ?? '{"order":{"id":"ORDER-1"}}'} onChange={event => setSample(event.target.value)} />
      {preview ? <div role="status" aria-live="polite" className="text-xs">
        {preview.error ? <p className="text-destructive">{preview.error}</p> : <pre aria-label="预览值" className="whitespace-pre-wrap break-all">{preview.text}</pre>}
      </div> : null}
      <code className="break-all rounded-md bg-muted px-3 py-2 text-xs">{template}</code>
    </div> : null}
  </div>
}
