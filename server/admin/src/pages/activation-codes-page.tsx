import * as React from "react"
import { CopyIcon, PlusIcon } from "lucide-react"
import { PageState } from "@/components/page-state"
import { StatusBadge } from "@/components/status-badge"
import {
  ManagedStatusActionButtons,
  TableActionButton,
  TableActionCell,
  TableActionHead,
} from "@/components/table-actions"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useApiResource } from "@/hooks/use-api-resource"
import { adminApi, type ActivationAttempt, type ActivationCode, type ManagedStatus } from "@/lib/api"
import { formatDate } from "@/lib/format"

type ExpirationMode = "date" | "duration"
type DurationUnit = "minutes" | "hours" | "days" | "months" | "years"

const durationUnitOptions: Array<{ label: string; value: DurationUnit }> = [
  { label: "分钟", value: "minutes" },
  { label: "小时", value: "hours" },
  { label: "天", value: "days" },
  { label: "月", value: "months" },
  { label: "年", value: "years" },
]
const minActivationCodeQuantity = 1
const maxActivationCodeQuantity = 100
const maxDevicesSliderValue = 4
const maxQuantitySliderValue = 100

export function resolveActivationCodeExpiresAt(
  input: {
    readonly mode: ExpirationMode
    readonly fixedDate: string
    readonly durationAmount: string
    readonly durationUnit: DurationUnit
  },
  now = new Date(),
): string | null {
  if (input.mode === "date") {
    return input.fixedDate || null
  }

  const amount = Number(input.durationAmount)
  if (!Number.isInteger(amount) || amount < 1) {
    throw new Error("时长无效")
  }

  return addDuration(now, amount, input.durationUnit).toISOString()
}

function addDuration(now: Date, amount: number, unit: DurationUnit): Date {
  const expiresAt = new Date(now)
  switch (unit) {
    case "minutes":
      expiresAt.setMinutes(expiresAt.getMinutes() + amount)
      break
    case "hours":
      expiresAt.setHours(expiresAt.getHours() + amount)
      break
    case "days":
      expiresAt.setDate(expiresAt.getDate() + amount)
      break
    case "months":
      expiresAt.setMonth(expiresAt.getMonth() + amount)
      break
    case "years":
      expiresAt.setFullYear(expiresAt.getFullYear() + amount)
      break
  }
  return expiresAt
}

function sanitizeIntegerInput(value: string): string {
  return value.replace(/\D/g, "")
}

function sliderValueFor(value: string, max: number): number {
  const numericValue = Number(value)
  if (!Number.isInteger(numericValue) || numericValue < 1) return 1
  return Math.min(numericValue, max)
}

function SliderNumberField({
  id,
  inputMax,
  label,
  onChange,
  sliderMax,
  value,
}: {
  readonly id: string
  readonly inputMax?: number
  readonly label: string
  readonly onChange: (value: string) => void
  readonly sliderMax: number
  readonly value: string
}) {
  return (
    <div className="grid gap-2">
      <Label id={`${id}-label`} htmlFor={id}>
        {label}
      </Label>
      <div className="grid grid-cols-[minmax(0,1fr)_5rem] items-center gap-3">
        <Slider
          aria-labelledby={`${id}-label`}
          min={1}
          max={sliderMax}
          step={1}
          value={[sliderValueFor(value, sliderMax)]}
          onValueChange={(nextValue) => onChange(String(nextValue[0] ?? 1))}
        />
        <Input
          id={id}
          type="number"
          inputMode="numeric"
          min={1}
          max={inputMax}
          value={value}
          onChange={(event) => onChange(sanitizeIntegerInput(event.target.value))}
          required
        />
      </div>
    </div>
  )
}

export function ActivationCodesPage() {
  const [includeArchived, setIncludeArchived] = React.useState(false)
  const { data, error, loading, reload } = useApiResource(
    () => adminApi.listActivationCodes({ includeArchived }),
    [includeArchived]
  )
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set())
  const [batchBusy, setBatchBusy] = React.useState(false)
  const [open, setOpen] = React.useState(false)
  const [maxDevices, setMaxDevices] = React.useState("1")
  const [quantity, setQuantity] = React.useState("1")
  const [expiresAt, setExpiresAt] = React.useState("")
  const [expirationMode, setExpirationMode] = React.useState<ExpirationMode>("duration")
  const [durationAmount, setDurationAmount] = React.useState("1")
  const [durationUnit, setDurationUnit] = React.useState<DurationUnit>("months")
  const [generatedCodes, setGeneratedCodes] = React.useState<string[]>([])
  const [generatedCodesOpen, setGeneratedCodesOpen] = React.useState(false)
  const [copyState, setCopyState] = React.useState<"idle" | "copied" | "failed">("idle")
  const [attemptsOpen, setAttemptsOpen] = React.useState(false)
  const [attemptsLoading, setAttemptsLoading] = React.useState(false)
  const [attemptsError, setAttemptsError] = React.useState<string | null>(null)
  const [attempts, setAttempts] = React.useState<ActivationAttempt[]>([])
  const [selectedCodeHint, setSelectedCodeHint] = React.useState<string | null>(null)
  const [formError, setFormError] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)
  const [reservedEmailMode, setReservedEmailMode] = React.useState<"none" | "single" | "list">("none")
  const [reservedEmail, setReservedEmail] = React.useState("")
  const [reservedEmailList, setReservedEmailList] = React.useState("")

  async function createActivationCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const deviceCount = Number(maxDevices)
    if (!Number.isInteger(deviceCount) || deviceCount < 1) {
      setFormError("设备数无效")
      return
    }
    const activationCodeQuantity = Number(quantity)
    if (
      !Number.isInteger(activationCodeQuantity)
      || activationCodeQuantity < minActivationCodeQuantity
      || activationCodeQuantity > maxActivationCodeQuantity
    ) {
      setFormError("数量无效")
      return
    }

    let requestExpiresAt: string | null
    try {
      requestExpiresAt = resolveActivationCodeExpiresAt({
        mode: expirationMode,
        fixedDate: expiresAt,
        durationAmount,
        durationUnit,
      })
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : "到期日无效")
      return
    }

    const reservedEmailPayload: { reservedEmail?: string; reservedEmails?: string[] } = {}
    if (reservedEmailMode === "single" && reservedEmail.trim()) {
      reservedEmailPayload.reservedEmail = reservedEmail.trim()
    } else if (reservedEmailMode === "list" && reservedEmailList.trim()) {
      reservedEmailPayload.reservedEmails = reservedEmailList
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
    }

    setSubmitting(true)
    setFormError(null)
    try {
      const result = await adminApi.createActivationCode({
        maxDevices: deviceCount,
        expiresAt: requestExpiresAt,
        quantity: activationCodeQuantity,
        ...reservedEmailPayload,
      })
      setGeneratedCodes(result.map((item) => item.code))
      setGeneratedCodesOpen(true)
      setCopyState("idle")
      setMaxDevices("1")
      setQuantity("1")
      setExpiresAt("")
      setExpirationMode("duration")
      setDurationAmount("1")
      setDurationUnit("months")
      setReservedEmailMode("none")
      setReservedEmail("")
      setReservedEmailList("")
      setOpen(false)
      reload()
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : "创建失败")
    } finally {
      setSubmitting(false)
    }
  }

  async function updateStatus(id: string, status: ManagedStatus) {
    await adminApi.updateActivationCode(id, status)
    reload()
  }

  async function archiveActivationCode(id: string) {
    await adminApi.archiveActivationCode(id)
    reload()
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    if (!data) return
    if (selectedIds.size === data.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(data.map((item) => item.id)))
    }
  }

  async function batchArchive() {
    if (selectedIds.size === 0) return
    setBatchBusy(true)
    try {
      await adminApi.batchUpdateActivationCodes({ ids: [...selectedIds], action: "archive" })
      setSelectedIds(new Set())
      reload()
    } finally {
      setBatchBusy(false)
    }
  }

  async function batchUpdateStatus(status: ManagedStatus) {
    if (selectedIds.size === 0) return
    setBatchBusy(true)
    try {
      await adminApi.batchUpdateActivationCodes({ ids: [...selectedIds], action: "updateStatus", status })
      setSelectedIds(new Set())
      reload()
    } finally {
      setBatchBusy(false)
    }
  }

  async function openAttempts(item: ActivationCode) {
    setSelectedCodeHint(item.codeHint)
    setAttemptsOpen(true)
    setAttempts([])
    setAttemptsError(null)
    setAttemptsLoading(true)
    try {
      setAttempts(await adminApi.listActivationAttempts(item.id))
    } catch (caught) {
      setAttemptsError(caught instanceof Error ? caught.message : "加载失败")
    } finally {
      setAttemptsLoading(false)
    }
  }

  async function unlockActivationCode(id: string) {
    await adminApi.updateActivationCodeRiskLock(id, { locked: false, note: null })
    reload()
  }

  async function replaceActivationCode(id: string) {
    const result = await adminApi.replaceActivationCode(id)
    setGeneratedCodes([result.code])
    setGeneratedCodesOpen(true)
    setCopyState("idle")
    reload()
  }

  async function copyGeneratedCodes() {
    try {
      await navigator.clipboard.writeText(generatedCodes.join("\n"))
      setCopyState("copied")
    } catch {
      setCopyState("failed")
    }
  }

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Checkbox
              id="include-archived"
              checked={includeArchived}
              onCheckedChange={(checked) => setIncludeArchived(checked === true)}
            />
            <Label htmlFor="include-archived">包含已归档</Label>
          </div>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <PlusIcon data-icon="inline-start" />
              新建
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>新建激活码</DialogTitle>
              <DialogDescription className="sr-only">系统生成激活码。</DialogDescription>
            </DialogHeader>
            <form className="grid gap-4" onSubmit={createActivationCode}>
              <SliderNumberField
                id="max-devices"
                label="设备数"
                value={maxDevices}
                sliderMax={maxDevicesSliderValue}
                onChange={setMaxDevices}
              />
              <div className={reservedEmailMode === "list" ? "opacity-50 pointer-events-none" : undefined}>
                <SliderNumberField
                  id="activation-code-quantity"
                  label="数量"
                  value={quantity}
                  inputMax={maxActivationCodeQuantity}
                  sliderMax={maxQuantitySliderValue}
                  onChange={setQuantity}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="expiration-mode">到期方式</Label>
                <Select
                  value={expirationMode}
                  onValueChange={(value) => setExpirationMode(value as ExpirationMode)}
                >
                  <SelectTrigger id="expiration-mode" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="date">固定日期</SelectItem>
                      <SelectItem value="duration">按时长</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
              {expirationMode === "date" ? (
                <div className="grid gap-2">
                  <Label htmlFor="expires-at">到期日</Label>
                  <Input
                    id="expires-at"
                    type="date"
                    value={expiresAt}
                    onChange={(event) => setExpiresAt(event.target.value)}
                  />
                </div>
              ) : (
                <div className="grid gap-2">
                  <Label htmlFor="duration-amount">有效时长</Label>
                  <div className="grid grid-cols-[minmax(0,1fr)_8rem] gap-2">
                    <Input
                      id="duration-amount"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={durationAmount}
                      onChange={(event) => setDurationAmount(sanitizeIntegerInput(event.target.value))}
                      required
                    />
                    <Select
                      value={durationUnit}
                      onValueChange={(value) => setDurationUnit(value as DurationUnit)}
                    >
                      <SelectTrigger id="duration-unit" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {durationUnitOptions.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}
              <div className="grid gap-2">
                <Label htmlFor="reserved-email-mode">预绑定邮箱</Label>
                <Select
                  value={reservedEmailMode}
                  onValueChange={(value) => setReservedEmailMode(value as "none" | "single" | "list")}
                >
                  <SelectTrigger id="reserved-email-mode" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="none">不绑定</SelectItem>
                      <SelectItem value="single">统一邮箱</SelectItem>
                      <SelectItem value="list">邮箱列表</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
              {reservedEmailMode === "single" ? (
                <div className="grid gap-2">
                  <Label htmlFor="reserved-email">邮箱</Label>
                  <Input
                    id="reserved-email"
                    type="email"
                    placeholder="user@example.com"
                    value={reservedEmail}
                    onChange={(event) => setReservedEmail(event.target.value)}
                    required
                  />
                </div>
              ) : null}
              {reservedEmailMode === "list" ? (
                <div className="grid gap-2">
                  <Label htmlFor="reserved-email-list">邮箱列表（每行一个）</Label>
                  <textarea
                    id="reserved-email-list"
                    className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    placeholder={"user1@example.com\nuser2@example.com"}
                    value={reservedEmailList}
                    onChange={(event) => {
                      setReservedEmailList(event.target.value)
                      const lines = event.target.value.split("\n").filter((line) => line.trim())
                      if (lines.length > 0) setQuantity(String(lines.length))
                    }}
                    required
                  />
                </div>
              ) : null}
              {formError ? (
                <div className="text-sm text-destructive">{formError}</div>
              ) : null}
              <DialogFooter>
                <Button type="submit" disabled={submitting}>
                  保存
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
        <Dialog
          open={generatedCodesOpen}
          onOpenChange={(nextOpen) => {
            setGeneratedCodesOpen(nextOpen)
            if (!nextOpen) {
              setGeneratedCodes([])
              setCopyState("idle")
            }
          }}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>本次生成的激活码</DialogTitle>
              <DialogDescription>只会在此处显示一次，关闭后无法找回。</DialogDescription>
            </DialogHeader>
            <div className="grid max-h-72 gap-2 overflow-auto">
              {generatedCodes.map((code) => (
                <code key={code} className="rounded bg-muted px-2 py-1 font-mono text-sm">
                  {code}
                </code>
              ))}
            </div>
            {copyState === "failed" ? (
              <div className="text-sm text-destructive">复制失败</div>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={copyGeneratedCodes}>
                <CopyIcon data-icon="inline-start" />
                {copyState === "copied" ? "已复制" : "一键复制"}
              </Button>
              <DialogClose asChild>
                <Button type="button">完成</Button>
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Dialog open={attemptsOpen} onOpenChange={setAttemptsOpen}>
          <DialogContent className="sm:max-w-4xl">
            <DialogHeader>
              <DialogTitle>激活记录</DialogTitle>
              <DialogDescription className="sr-only">{selectedCodeHint ?? "激活码"}</DialogDescription>
            </DialogHeader>
            {attemptsLoading ? <PageState>加载中</PageState> : null}
            {attemptsError ? <PageState>{attemptsError}</PageState> : null}
            {!attemptsLoading && !attemptsError && attempts.length === 0 ? (
              <PageState>暂无记录</PageState>
            ) : null}
            {attempts.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>时间</TableHead>
                    <TableHead>结果</TableHead>
                    <TableHead>邮箱</TableHead>
                    <TableHead>设备</TableHead>
                    <TableHead>IP</TableHead>
                    <TableHead>User-Agent</TableHead>
                    <TableHead>原因</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {attempts.map((attempt) => (
                    <TableRow key={attempt.id}>
                      <TableCell>{formatDate(attempt.createdAt)}</TableCell>
                      <TableCell>{attempt.outcome}</TableCell>
                      <TableCell>{attempt.email}</TableCell>
                      <TableCell>{attempt.deviceIdHash}</TableCell>
                      <TableCell>{attempt.ipAddress}</TableCell>
                      <TableCell>{attempt.userAgent}</TableCell>
                      <TableCell>{attempt.reason}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : null}
          </DialogContent>
        </Dialog>
      </div>
      {loading ? <PageState>加载中</PageState> : null}
      {error ? <PageState>{error}</PageState> : null}
      {!loading && !error && data?.length === 0 ? <PageState>暂无激活码</PageState> : null}
      {data && data.length > 0 ? (
        <>
          {selectedIds.size > 0 ? (
            <div className="flex items-center gap-2 rounded-md border bg-muted/50 px-3 py-2 text-sm">
              <span>已选 {selectedIds.size} 项</span>
              <Button variant="outline" size="sm" disabled={batchBusy} onClick={batchArchive}>
                批量归档
              </Button>
              <Button variant="outline" size="sm" disabled={batchBusy} onClick={() => batchUpdateStatus("disabled")}>
                批量禁用
              </Button>
              <Button variant="outline" size="sm" disabled={batchBusy} onClick={() => batchUpdateStatus("revoked")}>
                批量撤销
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>
                取消
              </Button>
            </div>
          ) : null}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={data.length > 0 && selectedIds.size === data.length}
                    onCheckedChange={toggleAll}
                    aria-label="全选"
                  />
                </TableHead>
              <TableHead>状态</TableHead>
              <TableHead>风控</TableHead>
              <TableHead>激活码标识</TableHead>
              <TableHead className="text-right">设备数</TableHead>
              <TableHead>到期</TableHead>
              <TableHead>邮箱</TableHead>
              <TableHead>预绑定</TableHead>
              <TableHead>兑换</TableHead>
              <TableHead>创建</TableHead>
              <TableActionHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((item) => (
              <TableRow key={item.id}>
                <TableCell>
                  <Checkbox
                    checked={selectedIds.has(item.id)}
                    onCheckedChange={() => toggleSelected(item.id)}
                    aria-label={`选择 ${item.codeHint ?? item.id}`}
                  />
                </TableCell>
                <TableCell>
                  <StatusBadge status={item.status} />
                </TableCell>
                <TableCell>{item.riskLockedAt ? "已锁定" : "正常"}</TableCell>
                <TableCell>{item.codeHint ?? "无"}</TableCell>
                <TableCell className="text-right">{item.maxDevices}</TableCell>
                <TableCell>{formatDate(item.expiresAt)}</TableCell>
                <TableCell>{item.boundAccount?.email ?? "无"}</TableCell>
                <TableCell>{item.reservedEmail ?? "—"}</TableCell>
                <TableCell>{formatDate(item.redeemedAt)}</TableCell>
                <TableCell>{formatDate(item.createdAt)}</TableCell>
                <TableActionCell>
                  <ManagedStatusActionButtons
                    value={item.status}
                    onChange={(next) => updateStatus(item.id, next)}
                  >
                    <TableActionButton
                      type="button"
                      onClick={() => {
                        void openAttempts(item)
                      }}
                    >
                      记录
                    </TableActionButton>
                    {item.riskLockedAt ? (
                      <TableActionButton
                        type="button"
                        onClick={() => {
                          void unlockActivationCode(item.id)
                        }}
                      >
                        解锁
                      </TableActionButton>
                    ) : null}
                    {item.boundAccountId ? (
                      <TableActionButton
                        type="button"
                        onClick={() => {
                          void replaceActivationCode(item.id)
                        }}
                      >
                        换码
                      </TableActionButton>
                    ) : null}
                    <TableActionButton
                      type="button"
                      onClick={() => {
                        void archiveActivationCode(item.id)
                      }}
                    >
                      归档
                    </TableActionButton>
                  </ManagedStatusActionButtons>
                </TableActionCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </>
      ) : null}
    </div>
  )
}
