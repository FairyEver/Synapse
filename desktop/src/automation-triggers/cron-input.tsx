import { useEffect, useMemo, useRef, useState } from "react"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import type { AutomationConditions } from "@/types/automation"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { CronEditorFields } from "./cron-editor-dialog"
import { buildCronExpression, createDefaultCronTemplateDraft, getCronEditorInitialTab, inferCronTemplate, listNextCronRuns, validateCronExpression, type CronEditorTab, type CronTemplateDraft } from "./cron-utils"

type CronInputProps = {
  timezone?: string
  conditions?: AutomationConditions
  disabled?: boolean
  layout?: "compact" | "inline"
  id: string
  value: string
  onChange: (value: string) => void
}

function CronInput({ timezone, conditions, disabled, id, value, onChange, layout = "compact" }: CronInputProps) {
  const [previewOpen, setPreviewOpen] = useState(false)
  const [confirmCommon, setConfirmCommon] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [tab, setTab] = useState<CronEditorTab>(() => getCronEditorInitialTab(value))
  const [template, setTemplate] = useState(() => inferCronTemplate(value) ?? createDefaultCronTemplateDraft())
  const lastValue = useRef(value)
  const validation = validateCronExpression(value)
  const shouldPreview = layout === "inline" ? previewOpen : expanded
  const preview = useMemo(() => {
    if (!shouldPreview || !validation.ok) return { runs: [] as Date[], error: undefined as string | undefined }
    try { return { runs: listNextCronRuns(value, new Date(), 5, { timezone, conditions }), error: undefined } }
    catch { return { runs: [], error: "无法计算运行时间，请检查表达式和时区" } }
  }, [value, validation.ok, shouldPreview, timezone, conditions])
  const previewRuns = preview.runs
  function changeTab(next: CronEditorTab) {
    if (next === "common" && !inferCronTemplate(value)) { setConfirmCommon(true); return }
    setTab(next)
  }
  const conversion = <AlertDialog open={confirmCommon} onOpenChange={setConfirmCommon}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>改用常用计划？</AlertDialogTitle><AlertDialogDescription>当前表达式将替换为 {buildCronExpression(template)}。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction onClick={() => { emit(buildCronExpression(template)); setTab("common") }}>确认替换</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
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
  if (layout === "inline") return <>{conversion}<CronEditorFields timezone={timezone} previewError={preview.error} onPreviewOpenChange={setPreviewOpen} expressionId={id} collapsePreview activeTab={tab} draft={value} previewRuns={previewRuns} template={template} validation={validation}
    onDraftChange={change} onTabChange={changeTab} onTemplateChange={changeTemplate} /></>
  return (
    <div className="grid min-w-0 gap-3">
      {conversion}
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
          <CronEditorFields timezone={timezone} previewError={preview.error} activeTab={tab} draft={value} previewRuns={previewRuns} template={template} validation={validation}
            onDraftChange={change} onTabChange={changeTab} onTemplateChange={changeTemplate} />
        </div>
      ) : null}
    </div>
  )
}
export { CronInput }
export type { CronInputProps }
