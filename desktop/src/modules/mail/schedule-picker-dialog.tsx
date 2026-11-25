import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react"
import { addHours, addMinutes, addYears, format, nextMonday, setHours, setMilliseconds, setMinutes, setSeconds, startOfDay } from "date-fns"
import { zhCN } from "date-fns/locale"
import { Clock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { FieldError } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { MAIL_SCHEDULED_MAX_AHEAD_YEARS, MAIL_SCHEDULED_MIN_LEAD_MS } from "../../../app-capabilities/mail/shared/limits"

export interface MailSchedulePickerDialogProps {
  open: boolean
  title?: string
  confirmLabel?: string
  initialSendAt?: string | null
  busy?: boolean
  onOpenChange(open: boolean): void
  onConfirm(sendAtIso: string): Promise<void> | void
}

function toDateValue(date: Date): string {
  return format(date, "yyyy-MM-dd")
}

function toTimeValue(date: Date): string {
  return format(date, "HH:mm")
}

function parseLocalDate(dateStr: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(dateStr)) return undefined
  const [y, m, d] = dateStr.split("-").map(Number)
  const parsed = new Date(y, m - 1, d)
  if (parsed.getFullYear() !== y || parsed.getMonth() !== m - 1 || parsed.getDate() !== d) return undefined
  return parsed
}

function combineLocalDateTime(dateStr: string, timeStr: string): Date | null {
  const date = parseLocalDate(dateStr)
  if (!date || !/^\d{2}:\d{2}$/u.test(timeStr)) return null
  const [hours, minutes] = timeStr.split(":").map(Number)
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null
  return setMilliseconds(setSeconds(setMinutes(setHours(date, hours), minutes), 0), 0)
}

function buildPresets(now: Date): { key: string; label: string; target: Date; disabled: boolean }[] {
  const oneHourLater = setMilliseconds(setSeconds(addHours(addMinutes(now, 1), 1), 0), 0)
  const todayEvening = setMilliseconds(setSeconds(setMinutes(setHours(now, 18), 0), 0), 0)
  const tomorrowMorning = setMilliseconds(setSeconds(setMinutes(setHours(addHours(startOfDay(now), 24), 9), 0), 0), 0)
  const nextMondayMorning = setMilliseconds(setSeconds(setMinutes(setHours(nextMonday(now), 9), 0), 0), 0)
  const minMs = now.getTime() + MAIL_SCHEDULED_MIN_LEAD_MS
  return [
    { key: "1h", label: "1 小时后", target: oneHourLater, disabled: oneHourLater.getTime() < minMs },
    { key: "today-18", label: "今天 18:00", target: todayEvening, disabled: todayEvening.getTime() < minMs },
    { key: "tomorrow-9", label: "明天 09:00", target: tomorrowMorning, disabled: tomorrowMorning.getTime() < minMs },
    { key: "next-mon-9", label: "下周一 09:00", target: nextMondayMorning, disabled: nextMondayMorning.getTime() < minMs },
  ]
}

function defaultTarget(now: Date, initialSendAt?: string | null): Date {
  if (initialSendAt) {
    const parsed = new Date(initialSendAt)
    if (Number.isFinite(parsed.getTime()) && parsed.getTime() >= now.getTime() + MAIL_SCHEDULED_MIN_LEAD_MS) return parsed
  }
  return setMilliseconds(setSeconds(addHours(addMinutes(now, 1), 1), 0), 0)
}

export function MailSchedulePickerDialog({
  open,
  title = "定时发送",
  confirmLabel = "确认定时发送",
  initialSendAt,
  busy = false,
  onOpenChange,
  onConfirm,
}: MailSchedulePickerDialogProps) {
  const idPrefix = useId()
  const dateId = `${idPrefix}-date`
  const timeId = `${idPrefix}-time`
  const errorId = `${idPrefix}-error`
  const dateInputRef = useRef<HTMLInputElement>(null)
  const timeInputRef = useRef<HTMLInputElement>(null)

  const [now, setNow] = useState(() => new Date())
  const [dateStr, setDateStr] = useState(() => toDateValue(defaultTarget(new Date(), initialSendAt)))
  const [timeStr, setTimeStr] = useState(() => toTimeValue(defaultTarget(new Date(), initialSendAt)))
  const [month, setMonth] = useState<Date>(() => defaultTarget(new Date(), initialSendAt))
  const [error, setError] = useState<{ field: "date" | "time"; message: string } | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    const current = new Date()
    const seed = defaultTarget(current, initialSendAt)
    setNow(current)
    setDateStr(toDateValue(seed))
    setTimeStr(toTimeValue(seed))
    setMonth(seed)
    setError(null)
    setSubmitting(false)
    const timer = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [open, initialSendAt])

  const presets = useMemo(() => buildPresets(now), [now])
  const selectedDate = useMemo(() => parseLocalDate(dateStr), [dateStr])
  const combined = useMemo(() => combineLocalDateTime(dateStr, timeStr), [dateStr, timeStr])
  const today = useMemo(() => startOfDay(now), [now])
  const maxDate = useMemo(() => addYears(today, MAIL_SCHEDULED_MAX_AHEAD_YEARS), [today])
  const todayStr = useMemo(() => toDateValue(today), [today])
  const maxDateStr = useMemo(() => toDateValue(maxDate), [maxDate])

  const previewText = useMemo(() => {
    if (!combined) return null
    return format(combined, "yyyy年M月d日 EEE HH:mm", { locale: zhCN })
  }, [combined])

  const applyTarget = (target: Date) => {
    setDateStr(toDateValue(target))
    setTimeStr(toTimeValue(target))
    setMonth(target)
    setError(null)
  }

  const handleCalendarSelect = (date: Date | undefined) => {
    if (!date) return
    setDateStr(toDateValue(date))
    setMonth(date)
    setError(null)
  }

  const handleDateChange = (next: string) => {
    setDateStr(next)
    setError(null)
    const parsed = parseLocalDate(next)
    if (parsed) setMonth(parsed)
  }

  const handleTimeChange = (next: string) => {
    setTimeStr(next)
    setError(null)
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy || submitting) return
    const currentNow = new Date()
    const parsedDate = parseLocalDate(dateStr)
    if (!parsedDate) {
      setError({ field: "date", message: "请选择或输入有效的未来日期" })
      dateInputRef.current?.focus()
      return
    }
    const target = combineLocalDateTime(dateStr, timeStr)
    if (!target) {
      setError({ field: "time", message: "请输入有效的发送时间（时:分）" })
      timeInputRef.current?.focus()
      return
    }
    if (target.getTime() < currentNow.getTime() + MAIL_SCHEDULED_MIN_LEAD_MS) {
      const sameDay = toDateValue(target) === toDateValue(currentNow)
      setError({ field: sameDay ? "time" : "date", message: "发送时间必须晚于当前时间" })
      ;(sameDay ? timeInputRef : dateInputRef).current?.focus()
      return
    }
    if (target.getTime() > addYears(currentNow, MAIL_SCHEDULED_MAX_AHEAD_YEARS).getTime()) {
      setError({ field: "date", message: `发送时间不能超过 ${MAIL_SCHEDULED_MAX_AHEAD_YEARS} 年` })
      dateInputRef.current?.focus()
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await onConfirm(target.toISOString())
      onOpenChange(false)
    } catch (cause) {
      setError({ field: "time", message: cause instanceof Error ? cause.message : "设置定时发送失败" })
    } finally {
      setSubmitting(false)
    }
  }

  const disabled = busy || submitting

  return (
    <Dialog open={open} onOpenChange={next => { if (!disabled) onOpenChange(next) }}>
      <DialogContent className="max-h-[calc(100vh-2rem)] max-w-md overflow-y-auto" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form noValidate onSubmit={event => void handleSubmit(event)} className="space-y-4">
          <div className="grid grid-cols-2 gap-2" role="group" aria-label="快捷时间">
            {presets.map(preset => {
              const activePreset = !preset.disabled && toDateValue(preset.target) === dateStr && toTimeValue(preset.target) === timeStr
              return (
                <Button
                  key={preset.key}
                  type="button"
                  variant={activePreset ? "secondary" : "outline"}
                  size="sm"
                  disabled={disabled || preset.disabled}
                  data-track={`mail.schedule.preset.${preset.key}`}
                  onClick={() => applyTarget(preset.target)}
                  className="justify-between font-normal"
                >
                  <span>{preset.label}</span>
                  <span className="tabular-nums text-xs text-muted-foreground">{format(preset.target, "MM-dd HH:mm")}</span>
                </Button>
              )
            })}
          </div>

          <div className="rounded-md border p-2">
            <Calendar
              mode="single"
              captionLayout="dropdown"
              locale={zhCN}
              month={month}
              onMonthChange={setMonth}
              startMonth={today}
              endMonth={maxDate}
              selected={selectedDate}
              onSelect={handleCalendarSelect}
              disabled={{ before: today, after: maxDate }}
              fullWidth
              className="p-0"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor={dateId}>发送日期</Label>
              <Input
                ref={dateInputRef}
                id={dateId}
                name="scheduleDate"
                type="date"
                min={todayStr}
                max={maxDateStr}
                value={dateStr}
                disabled={disabled}
                aria-invalid={error?.field === "date" ? "true" : "false"}
                aria-describedby={error?.field === "date" ? errorId : undefined}
                onChange={event => handleDateChange(event.target.value)}
                data-track="mail.schedule.date"
                className="tabular-nums"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={timeId}>发送时间</Label>
              <Input
                ref={timeInputRef}
                id={timeId}
                name="scheduleTime"
                type="time"
                step={60}
                value={timeStr}
                disabled={disabled}
                aria-invalid={error?.field === "time" ? "true" : "false"}
                aria-describedby={error?.field === "time" ? errorId : undefined}
                onChange={event => handleTimeChange(event.target.value)}
                data-track="mail.schedule.time"
                className="tabular-nums"
              />
            </div>
          </div>

          {error && <FieldError id={errorId}>{error.message}</FieldError>}

          <div className="space-y-1 text-xs text-muted-foreground">
            {previewText && (
              <p role="status" className="flex items-center gap-1.5 text-sm font-medium text-foreground tabular-nums">
                <Clock className="size-3.5 shrink-0 text-muted-foreground" />
                <span>将于 {previewText} 发送</span>
              </p>
            )}
            <p>到点时需保持 Synapse 运行并联网。</p>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" disabled={disabled} onClick={() => onOpenChange(false)}>取消</Button>
            <Button type="submit" disabled={disabled} data-track="mail.schedule.confirm">
              {disabled ? "处理中…" : confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
