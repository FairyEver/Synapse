import { useCallback, useEffect, useId, useRef, useState } from "react"
import { zhCN } from "date-fns/locale"
import { format } from "date-fns"
import { Calendar as CalendarIcon, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  buildTodoDeadlinePresets,
  getTodoCustomDueDefault,
  type TodoDeadlinePresetKey,
} from "./todo-deadline-presets"
import { todoLocalToUtc } from "./todo-time"

export type TodoDuePickerProps = {
  open: boolean
  value: string
  disabled?: boolean
  onOpenChange: (open: boolean) => void
  onChange: (value: string) => void
}

type DueView = "quick" | "custom"

function existingLocalDate(value: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return undefined
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date : undefined
}

function isValidLocalDue(value: string): boolean {
  try {
    return todoLocalToUtc(value) !== null
  } catch {
    return false
  }
}

export function TodoDuePicker({
  open,
  value,
  disabled = false,
  onOpenChange,
  onChange,
}: TodoDuePickerProps) {
  const prefix = useId()
  const titleId = `${prefix}-title`
  const customDateLabelId = `${prefix}-custom-date`
  const customTimeId = `${prefix}-custom-time`
  const [view, setView] = useState<DueView>("quick")
  const [now, setNow] = useState(() => new Date())
  const [customDate, setCustomDate] = useState<Date | undefined>(undefined)
  const [customTime, setCustomTime] = useState("")
  const customSeeded = useRef(false)
  const trigger = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    setView("quick")
    setNow(new Date())
    customSeeded.current = false
    const timer = window.setInterval(() => setNow(new Date()), 60_000)
    return () => window.clearInterval(timer)
  }, [open])

  const seedCustom = useCallback(() => {
    if (customSeeded.current) return
    customSeeded.current = true
    const existing = existingLocalDate(value)
    if (existing) {
      setCustomDate(existing)
      setCustomTime(format(existing, "HH:mm"))
      return
    }
    const fallback = getTodoCustomDueDefault(new Date())
    setCustomDate(fallback.date)
    setCustomTime(fallback.time)
  }, [value])

  const changeView = (next: string) => {
    if (next === "custom") seedCustom()
    setView(next === "custom" ? "custom" : "quick")
  }

  const selectPreset = (key: TodoDeadlinePresetKey) => {
    const latest = buildTodoDeadlinePresets(new Date())
    const preset = latest.find((item) => item.key === key)
    if (!preset || preset.disabled) {
      setNow(new Date())
      return
    }
    onChange(preset.localValue)
    onOpenChange(false)
    trigger.current?.focus()
  }

  const close = () => {
    onOpenChange(false)
    trigger.current?.focus()
  }

  const presets = buildTodoDeadlinePresets(now)
  const customValue = customDate && customTime
    ? `${format(customDate, "yyyy-MM-dd")}T${customTime}`
    : ""
  const customValid = !!customValue && isValidLocalDue(customValue)

  return (
    <Popover open={open} onOpenChange={onOpenChange} data-track="todos.quick-due">
      <PopoverTrigger asChild>
        <Button
          ref={trigger}
          type="button"
          variant={value ? "secondary" : "ghost"}
          data-track="todos.quick-due"
          disabled={disabled}
        >
          <CalendarIcon data-icon="inline-start" />
          {value ? `截止 ${value.slice(5).replace("T", " ")}` : "截止时间"}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        aria-labelledby={titleId}
        className="max-h-(--radix-popover-content-available-height) w-[352px] max-w-[calc(100vw-2rem)] gap-0 overflow-y-auto p-0"
      >
        <PopoverHeader className="flex-row items-center justify-between gap-3 px-3 py-2.5">
          <PopoverTitle id={titleId}>设置截止时间</PopoverTitle>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="关闭截止时间"
            data-track="todos.quick-due.close"
            onClick={close}
          >
            <X />
          </Button>
        </PopoverHeader>
        <Separator />
        <Tabs value={view} onValueChange={changeView} className="gap-2" data-track="todos.quick-due.view">
          <TabsList className="mx-3 mt-2 h-8 w-[calc(100%-1.5rem)]">
            <TabsTrigger value="quick">快捷</TabsTrigger>
            <TabsTrigger value="custom">自定义</TabsTrigger>
          </TabsList>
          <TabsContent value="quick" className="mt-0">
            <div className="grid grid-cols-2 gap-1.5 px-3 pb-3">
              {presets.map((preset) => (
                <Button
                  key={preset.key}
                  type="button"
                  variant={!preset.disabled && preset.localValue === value ? "secondary" : "outline"}
                  disabled={preset.disabled}
                  data-track={`todos.quick-due.${preset.key}`}
                  data-preset-key={preset.key}
                  className="h-auto min-h-12 flex-col items-start justify-center gap-0.5 whitespace-normal px-2.5 py-2 text-left"
                  onClick={() => selectPreset(preset.key)}
                >
                  <span>{preset.label}</span>
                  <span className="text-xs font-normal text-muted-foreground">
                    {preset.display}{preset.disabled ? " · 已过" : ""}
                  </span>
                </Button>
              ))}
            </div>
          </TabsContent>
          <TabsContent value="custom" className="mt-0">
            <div className="flex flex-col gap-2 px-3 pb-3">
              <div className="flex flex-col gap-1.5">
                <span id={customDateLabelId} className="text-sm font-medium">日期</span>
                <Calendar
                  mode="single"
                  locale={zhCN}
                  selected={customDate}
                  onSelect={setCustomDate}
                  aria-labelledby={customDateLabelId}
                  className="p-0"
                />
              </div>
              <div className="flex items-center gap-2">
                <Label htmlFor={customTimeId}>时间</Label>
                <Input
                  id={customTimeId}
                  type="time"
                  step={60}
                  value={customTime}
                  data-track="todos.quick-due.custom-time"
                  className="w-32"
                  onChange={(event) => setCustomTime(event.target.value)}
                />
              </div>
            </div>
            <Separator />
            <div className="flex items-center justify-between gap-2 px-3 py-2">
              {value
                ? <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    data-track="todos.quick-due.clear"
                    onClick={() => {
                      onChange("")
                      close()
                    }}
                  >
                    清除截止时间
                  </Button>
                : <span />}
              <div className="flex gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-track="todos.quick-due.custom-cancel"
                  onClick={close}
                >
                  取消
                </Button>
                <Button
                  type="button"
                  size="sm"
                  data-track="todos.quick-due.custom-confirm"
                  disabled={!customValid}
                  onClick={() => {
                    if (!customValid) return
                    onChange(customValue)
                    close()
                  }}
                >
                  完成
                </Button>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </PopoverContent>
    </Popover>
  )
}
