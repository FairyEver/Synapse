import { useEffect, useMemo, useState, type FormEvent } from "react"
import { FolderOpen } from "lucide-react"

import { rendererActionRegistry } from "@/action-runtime/builtin-actions"
import { createRendererLogger } from "@/app-shell/logging"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Field,
  FieldContent,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { sanitizeError } from "@/lib/error-sanitize"
import type { AutomationCreateInput, AutomationUpdateInput } from "@/types/automation"
import type { AutomationFormDialogState, AutomationFormState } from "../types"
import {
  buildAutomationCreateInput,
  buildAutomationUpdateInput,
  createAutomationFormState,
  createDefaultExecutorConfig,
} from "../utils"

type AutomationFormDialogProps = {
  open: boolean
  state: AutomationFormDialogState
  busy: boolean
  onOpenChange: (open: boolean) => void
  onCreate: (input: AutomationCreateInput) => Promise<void>
  onUpdate: (id: string, patch: AutomationUpdateInput) => Promise<void>
}

const WEEKDAYS = [
  { value: 1, label: "一" },
  { value: 2, label: "二" },
  { value: 3, label: "三" },
  { value: 4, label: "四" },
  { value: 5, label: "五" },
  { value: 6, label: "六" },
  { value: 0, label: "日" },
]

const logger = createRendererLogger("automation.form")

function AutomationFormDialog({
  open,
  state,
  busy,
  onOpenChange,
  onCreate,
  onUpdate,
}: AutomationFormDialogProps) {
  const [form, setForm] = useState<AutomationFormState>(() => createAutomationFormState(state.item))
  const [error, setError] = useState<string | null>(null)
  const executorOptions = useMemo(() => rendererActionRegistry.list(), [])

  useEffect(() => {
    if (open) {
      setForm(createAutomationFormState(state.item))
      setError(null)
    }
  }, [open, state])

  const selectedExecutor = rendererActionRegistry.get(form.executorType)
  const ExecutorConfigForm = selectedExecutor.ConfigForm
  const executorConfigResult = selectedExecutor.manifest.configSchema.safeParse(form.executorConfig)
  const visibleError = error ?? (form.name.trim() && form.activeDays.length > 0 && !executorConfigResult.success
    ? "检查执行器配置"
    : null)
  const canSubmit = Boolean(form.name.trim() && form.activeDays.length > 0 && executorConfigResult.success)

  function updateField<K extends keyof AutomationFormState>(key: K, value: AutomationFormState[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  function updateExecutorType(executorType: string) {
    setForm((current) => ({
      ...current,
      executorType,
      executorConfig: createDefaultExecutorConfig(executorType),
    }))
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    try {
      if (state.mode === "edit") {
        await onUpdate(state.item.id, buildAutomationUpdateInput(form))
      } else {
        await onCreate(buildAutomationCreateInput(form))
      }
      onOpenChange(false)
    } catch (submitError) {
      logger.error("Failed to save automation.", {
        boundary: "automation.form.submit",
        mode: state.mode,
        executorType: form.executorType,
        ...(state.mode === "edit" ? { automationId: state.item.id } : {}),
        ...errorDiagnostic(submitError),
      })
      setError(buildSubmitErrorMessage(submitError))
    }
  }

  async function handleChooseCwd() {
    const repositoryBridge = window.synapse?.repository
    if (!repositoryBridge) {
      setError("打开目录选择器失败。")
      return
    }
    try {
      const selectedPath = await repositoryBridge.chooseDirectory()
      if (!selectedPath) return
      updateField("cwd", selectedPath)
      setError(null)
    } catch (chooseError) {
      logger.error("Failed to choose automation working directory.", {
        boundary: "automation.form.cwd-picker",
        ...errorDiagnostic(chooseError),
      })
      setError("打开目录选择器失败。")
    }
  }

  return (
    <Dialog data-track="automation-form-dialog" open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-hidden sm:max-w-2xl">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{state.mode === "edit" ? "编辑自动化" : "新建自动化"}</DialogTitle>
          </DialogHeader>

          <ScrollArea className="mt-4 max-h-[calc(100vh-12rem)] pr-3">
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="automation-name">名称</FieldLabel>
                <FieldContent>
                  <Input
                    id="automation-name"
                    autoFocus
                    value={form.name}
                    onChange={(event) => updateField("name", event.target.value)}
                  />
                </FieldContent>
              </Field>

              <Field>
                <FieldLabel htmlFor="automation-description">描述</FieldLabel>
                <FieldContent>
                  <Textarea
                    id="automation-description"
                    rows={2}
                    value={form.description}
                    onChange={(event) => updateField("description", event.target.value)}
                  />
                </FieldContent>
              </Field>

              <Field orientation="horizontal">
                <FieldContent>
                  <FieldLabel htmlFor="automation-enabled">启用</FieldLabel>
                </FieldContent>
                <Switch
                  id="automation-enabled"
                  checked={form.enabled}
                  onCheckedChange={(checked) => updateField("enabled", checked)}
                />
              </Field>

              <Field>
                <FieldLabel>触发器</FieldLabel>
                <FieldContent>
                  <ToggleGroup
                    className="w-full"
                    type="single"
                    value={form.triggerType}
                    variant="outline"
                    onValueChange={(value) => {
                      if (value === "cron" || value === "interval") updateField("triggerType", value)
                    }}
                  >
                    <ToggleGroupItem className="flex-1" value="cron">Cron</ToggleGroupItem>
                    <ToggleGroupItem className="flex-1" value="interval">固定间隔</ToggleGroupItem>
                  </ToggleGroup>
                </FieldContent>
              </Field>

              {form.triggerType === "cron" ? (
                <>
                  <Field>
                    <FieldLabel htmlFor="automation-cron-expr">Cron</FieldLabel>
                    <FieldContent>
                      <Input
                        id="automation-cron-expr"
                        value={form.cronExpr}
                        onChange={(event) => updateField("cronExpr", event.target.value)}
                      />
                    </FieldContent>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="automation-cron-timezone">时区</FieldLabel>
                    <FieldContent>
                      <Input
                        id="automation-cron-timezone"
                        value={form.cronTimezone}
                        onChange={(event) => updateField("cronTimezone", event.target.value)}
                      />
                    </FieldContent>
                  </Field>
                </>
              ) : (
                <>
                  <Field>
                    <FieldLabel htmlFor="automation-interval-minutes">间隔分钟</FieldLabel>
                    <FieldContent>
                      <Input
                        id="automation-interval-minutes"
                        inputMode="numeric"
                        value={form.everyMinutes}
                        onChange={(event) => updateField("everyMinutes", event.target.value)}
                      />
                    </FieldContent>
                  </Field>
                  <Field>
                    <FieldLabel>计算方式</FieldLabel>
                    <FieldContent>
                      <ToggleGroup
                        className="w-full"
                        type="single"
                        value={form.intervalAnchor}
                        variant="outline"
                        onValueChange={(value) => {
                          if (value === "created_at" || value === "last_completed_at") {
                            updateField("intervalAnchor", value)
                          }
                        }}
                      >
                        <ToggleGroupItem className="flex-1" value="created_at">固定时间</ToggleGroupItem>
                        <ToggleGroupItem className="flex-1" value="last_completed_at">完成后</ToggleGroupItem>
                      </ToggleGroup>
                    </FieldContent>
                  </Field>
                </>
              )}

              <Field>
                <FieldLabel>活跃日</FieldLabel>
                <FieldContent>
                  <div className="flex flex-wrap gap-2">
                    {WEEKDAYS.map((day) => (
                      <label key={day.value} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={form.activeDays.includes(day.value)}
                          onCheckedChange={(checked) => {
                            const nextDays = checked === true
                              ? [...new Set([...form.activeDays, day.value])].sort()
                              : form.activeDays.filter((value) => value !== day.value)
                            updateField("activeDays", nextDays)
                          }}
                        />
                        {day.label}
                      </label>
                    ))}
                  </div>
                </FieldContent>
              </Field>

              <Field>
                <FieldLabel>执行器</FieldLabel>
                <FieldContent>
                  <Select value={form.executorType} onValueChange={updateExecutorType}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {executorOptions.map((executor) => (
                        <SelectItem key={executor.manifest.id} value={executor.manifest.id}>
                          {executor.manifest.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FieldContent>
              </Field>

              {ExecutorConfigForm ? (
                <ExecutorConfigForm
                  value={form.executorConfig}
                  onChange={(value) => updateField("executorConfig", value)}
                />
              ) : null}

              <Field>
                <FieldLabel htmlFor="automation-cwd">工作目录</FieldLabel>
                <FieldContent>
                  <InputGroup>
                    <InputGroupInput
                      id="automation-cwd"
                      value={form.cwd}
                      onChange={(event) => updateField("cwd", event.target.value)}
                    />
                    <InputGroupButton type="button" size="icon-sm" onClick={() => { void handleChooseCwd() }}>
                      <FolderOpen />
                      <span className="sr-only">选择目录</span>
                    </InputGroupButton>
                  </InputGroup>
                </FieldContent>
              </Field>

              <Field>
                <FieldLabel>漏跑处理</FieldLabel>
                <FieldContent>
                  <ToggleGroup
                    className="w-full"
                    type="single"
                    value={form.missedRunPolicy}
                    variant="outline"
                    onValueChange={(value) => {
                      if (value === "skip" || value === "run_once") updateField("missedRunPolicy", value)
                    }}
                  >
                    <ToggleGroupItem className="flex-1" value="skip">跳过</ToggleGroupItem>
                    <ToggleGroupItem className="flex-1" value="run_once">补跑一次</ToggleGroupItem>
                  </ToggleGroup>
                </FieldContent>
              </Field>
            </FieldGroup>
          </ScrollArea>

          <DialogFooter className="mt-4">
            <FieldError className="sm:mr-auto">{visibleError}</FieldError>
            <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={!canSubmit || busy}>
              保存
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function buildSubmitErrorMessage(error: unknown): string {
  const sanitized = sanitizeError(error instanceof Error ? error.message : String(error))
  return sanitized || "保存失败"
}

function errorDiagnostic(error: unknown): { readonly errorName: string; readonly errorLength: number } {
  const message = error instanceof Error ? error.message : String(error)
  return {
    errorName: error instanceof Error ? error.name : typeof error,
    errorLength: message.length,
  }
}

export { AutomationFormDialog }
export type { AutomationFormDialogProps }
