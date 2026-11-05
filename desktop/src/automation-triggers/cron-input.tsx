import { useEffect, useMemo, useRef, useState } from "react"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { CronEditorFields } from "./cron-editor-dialog"
import { buildCronExpression, createDefaultCronTemplateDraft, getCronEditorInitialTab, inferCronTemplate, listNextCronRuns, validateCronExpression, type CronEditorTab, type CronTemplateDraft } from "./cron-utils"

type CronInputProps = {
  disabled?: boolean
  layout?: "compact" | "inline"
  id: string
  value: string
  onChange: (value: string) => void
}

function CronInput({ disabled, id, value, onChange, layout = "compact" }: CronInputProps) {
  const [expanded, setExpanded] = useState(false)
  const [tab, setTab] = useState<CronEditorTab>(() => getCronEditorInitialTab(value))
  const [template, setTemplate] = useState(() => inferCronTemplate(value) ?? createDefaultCronTemplateDraft())
  const lastValue = useRef(value)
  const validation = validateCronExpression(value)
  const previewRuns = useMemo(() => validation.ok ? listNextCronRuns(value, new Date(), 5) : [], [value, validation.ok])
  useEffect(() => {
    if (value === lastValue.current) return
    lastValue.current = value
    setTemplate(inferCronTemplate(value) ?? createDefaultCronTemplateDraft())
    setTab(getCronEditorInitialTab(value))
  }, [value])
  function emit(next: string) {
    lastValue.current = next
    onChange(next)
  }
  function change(next: string) {
    const inferred = inferCronTemplate(next)
    if (inferred) setTemplate(inferred)
    emit(next)
  }
  function changeTemplate(patch: Partial<CronTemplateDraft>) {
    const next = { ...template, ...patch }
    setTemplate(next)
    emit(buildCronExpression(next))
  }
  if (layout === "inline") return <CronEditorFields expressionId={id} collapsePreview activeTab={tab} draft={value} previewRuns={previewRuns} template={template} validation={validation}
    onDraftChange={change} onTabChange={setTab} onTemplateChange={changeTemplate} />
  return (
    <div className="grid min-w-0 gap-3">
      <InputGroup>
        <InputGroupInput id={id} disabled={disabled} value={value} onChange={(event) => {
          change(event.target.value)
          setTab(getCronEditorInitialTab(event.target.value))
        }} />
        <InputGroupAddon align="inline-end">
          <InputGroupButton type="button" disabled={disabled} aria-expanded={expanded} aria-controls={`${id}-editor`} onClick={() => setExpanded(!expanded)}>
            {expanded ? "收起" : "编辑"}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      {expanded ? (
        <div id={`${id}-editor`} className="min-w-0 border-t pt-3">
          <CronEditorFields activeTab={tab} draft={value} previewRuns={previewRuns} template={template} validation={validation}
            onDraftChange={change} onTabChange={setTab} onTemplateChange={changeTemplate} />
        </div>
      ) : null}
    </div>
  )
}
export { CronInput }
export type { CronInputProps }
