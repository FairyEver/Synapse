import { useEffect, useId, useRef, type ReactNode } from "react"
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
  onBack, onNext, onCancel, hideNext = false }: {
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
  readonly onNext: () => void
  readonly onCancel: () => void
}) {
  const heading = useRef<HTMLParagraphElement>(null)
  const index = steps.findIndex((entry) => entry.id === step)
  useEffect(() => { heading.current?.focus() }, [step])
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
