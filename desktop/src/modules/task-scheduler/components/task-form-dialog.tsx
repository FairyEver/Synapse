import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react"

import { FormDialog } from "@/components/form-dialog"
import { rendererActionRegistry } from "@/action-runtime/builtin-actions"
import {
  ModuleSidebar,
  ModuleSidebarItem,
  ModuleSidebarList,
} from "@/components/module-sidebar"
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
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import type { SynapseProjectConfig } from "@/types/config"
import type { ScheduledTaskCreateInput, ScheduledTaskUpdateInput } from "@/types/task-scheduler"
import type { TaskFormDialogState, TaskFormState } from "../types"
import {
  buildTaskCreateInput,
  buildTaskUpdateInput,
  createTaskFormState,
} from "../utils"

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

type TaskFormSectionId = (typeof TASK_FORM_SECTIONS)[number]["id"]

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
  const defaultProjectId = projects[0]?.id ?? ""
  const [form, setForm] = useState<TaskFormState>(() =>
    createTaskFormState(state.task, defaultProjectId, platform),
  )
  const [error, setError] = useState<string | null>(null)
  const [activeSectionId, setActiveSectionId] = useState<TaskFormSectionId>(TASK_FORM_SECTIONS[0].id)
  const formScrollRef = useRef<HTMLDivElement | null>(null)
  const sectionRefs = useRef<Partial<Record<TaskFormSectionId, HTMLElement | null>>>({})

  useEffect(() => {
    if (open) {
      setForm(createTaskFormState(state.task, defaultProjectId, platform))
      setError(null)
      setActiveSectionId(TASK_FORM_SECTIONS[0].id)
    }
  }, [defaultProjectId, open, platform, state])

  const updateField = <K extends keyof TaskFormState>(key: K, value: TaskFormState[K]) => {
    setForm((current) => ({
      ...current,
      [key]: value,
    }))
  }

  const updateActionType = (actionType: string) => {
    setForm((current) => ({
      ...current,
      actionType,
      actionConfig: rendererActionRegistry.getDefaultConfig(actionType),
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
  const canSubmit = Boolean(
    form.name.trim()
    && selectedAction.manifest.configSchema.safeParse(form.actionConfig).success
    && (form.scopeType === "global" || form.projectId),
  )

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    try {
      if (state.mode === "edit") {
        await onUpdate(state.task.id, buildTaskUpdateInput(form))
      } else {
        await onCreate(buildTaskCreateInput(form))
      }
      onOpenChange(false)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "保存失败")
    }
  }

  return (
    <Dialog data-track="task-scheduler-form-dialog" open={open} onOpenChange={onOpenChange}>
      <FormDialog
        title={state.mode === "edit" ? "编辑任务" : "新建任务"}
        bodyClassName="overflow-hidden"
        contentClassName="h-[calc(100vh-2rem)] sm:max-w-3xl"
        footer={(
          <>
            <FieldError className="sm:mr-auto">{error}</FieldError>
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
          className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-4 md:grid-cols-[9rem_minmax(0,1fr)] md:grid-rows-1 md:gap-5"
        >
          <aside
            data-layout="task-form-section-sidebar"
            className="min-w-0 overflow-x-auto md:min-h-0 md:overflow-y-auto md:overflow-x-visible"
          >
            <TaskFormSectionNav
              activeSectionId={activeSectionId}
              onSectionClick={scrollToSection}
            />
          </aside>

          <div
            ref={formScrollRef}
            data-layout="task-form-section-scroll"
            className="min-h-0 overflow-y-auto pr-1"
          >
            <FieldGroup data-layout="task-form-section-fields" className="gap-5">
              <TaskFormSection
                id="task-form-section-basic"
                sectionRef={setSectionRef("task-form-section-basic")}
                title="基础信息"
              >
                <div
                  data-layout="task-form-basic-grid"
                  className="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(9rem,1fr)_minmax(0,2fr)]"
                >
                  <TaskField
                    className={form.scopeType === "project" ? undefined : "md:col-span-2"}
                    label="名称"
                    htmlFor="task-form-name"
                  >
                    <Input
                      id="task-form-name"
                      value={form.name}
                      onChange={(event) => updateField("name", event.target.value)}
                    />
                  </TaskField>
                  <TaskField label="作用域" htmlFor="task-form-scope">
                    <Select
                      value={form.scopeType}
                      onValueChange={(value) => updateField("scopeType", value as TaskFormState["scopeType"])}
                    >
                      <SelectTrigger id="task-form-scope" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="global">全局</SelectItem>
                          <SelectItem value="project">项目</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </TaskField>
                  {form.scopeType === "project" ? (
                    <TaskField label="项目" htmlFor="task-form-project">
                      <Select
                        value={form.projectId}
                        onValueChange={(value) => updateField("projectId", value)}
                      >
                        <SelectTrigger id="task-form-project" className="w-full">
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
                  ) : null}

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
                <div data-layout="task-form-trigger-grid" className="grid gap-3 md:grid-cols-3">
                  <TaskField label="触发方式" htmlFor="task-form-trigger-type">
                    <Select
                      value={form.triggerType}
                      onValueChange={(value) => updateField("triggerType", value as TaskFormState["triggerType"])}
                    >
                      <SelectTrigger id="task-form-trigger-type" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="cron">Cron</SelectItem>
                          <SelectItem value="interval">固定间隔</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </TaskField>

                  {form.triggerType === "cron" ? (
                    <TaskField className="md:col-span-2" label="Cron" htmlFor="task-form-cron">
                      <Input
                        id="task-form-cron"
                        value={form.cronExpr}
                        onChange={(event) => updateField("cronExpr", event.target.value)}
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
                    <TaskField label="锚点" htmlFor="task-form-interval-anchor">
                      <Select
                        value={form.intervalAnchor}
                        onValueChange={(value) => updateField("intervalAnchor", value as TaskFormState["intervalAnchor"])}
                      >
                        <SelectTrigger id="task-form-interval-anchor" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            <SelectItem value="created_at">创建时间</SelectItem>
                            <SelectItem value="last_completed_at">上次完成</SelectItem>
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </TaskField>
                  ) : null}
                </div>
              </TaskFormSection>

              <TaskFormSection
                id="task-form-section-action"
                sectionRef={setSectionRef("task-form-section-action")}
                title="执行内容"
              >
                <div className="grid gap-3 md:grid-cols-2">
                  <TaskField label="动作" htmlFor="task-form-action-type">
                    <Select
                      value={form.actionType}
                      onValueChange={updateActionType}
                    >
                      <SelectTrigger id="task-form-action-type" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {rendererActionRegistry.list().map((action) => (
                            <SelectItem key={action.manifest.id} value={action.manifest.id}>
                              {action.manifest.title}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </TaskField>
                  <TaskField label="工作目录" htmlFor="task-form-cwd">
                    <Input
                      id="task-form-cwd"
                      value={form.cwd}
                      onChange={(event) => updateField("cwd", event.target.value)}
                    />
                  </TaskField>
                </div>

                {ActionConfigForm ? (
                  <ActionConfigForm
                    value={form.actionConfig}
                    onChange={(actionConfig) => updateField("actionConfig", actionConfig)}
                  />
                ) : null}
              </TaskFormSection>

              <TaskFormSection
                id="task-form-section-run-settings"
                sectionRef={setSectionRef("task-form-section-run-settings")}
                title="运行设置"
              >
                <div data-layout="task-form-run-settings-grid" className="grid gap-3 md:grid-cols-2">
                  <ToggleField
                    checked={form.enabled}
                    label="启用"
                    onCheckedChange={(checked) => updateField("enabled", checked)}
                  />
                  <ToggleField
                    checked={form.missedRunPolicy === "run_once"}
                    label="补跑一次"
                    onCheckedChange={(checked) =>
                      updateField("missedRunPolicy", checked ? "run_once" : "skip")
                    }
                  />
                </div>
              </TaskFormSection>
            </FieldGroup>
          </div>
        </div>
      </FormDialog>
    </Dialog>
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
        className="overflow-x-auto md:overflow-x-hidden"
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
    <section ref={sectionRef} id={id} className="grid gap-3">
      <h3 className="text-sm font-medium text-foreground">{title}</h3>
      <div className="grid gap-3">{children}</div>
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

function ToggleField({
  checked,
  label,
  onCheckedChange,
}: {
  checked: boolean
  label: string
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <Field orientation="horizontal" className="items-center rounded-lg border border-border p-3">
      <FieldLabel>{label}</FieldLabel>
      <FieldContent className="items-end">
        <Switch checked={checked} onCheckedChange={onCheckedChange} />
      </FieldContent>
    </Field>
  )
}

export { TaskFormDialog }
