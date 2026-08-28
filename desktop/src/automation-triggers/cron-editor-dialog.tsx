import { useEffect, useMemo, useRef, useState, type FormEvent, type RefObject } from "react"

import { FormDialog } from "@/components/form-dialog"
import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import {
  Field,
  FieldContent,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { formatDateTime } from "@/lib/date-time"
import { track } from "@/lib/ui-tracking"
import {
  buildCronExpression,
  createDefaultCronTemplateDraft,
  getCronEditorInitialTab,
  inferCronTemplate,
  listNextCronRuns,
  validateCronExpression,
  type CronEditorTab,
  type CronTemplateDraft,
  type CronTemplateKind,
} from "./cron-utils"

type CronEditorDialogProps = {
  open: boolean
  value: string
  returnFocusRef?: RefObject<HTMLButtonElement | null>
  onApply: (value: string) => void
  onOpenChange: (open: boolean) => void
}

type CronEditorFieldsProps = {
  activeTab: CronEditorTab
  draft: string
  previewRuns: Date[]
  template: CronTemplateDraft
  validation: ReturnType<typeof validateCronExpression>
  onDraftChange: (value: string) => void
  onTabChange: (tab: CronEditorTab) => void
  onTemplateChange: (patch: Partial<CronTemplateDraft>) => void
}

const TEMPLATE_OPTIONS: Array<{ value: CronTemplateKind; label: string }> = [
  { value: "every_minutes", label: "每 N 分钟" },
  { value: "hourly", label: "每小时" },
  { value: "daily", label: "每天" },
  { value: "weekly", label: "每周" },
  { value: "monthly", label: "每月" },
  { value: "weekdays", label: "工作日" },
]

const WEEKDAY_OPTIONS = [
  { value: "0", label: "周日" },
  { value: "1", label: "周一" },
  { value: "2", label: "周二" },
  { value: "3", label: "周三" },
  { value: "4", label: "周四" },
  { value: "5", label: "周五" },
  { value: "6", label: "周六" },
] as const

function CronEditorDialog({
  open,
  value,
  returnFocusRef,
  onApply,
  onOpenChange,
}: CronEditorDialogProps) {
  const wasOpenRef = useRef(open)
  const matchedTemplate = inferCronTemplate(value)
  const [draft, setDraft] = useState(value)
  const [template, setTemplate] = useState<CronTemplateDraft>(
    matchedTemplate ?? createDefaultCronTemplateDraft(),
  )
  const [activeTab, setActiveTab] = useState<CronEditorTab>(() => getCronEditorInitialTab(value))
  const validation = validateCronExpression(draft)
  const previewRuns = useMemo(() => {
    if (!validation.ok) return []
    return listNextCronRuns(draft, new Date(), 5)
  }, [draft, validation.ok])

  useEffect(() => {
    if (!open) return
    const nextTemplate = inferCronTemplate(value)
    setDraft(value)
    setTemplate(nextTemplate ?? createDefaultCronTemplateDraft())
    setActiveTab(getCronEditorInitialTab(value))
  }, [open, value])

  useEffect(() => {
    if (wasOpenRef.current && !open) {
      returnFocusRef?.current?.focus()
    }
    wasOpenRef.current = open
  }, [open, returnFocusRef])

  function updateTemplate(patch: Partial<CronTemplateDraft>) {
    setTemplate((current) => {
      const next = { ...current, ...patch }
      setDraft(buildCronExpression(next))
      return next
    })
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const currentValidation = validateCronExpression(draft)
    if (!currentValidation.ok) return
    track({
      component: "automation",
      name: "automation-cron-apply",
      action: "submit",
      metadata: {
        boundary: "renderer.automation.cron-editor",
        activeTab,
        expressionLength: draft.length,
        previewCount: previewRuns.length,
      },
    })
    onApply(draft)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <FormDialog
        title="编辑 Cron"
        bodyClassName="min-h-0"
        contentClassName="sm:max-w-[560px]"
        footer={(
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={!validation.ok}>
              应用
            </Button>
          </div>
        )}
        onSubmit={handleSubmit}
      >
        <CronEditorFields
          activeTab={activeTab}
          draft={draft}
          previewRuns={previewRuns}
          template={template}
          validation={validation}
          onDraftChange={setDraft}
          onTabChange={setActiveTab}
          onTemplateChange={updateTemplate}
        />
      </FormDialog>
    </Dialog>
  )
}

function CronEditorFields({
  activeTab,
  draft,
  previewRuns,
  template,
  validation,
  onDraftChange,
  onTabChange,
  onTemplateChange,
}: CronEditorFieldsProps) {
  return (
    <FieldGroup className="gap-2">
      <Tabs
        data-track="cron-editor-tabs"
        value={activeTab}
        onValueChange={(nextTab) => onTabChange(nextTab as CronEditorTab)}
      >
        <TabsList>
          <TabsTrigger value="common">常用</TabsTrigger>
          <TabsTrigger value="advanced">高级</TabsTrigger>
        </TabsList>
        <TabsContent forceMount value="common" className="data-[state=inactive]:hidden">
          <CommonTemplateFields
            template={template}
            onTemplateChange={onTemplateChange}
          />
        </TabsContent>
        <TabsContent forceMount value="advanced" className="data-[state=inactive]:hidden">
          <Field data-invalid={validation.ok ? undefined : true}>
            <FieldLabel htmlFor="cron-editor-expression">表达式</FieldLabel>
            <FieldContent>
              <Input
                id="cron-editor-expression"
                value={draft}
                aria-invalid={validation.ok ? undefined : true}
                onChange={(event) => onDraftChange(event.target.value)}
              />
              <FieldError>{validation.ok ? null : validation.message}</FieldError>
            </FieldContent>
          </Field>
        </TabsContent>
      </Tabs>

      {validation.ok ? <PreviewField validation={validation} runs={previewRuns} /> : null}
    </FieldGroup>
  )
}

function CommonTemplateFields({
  template,
  onTemplateChange,
}: {
  template: CronTemplateDraft
  onTemplateChange: (patch: Partial<CronTemplateDraft>) => void
}) {
  return (
    <FieldGroup className="gap-2">
      <Field>
        <FieldLabel htmlFor="cron-editor-template">计划</FieldLabel>
        <FieldContent>
          <Select
            value={template.kind}
            onValueChange={(kind) => onTemplateChange({ kind: kind as CronTemplateKind })}
          >
            <SelectTrigger id="cron-editor-template" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {TEMPLATE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </FieldContent>
      </Field>

      <FieldGroup className="grid gap-2 sm:grid-cols-2">
        {template.kind === "every_minutes" ? (
          <NumberField
            id="cron-editor-every-minutes"
            label="间隔分钟"
            min={1}
            max={59}
            value={template.everyMinutes}
            onChange={(everyMinutes) => onTemplateChange({ everyMinutes })}
          />
        ) : null}
        {template.kind === "daily" || template.kind === "weekly" || template.kind === "monthly" || template.kind === "weekdays" ? (
          <NumberField
            id="cron-editor-hour"
            label="小时"
            min={0}
            max={23}
            value={template.hour}
            onChange={(hour) => onTemplateChange({ hour })}
          />
        ) : null}
        {template.kind !== "every_minutes" ? (
          <NumberField
            id="cron-editor-minute"
            label="分钟"
            min={0}
            max={59}
            value={template.minute}
            onChange={(minute) => onTemplateChange({ minute })}
          />
        ) : null}
        {template.kind === "monthly" ? (
          <NumberField
            id="cron-editor-day"
            label="日期"
            min={1}
            max={31}
            value={template.dayOfMonth}
            onChange={(dayOfMonth) => onTemplateChange({ dayOfMonth })}
          />
        ) : null}
        {template.kind === "weekly" ? (
          <WeekdayField
            value={template.weekday}
            onChange={(weekday) => onTemplateChange({ weekday })}
          />
        ) : null}
      </FieldGroup>
    </FieldGroup>
  )
}

function NumberField({
  id,
  label,
  max,
  min,
  value,
  onChange,
}: {
  id: string
  label: string
  max: number
  min: number
  value: number
  onChange: (value: number) => void
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <FieldContent>
        <Input
          id={id}
          type="number"
          min={min}
          max={max}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
        />
      </FieldContent>
    </Field>
  )
}

function WeekdayField({
  value,
  onChange,
}: {
  value: number
  onChange: (value: number) => void
}) {
  return (
    <Field>
      <FieldLabel htmlFor="cron-editor-weekday">星期</FieldLabel>
      <FieldContent>
        <Select
          value={String(value)}
          onValueChange={(nextValue) => onChange(Number(nextValue))}
        >
          <SelectTrigger id="cron-editor-weekday" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {WEEKDAY_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </FieldContent>
    </Field>
  )
}

function PreviewField({
  validation,
  runs,
}: {
  validation: ReturnType<typeof validateCronExpression>
  runs: Date[]
}) {
  return (
    <Field data-invalid={validation.ok ? undefined : true}>
      <FieldLabel>未来 5 次</FieldLabel>
      <FieldContent>
        {validation.ok ? (
          <div className="grid gap-1 text-sm text-muted-foreground">
            {runs.map((run) => (
              <span key={run.toISOString()}>{formatDateTime(run.toISOString())}</span>
            ))}
          </div>
        ) : (
          <FieldError>{validation.message}</FieldError>
        )}
      </FieldContent>
    </Field>
  )
}

export { CronEditorDialog, CronEditorFields }
export type { CronEditorDialogProps, CronEditorFieldsProps }
