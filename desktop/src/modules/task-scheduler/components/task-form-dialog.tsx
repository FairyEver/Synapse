import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react"
import { ChevronDown } from "lucide-react"

import { FormDialog } from "@/components/form-dialog"
import { rendererActionRegistry } from "@/action-runtime/builtin-actions"
import { useAppConfig } from "@/app-shell/config"
import { createRendererLogger } from "@/app-shell/logging"
import {
  ModuleSidebar,
  ModuleSidebarItem,
  ModuleSidebarList,
} from "@/components/module-sidebar"
import { ProviderModelSelectDialog } from "@/components/provider-model-select-dialog"
import { useProviderModelLabel } from "@/lib/provider-model"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
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
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { sanitizeError } from "@/lib/error-sanitize"
import { track } from "@/lib/ui-tracking"
import { cn } from "@/lib/utils"
import type { SynapseProjectConfig } from "@/types/config"
import type { ScheduledTaskCreateInput, ScheduledTaskUpdateInput } from "@/types/task-scheduler"
import { AgentPermissionModeMenu } from "@/modules/agent/components/permission-mode-menu"
import { permissionModeLabels } from "@/modules/agent/permission-mode-options"
import type { SynapseAgentPermissionMode } from "@/types/agent"
import type { AgentActionConfig } from "../../../../action-packages/builtin/agent/schema"
import type { TaskFormDialogState, TaskFormState } from "../types"
import {
  buildTaskCreateInput,
  buildTaskUpdateInput,
  createDefaultAgentActionConfig,
  createDefaultTaskActionConfig,
  createTaskFormState,
} from "../utils"
import { CronInput } from "./cron-input"
import { ActiveDaysInput } from "./active-days-input"

type TaskFormDialogProps = {
  open: boolean
  state: TaskFormDialogState
  projects: readonly SynapseProjectConfig[]
  platform?: string
  busy: boolean
  onOpenChange: (open: boolean) => void
  onCreate: (input: ScheduledTaskCreateInput) => Promise<void>
  onUpdate: (id: string, patch: ScheduledTaskUpdateInput) => Promise<void>
}

const TASK_FORM_SECTIONS = [
  { id: "task-form-section-basic", title: "基础信息" },
  { id: "task-form-section-trigger", title: "触发计划" },
  { id: "task-form-section-action", title: "执行内容" },
  { id: "task-form-section-run-settings", title: "运行设置" },
] as const

const ACTION_CONFIG_ERROR_MESSAGES: Record<string, Record<string, string>> = {
  "builtin.agent": {
    projectId: "请选择项目",
    providerId: "请选择供应商 + 模型",
    prompt: "请填写提示词",
  },
  "builtin.command": {
    command: "请填写命令",
  },
  "builtin.script": {
    script: "请填写脚本",
  },
}

type TaskFormSectionId = (typeof TASK_FORM_SECTIONS)[number]["id"]

const logger = createRendererLogger("task-scheduler.form")

function TaskFormDialog({
  open,
  state,
  projects,
  platform,
  busy,
  onOpenChange,
  onCreate,
  onUpdate,
}: TaskFormDialogProps) {
  const { config: appConfig } = useAppConfig()
  const defaultProjectId = projects[0]?.id ?? ""
  const [form, setForm] = useState<TaskFormState>(() =>
    createTaskFormState(state.task, defaultProjectId, platform),
  )
  const [error, setError] = useState<string | null>(null)
  const [activeSectionId, setActiveSectionId] = useState<TaskFormSectionId>(TASK_FORM_SECTIONS[0].id)
  const [needsUpdateOpen, setNeedsUpdateOpen] = useState(false)
  const formScrollRef = useRef<HTMLDivElement | null>(null)
  const sectionRefs = useRef<Partial<Record<TaskFormSectionId, HTMLElement | null>>>({})
  const needsUpdateIssues = state.mode === "edit" && state.task.validation?.status === "needs_update"
    ? state.task.validation.issues
    : []

  useEffect(() => {
    if (open) {
      setForm(createTaskFormState(state.task, defaultProjectId, platform))
      setError(null)
      setActiveSectionId(TASK_FORM_SECTIONS[0].id)
      setNeedsUpdateOpen(state.mode === "edit" && state.task.validation?.status === "needs_update")
    }
  }, [defaultProjectId, open, platform, state])

  const updateField = <K extends keyof TaskFormState>(key: K, value: TaskFormState[K]) => {
    setForm((current) => ({
      ...current,
      [key]: value,
    }))
  }

  const updateActionType = (actionType: string) => {
    const actionConfig = actionType === "builtin.agent"
      ? createDefaultAgentActionConfig(appConfig.agent)
      : createDefaultTaskActionConfig(actionType, platform)
    setForm((current) => ({
      ...current,
      actionType,
      actionConfig,
    }))
  }

  const setSectionRef = (sectionId: TaskFormSectionId) => (node: HTMLElement | null) => {
    sectionRefs.current[sectionId] = node
  }

  const scrollToSection = (sectionId: TaskFormSectionId) => {
    setActiveSectionId(sectionId)
    const scrollPane = formScrollRef.current
    const section = sectionRefs.current[sectionId]

    if (!scrollPane || !section) return

    const top = section.getBoundingClientRect().top
      - scrollPane.getBoundingClientRect().top
      + scrollPane.scrollTop
    scrollPane.scrollTo({ top, behavior: "smooth" })
  }

  const selectedAction = rendererActionRegistry.get(form.actionType)
  const ActionConfigForm = selectedAction.ConfigForm
  const actionConfigResult = selectedAction.manifest.configSchema.safeParse(form.actionConfig)
  const actionConfigError = actionConfigResult.success
    ? null
    : buildActionConfigErrorMessage(form.actionType, actionConfigResult.error.issues)
  const visibleError = error ?? (form.name.trim() && form.activeDays.length > 0 ? actionConfigError : null)
  const canSubmit = Boolean(
    form.name.trim()
    && actionConfigResult.success
    && form.activeDays.length > 0,
  )

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    try {
      if (state.mode === "edit") {
        await onUpdate(state.task.id, buildTaskUpdateInput(form))
      } else {
        await onCreate(buildTaskCreateInput(form))
      }
      track({
        component: "task-scheduler",
        name: "task-form-submit",
        action: "submit",
        metadata: taskFormSubmitMetadata(state, form),
      })
      onOpenChange(false)
    } catch (submitError) {
      logger.error("Failed to save scheduled task.", {
        boundary: "task-scheduler.form.submit",
        action: state.mode === "edit" ? "update" : "create",
        actionType: form.actionType,
        ...(state.mode === "edit" ? { taskId: state.task.id } : {}),
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

      if (!selectedPath) {
        return
      }

      updateField("cwd", selectedPath)
      setError(null)
    } catch (chooseError) {
      logger.error("Failed to choose task working directory.", {
        boundary: "task-scheduler.form.cwd-picker",
        action: "chooseDirectory",
        ...errorDiagnostic(chooseError),
      })
      setError("打开目录选择器失败。")
    }
  }

  return (
    <>
      <Dialog data-track="task-scheduler-form-dialog" open={open} onOpenChange={onOpenChange}>
        <FormDialog
          title={state.mode === "edit" ? "编辑任务" : "新建任务"}
          bodyClassName="overflow-hidden"
          contentClassName="h-[calc(100vh-2rem)] sm:max-w-2xl"
          footer={(
            <>
              <FieldError className="sm:mr-auto">{visibleError}</FieldError>
              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => onOpenChange(false)}
                >
                  取消
                </Button>
                <Button type="submit" disabled={busy || !canSubmit}>
                  {busy ? "正在保存..." : state.mode === "edit" ? "保存修改" : "保存"}
                </Button>
              </div>
            </>
          )}
          onSubmit={handleSubmit}
        >
        <div
          data-layout="task-form-dialog-layout"
          className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-1 md:grid-cols-[9rem_minmax(0,1fr)] md:grid-rows-1 md:gap-1"
        >
          <aside
            data-layout="task-form-section-sidebar"
            className="min-w-0 overflow-hidden md:min-h-0"
          >
            <TaskFormSectionNav
              activeSectionId={activeSectionId}
              onSectionClick={scrollToSection}
            />
          </aside>

          <ScrollArea
            viewportRef={formScrollRef}
            data-layout="task-form-section-scroll"
            className="min-h-0 pl-[3px] pr-1"
          >
            <FieldGroup data-layout="task-form-section-fields" className="gap-5">
              <TaskFormSection
                id="task-form-section-basic"
                sectionRef={setSectionRef("task-form-section-basic")}
                title="基础信息"
              >
                <div
                  data-layout="task-form-basic-grid"
                  className="grid gap-2 md:grid-cols-3"
                >
                  <TaskField
                    className="md:col-span-3"
                    label="名称"
                    htmlFor="task-form-name"
                  >
                    <Input
                      id="task-form-name"
                      value={form.name}
                      onChange={(event) => updateField("name", event.target.value)}
                    />
                  </TaskField>

                  <TaskField className="md:col-span-3" label="描述" htmlFor="task-form-description">
                    <Input
                      id="task-form-description"
                      value={form.description}
                      onChange={(event) => updateField("description", event.target.value)}
                    />
                  </TaskField>
                </div>
              </TaskFormSection>

              <TaskFormSection
                id="task-form-section-trigger"
                sectionRef={setSectionRef("task-form-section-trigger")}
                title="触发计划"
              >
                <div data-layout="task-form-trigger-grid" className="grid gap-2 md:grid-cols-3">
                  <TaskField label="触发方式" htmlFor="task-form-trigger-type-cron">
                    <ToggleGroup
                      aria-label="触发方式"
                      className="w-full"
                      data-track="task-form-trigger-type"
                      type="single"
                      value={form.triggerType}
                      variant="outline"
                      onValueChange={(value) => {
                        if (value) updateField("triggerType", value as TaskFormState["triggerType"])
                      }}
                    >
                      <ToggleGroupItem id="task-form-trigger-type-cron" className="flex-1" value="cron">
                        Cron
                      </ToggleGroupItem>
                      <ToggleGroupItem id="task-form-trigger-type-interval" className="flex-1" value="interval">
                        固定间隔
                      </ToggleGroupItem>
                    </ToggleGroup>
                  </TaskField>

                  {form.triggerType === "cron" ? (
                    <TaskField className="md:col-span-2" label="Cron" htmlFor="task-form-cron">
                      <CronInput
                        id="task-form-cron"
                        value={form.cronExpr}
                        disabled={busy}
                        onChange={(value) => updateField("cronExpr", value)}
                      />
                    </TaskField>
                  ) : (
                    <TaskField label="间隔分钟" htmlFor="task-form-every-minutes">
                      <Input
                        id="task-form-every-minutes"
                        min={1}
                        type="number"
                        value={form.everyMinutes}
                        onChange={(event) => updateField("everyMinutes", event.target.value)}
                      />
                    </TaskField>
                  )}
                  {form.triggerType === "interval" ? (
                    <TaskField label="锚点" htmlFor="task-form-interval-anchor-created_at">
                      <ToggleGroup
                        aria-label="锚点"
                        className="w-full"
                        data-track="task-form-interval-anchor"
                        type="single"
                        value={form.intervalAnchor}
                        variant="outline"
                        onValueChange={(value) => {
                          if (value) updateField("intervalAnchor", value as TaskFormState["intervalAnchor"])
                        }}
                      >
                        <ToggleGroupItem
                          id="task-form-interval-anchor-created_at"
                          className="flex-1"
                          value="created_at"
                        >
                          创建时间
                        </ToggleGroupItem>
                        <ToggleGroupItem
                          id="task-form-interval-anchor-last_completed_at"
                          className="flex-1"
                          value="last_completed_at"
                        >
                          上次完成
                        </ToggleGroupItem>
                      </ToggleGroup>
                    </TaskField>
                  ) : null}
                </div>
                <TaskField label="活跃日" htmlFor="task-form-active-days">
                  <ActiveDaysInput
                    value={form.activeDays}
                    onChange={(days) => updateField("activeDays", days)}
                    error={form.activeDays.length === 0 ? "请至少选择一个活跃日" : undefined}
                  />
                </TaskField>
              </TaskFormSection>

              <TaskFormSection
                id="task-form-section-action"
                sectionRef={setSectionRef("task-form-section-action")}
                title="执行内容"
              >
                <TaskField label="动作" htmlFor="task-form-action-type-builtin.command">
                  <ToggleGroup
                    aria-label="动作"
                    className="w-full"
                    data-track="task-form-action-type"
                    type="single"
                    value={form.actionType}
                    variant="outline"
                    onValueChange={(value) => {
                      if (value) updateActionType(value)
                    }}
                  >
                    {rendererActionRegistry.list().map((action) => (
                      <ToggleGroupItem
                        key={action.manifest.id}
                        id={`task-form-action-type-${action.manifest.id}`}
                        className="flex-1"
                        value={action.manifest.id}
                      >
                        {action.manifest.title}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </TaskField>

                {form.actionType === "builtin.agent" ? (
                  <AgentActionFields
                    config={form.actionConfig as AgentActionConfig}
                    projects={projects}
                    onConfigChange={(actionConfig) => updateField("actionConfig", actionConfig)}
                  />
                ) : (
                  <>
                    <TaskField label="工作目录" htmlFor="task-form-cwd">
                      <InputGroup>
                        <InputGroupInput
                          id="task-form-cwd"
                          value={form.cwd}
                          onChange={(event) => updateField("cwd", event.target.value)}
                        />
                        <InputGroupAddon align="inline-end">
                          <InputGroupButton
                            type="button"
                            disabled={busy}
                            onClick={handleChooseCwd}
                          >
                            选择
                          </InputGroupButton>
                        </InputGroupAddon>
                      </InputGroup>
                    </TaskField>
                    {ActionConfigForm ? (
                      <ActionConfigForm
                        value={form.actionConfig}
                        onChange={(actionConfig) => updateField("actionConfig", actionConfig)}
                      />
                    ) : null}
                  </>
                )}
              </TaskFormSection>

              <TaskFormSection
                id="task-form-section-run-settings"
                sectionRef={setSectionRef("task-form-section-run-settings")}
                title="运行设置"
              >
                <div data-layout="task-form-run-settings-list" className="grid grid-cols-2 gap-2">
                  <ToggleField
                    checked={form.enabled}
                    id="task-form-enabled"
                    label="启用"
                    onCheckedChange={(checked) => updateField("enabled", checked)}
                  />
                  <ToggleField
                    checked={form.missedRunPolicy === "run_once"}
                    id="task-form-missed-run-policy"
                    label="补跑一次"
                    onCheckedChange={(checked) =>
                      updateField("missedRunPolicy", checked ? "run_once" : "skip")
                    }
                  />
                </div>
              </TaskFormSection>
            </FieldGroup>
          </ScrollArea>
        </div>
        </FormDialog>
      </Dialog>
      <AlertDialog open={needsUpdateOpen} onOpenChange={setNeedsUpdateOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>任务需要更新</AlertDialogTitle>
            <AlertDialogDescription>
              修改以下内容后才能启用或运行。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="grid gap-1 text-sm">
            {needsUpdateIssues.map((issue) => (
              <li key={`${issue.field}:${issue.message}`} className="text-foreground">
                {issue.message}
              </li>
            ))}
          </ul>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                onOpenChange(false)
              }}
            >
              取消
            </AlertDialogCancel>
            <AlertDialogAction>去编辑</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function TaskFormSectionNav({
  activeSectionId,
  onSectionClick,
}: {
  activeSectionId: TaskFormSectionId
  onSectionClick: (sectionId: TaskFormSectionId) => void
}) {
  return (
    <ModuleSidebar
      data-layout="task-form-section-nav"
      className="h-full"
      variant="bare"
    >
      <ModuleSidebarList
        data-track="task-form-section-list"
      >
        {TASK_FORM_SECTIONS.map((section) => (
          <ModuleSidebarItem
            key={section.id}
            active={activeSectionId === section.id}
            className="h-8 px-4"
            data-track="task-form-section-select"
            trackValue={section.id}
            onClick={() => onSectionClick(section.id)}
          >
            {section.title}
          </ModuleSidebarItem>
        ))}
      </ModuleSidebarList>
    </ModuleSidebar>
  )
}

function TaskFormSection({
  children,
  id,
  sectionRef,
  title,
}: {
  children: ReactNode
  id: TaskFormSectionId
  sectionRef: (node: HTMLElement | null) => void
  title: string
}) {
  return (
    <section ref={sectionRef} id={id} className="grid gap-2">
      <h3 className="text-sm font-medium text-foreground">{title}</h3>
      <div className="grid gap-2">{children}</div>
    </section>
  )
}

function TaskField({
  children,
  className,
  htmlFor,
  label,
}: {
  children: ReactNode
  className?: string
  htmlFor: string
  label: string
}) {
  return (
    <Field className={cn("min-w-0", className)}>
      <FieldLabel htmlFor={htmlFor}>{label}</FieldLabel>
      <FieldContent>{children}</FieldContent>
    </Field>
  )
}

function AgentActionFields({
  config,
  projects,
  onConfigChange,
}: {
  config: AgentActionConfig
  projects: readonly SynapseProjectConfig[]
  onConfigChange: (config: AgentActionConfig) => void
}) {
  const [providerDialogOpen, setProviderDialogOpen] = useState(false)
  const providerSelection = useMemo(
    () => config.providerId
      ? { providerId: config.providerId, modelTier: config.modelTier, providerName: config.providerName, modelName: config.modelName }
      : null,
    [config.providerId, config.modelTier, config.providerName, config.modelName],
  )
  const resolvedProviderLabel = useProviderModelLabel(providerSelection)

  return (
    <>
      <div className="grid gap-2 md:grid-cols-2">
        <TaskField label="项目" htmlFor="task-form-agent-project">
          <Select
            value={config.projectId ?? ""}
            onValueChange={(projectId) => {
              onConfigChange({ ...config, agentType: "claude-code", projectId })
            }}
          >
            <SelectTrigger id="task-form-agent-project" className="w-full">
              <SelectValue placeholder="选择项目" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </TaskField>

        <TaskField label="权限模式" htmlFor="task-action-agent-mode">
          <AgentPermissionModeMenu
            selectedMode={config.mode}
            contentClassName="w-56"
            onSelect={(mode: SynapseAgentPermissionMode) => {
              onConfigChange({ ...config, agentType: "claude-code", mode })
            }}
            trigger={(
              <Button
                id="task-action-agent-mode"
                type="button"
                variant="outline"
                className="w-full justify-between"
                aria-label="权限模式"
              >
                <span className="truncate">{permissionModeLabels[config.mode]}</span>
                <ChevronDown className="size-4 text-muted-foreground" />
              </Button>
            )}
          />
        </TaskField>
      </div>

      <TaskField label="供应商 + 模型" htmlFor="task-action-agent-provider">
        <Button
          id="task-action-agent-provider"
          type="button"
          variant="outline"
          className="w-full justify-between"
          onClick={() => setProviderDialogOpen(true)}
        >
          <span className="truncate">
            {resolvedProviderLabel || "选择供应商 + 模型"}
          </span>
          <ChevronDown className="size-4 text-muted-foreground" />
        </Button>
        <ProviderModelSelectDialog
          open={providerDialogOpen}
          onOpenChange={setProviderDialogOpen}
          defaultSelection={config.providerId ? { providerId: config.providerId, modelTier: config.modelTier } : undefined}
          onSelect={(s) => onConfigChange({
            ...config,
            agentType: "claude-code",
            providerId: s.providerId,
            modelTier: s.modelTier,
            providerName: s.providerName,
            modelName: s.modelName,
          })}
        />
      </TaskField>

      <TaskField label="提示词" htmlFor="task-action-agent-prompt">
        <Textarea
          id="task-action-agent-prompt"
          rows={5}
          placeholder="输入要发送给 Agent 的提示词..."
          value={config.prompt}
          onChange={(e) => onConfigChange({ ...config, prompt: e.target.value })}
        />
      </TaskField>

      <div className="grid gap-2 md:grid-cols-2">
        <TaskField label="会话策略" htmlFor="task-action-agent-session-fresh">
          <ToggleGroup
            aria-label="Session policy"
            className="w-full"
            type="single"
            value={config.sessionPolicy}
            variant="outline"
            onValueChange={(policy) => {
              if (policy) onConfigChange({ ...config, sessionPolicy: policy as "fresh" | "resume" })
            }}
          >
            <ToggleGroupItem id="task-action-agent-session-fresh" className="flex-1" value="fresh">
              每次新建
            </ToggleGroupItem>
            <ToggleGroupItem id="task-action-agent-session-resume" className="flex-1" value="resume">
              复用上次
            </ToggleGroupItem>
          </ToggleGroup>
        </TaskField>

        <TaskField label="超时分钟" htmlFor="task-action-agent-timeout">
          <Input
            id="task-action-agent-timeout"
            type="number"
            min={1}
            max={120}
            value={config.timeoutMins ?? ""}
            onChange={(e) =>
              onConfigChange({
                ...config,
                timeoutMins: e.target.value ? Number(e.target.value) : null,
              })
            }
          />
        </TaskField>
      </div>
    </>
  )
}

function ToggleField({
  checked,
  id,
  label,
  onCheckedChange,
}: {
  checked: boolean
  id: string
  label: string
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <Field className="min-h-12 justify-center rounded-lg border border-border px-3 py-2">
      <div data-layout="task-form-run-setting-row" className="flex w-full items-center justify-between">
        <FieldLabel htmlFor={id} className="shrink-0">
          {label}
        </FieldLabel>
        <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
      </div>
    </Field>
  )
}

function buildActionConfigErrorMessage(
  actionType: string,
  issues: readonly { path: readonly PropertyKey[] }[],
): string {
  const messagesByField = ACTION_CONFIG_ERROR_MESSAGES[actionType] ?? {}
  const messages: string[] = []

  for (const issue of issues) {
    const field = issue.path.find((part): part is string => typeof part === "string")
    const message = field ? messagesByField[field] : undefined
    if (message && !messages.includes(message)) {
      messages.push(message)
    }
  }

  return messages.length > 0 ? messages.join("、") : "请补全执行内容"
}

function errorDiagnostic(error: unknown): { readonly errorName: string; readonly errorLength: number } {
  const message = error instanceof Error ? error.message : String(error)
  return {
    errorName: error instanceof Error ? error.name : typeof error,
    errorLength: message.length,
  }
}

function buildSubmitErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return "保存任务失败。"
  }
  const message = sanitizeError(error.message)
  return message ? `保存任务失败：${message}` : "保存任务失败。"
}

function taskFormSubmitMetadata(
  state: TaskFormDialogState,
  form: TaskFormState,
): Record<string, unknown> {
  const actionConfig = form.actionConfig as Record<string, unknown>
  const isAgentAction = form.actionType === "builtin.agent"
  return compactMetadata({
    boundary: "renderer.task-scheduler.form-submit",
    mode: state.mode,
    taskId: state.mode === "edit" ? state.task.id : undefined,
    actionType: form.actionType,
    triggerType: form.triggerType,
    enabled: form.enabled,
    missedRunPolicy: form.missedRunPolicy,
    hasCwd: form.cwd.trim().length > 0,
    hasAgentProject: isAgentAction && stringValue(actionConfig.projectId) !== undefined,
    agentType: isAgentAction ? stringValue(actionConfig.agentType) : undefined,
    agentMode: isAgentAction ? stringValue(actionConfig.mode) : undefined,
    sessionPolicy: isAgentAction ? stringValue(actionConfig.sessionPolicy) : undefined,
  })
}

function compactMetadata(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  )
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined
}

export { TaskFormDialog }
