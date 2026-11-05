import { useEffect, useId, useRef, type ReactNode } from "react"
import { Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DialogFrameBody, DialogFrameFooter, DialogFrameHeader } from "@/components/ui/dialog"
import { Field, FieldContent, FieldDescription, FieldLabel, FieldLegend, FieldSet, FieldTitle } from "@/components/ui/field"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"

export interface GuidedChoice {
  readonly value: string
  readonly title: string
  readonly description?: string
  readonly disabled?: boolean
  readonly icon?: ReactNode
}

/** 单选决策：默认更新草稿；onSelect 使用按钮立即确认选择，由业务 hook 推进。 */
export function GuidedChoices({ title, value, options, onChange, onSelect, disabled = false }: {
  readonly title: string
  readonly value: string
  readonly options: readonly GuidedChoice[]
  readonly onSelect?: (value: string) => void
  readonly onChange?: (value: string) => void
  readonly disabled?: boolean
}) {
  const id = useId()
  return (
    <FieldSet disabled={disabled}>
      <FieldLegend id={`${id}-title`}>{title}</FieldLegend>
      {onSelect ? <div className="grid gap-3" role="group" aria-labelledby={`${id}-title`}>
        {options.map((option, index) => <Button key={option.value} type="button" variant="outline"
          className="h-auto w-full justify-start gap-3 whitespace-normal px-4 py-4 text-left"
          disabled={disabled || option.disabled} onClick={() => onSelect(option.value)}
          aria-labelledby={`${id}-${index}-label`} aria-describedby={option.description ? `${id}-${index}-description` : undefined}>
          {option.icon}
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span id={`${id}-${index}-label`}>{option.title}</span>
            {option.description && <span id={`${id}-${index}-description`} className="font-normal text-muted-foreground">{option.description}</span>}
          </span>
        </Button>)}
      </div> : <RadioGroup value={value} onValueChange={onChange} disabled={disabled} aria-labelledby={`${id}-title`}>
        {options.map((option, index) => {
          const optionId = `${id}-${index}`
          return (
            <FieldLabel key={option.value} htmlFor={optionId}>
              <Field orientation="horizontal" data-disabled={disabled || option.disabled} data-checked={value === option.value ? "" : undefined}>
                <RadioGroupItem id={optionId} value={option.value} disabled={disabled || option.disabled}
                  aria-labelledby={`${optionId}-label`} aria-describedby={option.description ? `${optionId}-description` : undefined} />
                {option.icon}
                <FieldContent>
                  <FieldTitle id={`${optionId}-label`}>{option.title}</FieldTitle>
                  {option.description && <FieldDescription id={`${optionId}-description`}>{option.description}</FieldDescription>}
                </FieldContent>
              </Field>
            </FieldLabel>
          )
        })}
      </RadioGroup>}
    </FieldSet>
  )
}

/** 壳仅负责进度、焦点和动作；分支、校验、异步请求由业务 hook 管理。 */
export function GuidedFlow({ title, step, steps, children, busy, nextLabel = "下一步", canNext = true, destructive,
  onBack, onNext, onCancel, hideNext = false, layout = "dialog", actions }: {
  readonly title: string
  readonly step: string
  readonly steps: readonly { readonly id: string; readonly title: string }[]
  readonly children: ReactNode
  readonly busy?: boolean
  readonly nextLabel?: string
  readonly canNext?: boolean
  readonly destructive?: boolean
  readonly onBack?: () => void
  readonly hideNext?: boolean
  readonly layout?: "dialog" | "page"
  readonly actions?: ReactNode
  readonly onNext: () => void
  readonly onCancel: () => void
}) {
  const heading = useRef<HTMLParagraphElement>(null)
  const index = steps.findIndex((entry) => entry.id === step)
  useEffect(() => { heading.current?.focus() }, [step])
  if (layout === "page") {
    return (
      <div className="min-w-0" data-layout="guided-flow-page">
        <h1 className="mb-7 text-2xl font-semibold">{title}</h1>
        <p ref={heading} tabIndex={-1} className="sr-only" aria-live="polite">
          第 {index + 1} 步 / 共 {steps.length} 步 · {steps[index]?.title}
        </p>
        <ol className="mb-8 flex items-center gap-4" aria-label="配置步骤">
          {steps.map((entry, entryIndex) => (
            <li key={entry.id} aria-current={entry.id === step ? "step" : undefined}
              className="flex min-w-0 flex-1 items-center gap-3 last:flex-none">
              <span className={entryIndex <= index
                ? "flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground"
                : "flex size-7 shrink-0 items-center justify-center rounded-full border text-xs text-muted-foreground"}>
                {entryIndex < index ? <Check className="size-3.5" /> : entryIndex + 1}
              </span>
              <span className={entryIndex <= index ? "text-sm font-medium" : "text-sm text-muted-foreground"}>{entry.title}</span>
              {entryIndex < steps.length - 1 ? <span className="h-px min-w-2 flex-1 bg-border" /> : null}
            </li>
          ))}
        </ol>
        <div className="min-w-0" aria-busy={busy}>{children}</div>
        <div role="group" aria-label="表单操作" className="mt-8 flex flex-wrap items-center justify-between gap-3">
          <Button variant="ghost" disabled={busy} onClick={onBack ?? onCancel}>{onBack ? "上一步" : "取消"}</Button>
          <div className="ml-auto flex flex-wrap gap-2">
            {actions ?? (!hideNext && <Button disabled={busy || !canNext} onClick={onNext}>{busy ? "正在处理…" : nextLabel}</Button>)}
          </div>
        </div>
      </div>
    )
  }
  return (
    <>
      <DialogFrameHeader title={title} bordered>
        <p ref={heading} tabIndex={-1} className="text-sm text-muted-foreground" aria-live="polite">
          第 {index + 1} 步 / 共 {steps.length} 步 · {steps[index]?.title}
        </p>
      </DialogFrameHeader>
      <DialogFrameBody className="overflow-auto px-5 py-5" aria-busy={busy}>
        {children}
      </DialogFrameBody>
      <DialogFrameFooter className="flex-row items-center justify-between sm:justify-between">
        <div>
          {onBack && <Button variant="ghost" disabled={busy} onClick={onBack}>上一步</Button>}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" disabled={busy} onClick={onCancel}>取消</Button>
          {!hideNext && <Button disabled={busy || !canNext} variant={destructive ? "destructive" : "default"} onClick={onNext}>
            {busy ? "正在处理…" : nextLabel}
          </Button>}
        </div>
      </DialogFrameFooter>
    </>
  )
}
