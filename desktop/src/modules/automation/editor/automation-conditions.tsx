import { Fragment, useEffect, useRef } from "react"
import { ChevronDown, Plus, X } from "lucide-react"

import { TimeRangeField } from "@/automation-triggers/time-range-field"
import { WeekdaySelector } from "@/automation-triggers/weekday-selector"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { AutomationCondition, AutomationConditions } from "@/types/automation"

const CONDITION_LABELS = {
  weekdays: "星期几",
  "daily-time-range": "每天的时间段",
} as const

type AutomationConditionsProps = {
  readonly value?: AutomationConditions
  readonly onChange: (value: AutomationConditions | undefined) => void
  readonly disabled?: boolean
}

export function AutomationConditions({ value, onChange, disabled = false }: AutomationConditionsProps) {
  const section = useRef<HTMLElement>(null)
  const addButton = useRef<HTMLButtonElement>(null)
  const addedCondition = useRef<AutomationCondition["type"] | null>(null)
  const returnToAdd = useRef(false)
  const items = value?.items ?? []
  const operator = value?.operator ?? "and"
  const availableTypes = (Object.keys(CONDITION_LABELS) as Array<keyof typeof CONDITION_LABELS>)
    .filter((type) => !items.some((condition) => condition.type === type))

  useEffect(() => {
    if (!returnToAdd.current) return
    returnToAdd.current = false
    addButton.current?.focus()
  }, [items])

  function update(nextItems: AutomationCondition[], nextOperator = operator) {
    onChange(nextItems.length ? { operator: nextOperator, items: nextItems } : undefined)
  }

  function addCondition(type: AutomationCondition["type"]) {
    addedCondition.current = type
    const condition: AutomationCondition = type === "weekdays"
      ? { type, days: [0, 1, 2, 3, 4, 5, 6] }
      : { type, start: "08:00", end: "17:00" }
    update([...items, condition])
  }

  function replaceCondition(index: number, condition: AutomationCondition) {
    update(items.map((item, itemIndex) => itemIndex === index ? condition : item))
  }

  function removeCondition(index: number) {
    returnToAdd.current = true
    update(items.filter((_, itemIndex) => itemIndex !== index))
  }

  return (
    <section ref={section} aria-labelledby="automation-conditions-heading" className="mt-4 min-w-0">
      <p id="automation-conditions-heading" className="mb-3 text-sm text-muted-foreground">
        {operator === "or" ? "或者符合以下条件" : "并且符合以下条件"}
      </p>
      <div className="rounded-xl border bg-card p-5 text-card-foreground">
        {items.map((condition, index) => (
          <Fragment key={condition.type}>
            {index > 0 ? (
              <div className="my-4 flex items-center gap-3">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" variant="ghost" disabled={disabled} aria-label="切换条件关系" data-track="automation.conditions.relation">
                      {operator === "and" ? "并且" : "或者"}
                      <ChevronDown />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuLabel>条件关系</DropdownMenuLabel>
                    <DropdownMenuRadioGroup
                      value={operator}
                      onValueChange={(nextOperator) => update(items, nextOperator === "or" ? "or" : "and")}
                    >
                      <DropdownMenuRadioItem value="and">并且</DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="or">或者</DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
                <div className="h-px flex-1 bg-border" />
              </div>
            ) : null}
            <div className="grid gap-4" data-condition-type={condition.type}>
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-medium">{CONDITION_LABELS[condition.type]}</h3>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={disabled}
                  aria-label={`删除${CONDITION_LABELS[condition.type]}条件`}
                  data-track="automation.conditions.remove"
                  onClick={() => removeCondition(index)}
                >
                  <X />
                </Button>
              </div>
              {condition.type === "weekdays" ? (
                <div className="grid gap-2">
                  <WeekdaySelector
                    id="automation-conditions-weekdays"
                    aria-labelledby="automation-conditions-weekdays-label"
                    aria-describedby={condition.days.length === 0 ? "automation-conditions-weekdays-error" : undefined}
                    aria-invalid={condition.days.length === 0}
                    value={condition.days}
                    disabled={disabled}
                    onValueChange={(days) => replaceCondition(index, { type: "weekdays", days })}
                  />
                  <span id="automation-conditions-weekdays-label" className="sr-only">星期几</span>
                  {condition.days.length === 0 ? <p id="automation-conditions-weekdays-error" role="alert" className="text-sm text-destructive">至少选择一个星期</p> : null}
                </div>
              ) : (
                <TimeRangeField
                  id="automation-conditions-time-range"
                  value={{ start: condition.start, end: condition.end }}
                  onValueChange={(range) => {
                    if (range) replaceCondition(index, { type: "daily-time-range", ...range })
                    else removeCondition(index)
                  }}
                />
              )}
            </div>
          </Fragment>
        ))}
        {availableTypes.length ? (
          <div className={items.length ? "mt-5 border-t pt-4" : undefined}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button ref={addButton} type="button" variant="ghost" disabled={disabled} data-track="automation.conditions.add">
                  <Plus />
                  添加条件
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" onCloseAutoFocus={(event) => {
                const type = addedCondition.current
                addedCondition.current = null
                if (!type) return
                const control = section.current?.querySelector<HTMLElement>(type === "weekdays"
                  ? '[data-slot="weekday-selector"] [role="checkbox"]'
                  : '#automation-conditions-time-range')
                if (control) { event.preventDefault(); control.focus() }
              }}>
                {availableTypes.map((type) => (
                  <DropdownMenuItem key={type} onSelect={() => addCondition(type)}>
                    {CONDITION_LABELS[type]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : null}
      </div>
    </section>
  )
}
