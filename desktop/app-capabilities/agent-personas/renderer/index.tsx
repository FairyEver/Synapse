import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type FormEvent,
  type SetStateAction,
} from "react"
import { ChevronDown, CircleAlert, Pencil, Plus, RefreshCw, Settings2, Trash2, X } from "lucide-react"
import { toast } from "sonner"
import { createRendererLogger } from "../../../src/app-shell/logging"
import { Alert, AlertDescription, AlertTitle } from "../../../src/components/ui/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../../src/components/ui/alert-dialog"
import { Button } from "../../../src/components/ui/button"
import { Badge } from "../../../src/components/ui/badge"
import { Checkbox } from "../../../src/components/ui/checkbox"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "../../../src/components/ui/command"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../src/components/ui/dialog"
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
} from "../../../src/components/ui/empty"
import {
  Field,
  FieldContent,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "../../../src/components/ui/field"
import { Input } from "../../../src/components/ui/input"
import { NativeSelect, NativeSelectOption } from "../../../src/components/ui/native-select"
import { Popover, PopoverContent, PopoverTrigger } from "../../../src/components/ui/popover"
import { ProviderModelSelectDialog } from "../../../src/components/provider-model-select-dialog"
import { ScrollArea } from "../../../src/components/ui/scroll-area"
import { Skeleton } from "../../../src/components/ui/skeleton"
import { Spinner } from "../../../src/components/ui/spinner"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../src/components/ui/table"
import { Textarea } from "../../../src/components/ui/textarea"
import { requireBridgeDomain } from "../../../src/lib/electron-bridge"
import { useProviderModelLabel } from "../../../src/lib/provider-model"
import { SystemAppWindowShell } from "../../../src/modules/apps/components/system-app-window-shell"
import type {
  SynapseAgentPersona,
  SynapseAgentPersonaToolPolicy,
  SynapseAgentPersonaToolPolicyMode,
} from "../../../src/types/agent-persona"
import type { ProviderModelSelection } from "../../../src/types/provider-model"

const logger = createRendererLogger("agent-personas.app")

type AgentPersonaTab = "builtin" | "user"

const agentPersonaTabs = [
  { id: "builtin", label: "系统内置" },
  { id: "user", label: "我的" },
] as const

const agentPersonaToolOptions = [
  "Read",
  "Glob",
  "Grep",
  "Bash",
  "Edit",
  "MultiEdit",
  "Write",
  "NotebookEdit",
  "WebFetch",
  "WebSearch",
  "TodoWrite",
  "Agent",
] as const

type AgentPersonaFormState = {
  readonly mode: "create" | "edit" | "configureBuiltinModel"
  readonly item: SynapseAgentPersona | null
  readonly name: string
  readonly description: string
  readonly systemPrompt: string
  readonly providerModel: ProviderModelSelection | null
  readonly toolPolicyMode: SynapseAgentPersonaToolPolicyMode
  readonly allowedTools: string[]
  readonly errors: Partial<Record<"name" | "description" | "systemPrompt" | "form", string>>
}

const emptyFormState: AgentPersonaFormState = {
  mode: "create",
  item: null,
  name: "",
  description: "",
  systemPrompt: "",
  providerModel: null,
  toolPolicyMode: "inherit",
  allowedTools: [],
  errors: {},
}

export function AgentPersonasModule() {
  const [items, setItems] = useState<SynapseAgentPersona[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [saving, setSaving] = useState(false)
  const [activeTab, setActiveTab] = useState<AgentPersonaTab>("builtin")
  const [formOpen, setFormOpen] = useState(false)
  const [modelDialogOpen, setModelDialogOpen] = useState(false)
  const [form, setForm] = useState<AgentPersonaFormState>(emptyFormState)
  const [deleteTarget, setDeleteTarget] = useState<SynapseAgentPersona | null>(null)

  const agentPersonasBridge = useMemo(() => requireBridgeDomain("agentPersonas"), [])

  const reload = useCallback(async () => {
    try {
      setLoading(true)
      setLoadError("")
      setItems(await agentPersonasBridge.list())
    } catch (error) {
      const message = errorMessage(error, "加载失败")
      logger.error("Failed to load agent personas.", error)
      setLoadError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }, [agentPersonasBridge])

  useEffect(() => {
    void reload()
    return agentPersonasBridge.onChanged((event) => {
      setItems(event.items)
    })
  }, [agentPersonasBridge, reload])

  const builtinItems = items.filter((item) => item.source === "builtin")
  const userItems = items.filter((item) => item.source === "user")
  const visibleItems = activeTab === "builtin" ? builtinItems : userItems

  const openCreateForm = () => {
    setForm(emptyFormState)
    setFormOpen(true)
  }

  const openItem = (item: SynapseAgentPersona, mode: AgentPersonaFormState["mode"]) => {
    setForm({
      mode,
      item,
      name: item.name,
      description: item.description,
      systemPrompt: item.systemPrompt,
      providerModel: item.providerModel,
      toolPolicyMode: normalizeToolPolicy(item.toolPolicy).mode,
      allowedTools: normalizeToolPolicy(item.toolPolicy).allowedTools,
      errors: {},
    })
    setFormOpen(true)
  }

  const closeForm = () => {
    if (saving) return
    setFormOpen(false)
    setForm(emptyFormState)
    setModelDialogOpen(false)
  }

  const submitForm = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (saving) return

    const errors = validateForm(form)
    if (Object.keys(errors).length > 0) {
      setForm((current) => ({ ...current, errors }))
      return
    }

    try {
      setSaving(true)
      const input = {
        name: form.name,
        description: form.description,
        systemPrompt: form.systemPrompt,
        providerModel: form.providerModel
          ? { providerId: form.providerModel.providerId, modelTier: form.providerModel.modelTier }
          : null,
        toolPolicy: formToolPolicy(form),
      }
      const saved = form.mode === "configureBuiltinModel" && form.item
        ? await agentPersonasBridge.updateBuiltinModel({
          id: form.item.id,
          providerModel: input.providerModel,
        })
        : form.mode === "edit" && form.item
        ? await agentPersonasBridge.update({ id: form.item.id, ...input })
        : await agentPersonasBridge.create(input)

      setItems((current) => mergeItem(current, saved))
      toast.success("已保存")
      closeForm()
    } catch (error) {
      const message = errorMessage(error, "保存失败")
      logger.error("Failed to save agent persona.", error)
      setForm((current) => ({ ...current, errors: { ...current.errors, form: message } }))
      toast.error(message)
    } finally {
      setSaving(false)
    }
  }

  const deleteItem = async () => {
    if (!deleteTarget || deleteTarget.source !== "user") return
    try {
      await agentPersonasBridge.delete({ id: deleteTarget.id })
      setItems((current) => current.filter((entry) => entry.id !== deleteTarget.id))
      setDeleteTarget(null)
    } catch (error) {
      logger.error("Failed to delete agent persona.", error)
      toast.error(errorMessage(error, "删除失败"))
    }
  }

  return (
    <SystemAppWindowShell
      tabs={agentPersonaTabs}
      value={activeTab}
      onValueChange={setActiveTab}
      actions={activeTab === "user" ? (
        <Button type="button" onClick={openCreateForm}>
          <Plus data-icon="inline-start" />
          新增
        </Button>
      ) : null}
    >
      <ScrollArea className="h-full min-h-0">
        <div className="mx-auto grid w-full max-w-5xl gap-3 p-3 sm:p-5">
          {loading ? (
            <AgentPersonaSkeleton />
          ) : items.length === 0 && loadError ? (
            <Alert variant="destructive">
              <CircleAlert />
              <AlertTitle className="text-balance">加载失败</AlertTitle>
              <AlertDescription className="break-words">{loadError}</AlertDescription>
              <Button type="button" variant="outline" size="sm" className="mt-2 w-fit" onClick={() => void reload()}>
                <RefreshCw data-icon="inline-start" />
                重试
              </Button>
            </Alert>
          ) : activeTab === "user" && userItems.length === 0 ? (
            <Empty className="min-h-40 border bg-background">
              <EmptyHeader>
                <EmptyTitle>暂无智能体</EmptyTitle>
              </EmptyHeader>
            </Empty>
          ) : (
            <AgentPersonaTable
              items={visibleItems}
              tab={activeTab}
              onConfigureModel={(item) => openItem(item, "configureBuiltinModel")}
              onEdit={(item) => openItem(item, "edit")}
              onDelete={setDeleteTarget}
            />
          )}
        </div>
      </ScrollArea>
      <AgentPersonaDialog
        form={form}
        open={formOpen}
        saving={saving}
        modelDialogOpen={modelDialogOpen}
        onModelDialogOpenChange={setModelDialogOpen}
        onFormChange={setForm}
        onOpenChange={(open) => {
          if (open) setFormOpen(true)
          else closeForm()
        }}
        onSubmit={submitForm}
      />
      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => {
        if (!open) setDeleteTarget(null)
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-balance">删除智能体</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget ? `删除“${deleteTarget.name}”后不可恢复。` : "删除后不可恢复。"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void deleteItem()}>删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SystemAppWindowShell>
  )
}

function AgentPersonaSkeleton() {
  return (
    <div className="rounded-md border bg-background p-3">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="mt-3 h-4 w-full max-w-xl" />
    </div>
  )
}

function AgentPersonaTable({
  items,
  onConfigureModel,
  onDelete,
  onEdit,
  tab,
}: {
  readonly items: SynapseAgentPersona[]
  readonly onConfigureModel: (item: SynapseAgentPersona) => void
  readonly onDelete: (item: SynapseAgentPersona) => void
  readonly onEdit: (item: SynapseAgentPersona) => void
  readonly tab: AgentPersonaTab
}) {
  return (
    <Table containerClassName="rounded-md border bg-background" className="min-w-[48rem] table-fixed">
      <colgroup>
        <col data-column="name" className="w-44" />
        <col data-column="description" />
        <col data-column="model" className="w-40" />
        <col data-column="tools" className="w-36" />
        <col data-column="actions" className="w-28" />
      </colgroup>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>名称</TableHead>
          <TableHead>简介</TableHead>
          <TableHead>模型</TableHead>
          <TableHead>工具</TableHead>
          <TableHead className="text-center">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) => (
          <AgentPersonaRow
            key={item.id}
            item={item}
            tab={tab}
            onConfigureModel={onConfigureModel}
            onDelete={onDelete}
            onEdit={onEdit}
          />
        ))}
      </TableBody>
    </Table>
  )
}

function AgentPersonaRow({
  item,
  onConfigureModel,
  onDelete,
  onEdit,
  tab,
}: {
  readonly item: SynapseAgentPersona
  readonly onConfigureModel: (item: SynapseAgentPersona) => void
  readonly onDelete: (item: SynapseAgentPersona) => void
  readonly onEdit: (item: SynapseAgentPersona) => void
  readonly tab: AgentPersonaTab
}) {
  const modelLabel = useProviderModelLabel(item.providerModel)
  const toolPolicy = normalizeToolPolicy(item.toolPolicy)
  return (
    <TableRow>
      <TableCell className="min-w-0 align-middle font-medium">
        <span className="block truncate">{item.name}</span>
      </TableCell>
      <TableCell className="min-w-0 align-middle">
        <span className="block truncate text-muted-foreground">{item.description}</span>
      </TableCell>
      <TableCell className="min-w-0 align-middle">
        <span className="block truncate text-muted-foreground">
          {item.providerModel ? modelLabel || item.providerModel.providerId : "未指定"}
        </span>
      </TableCell>
      <TableCell className="min-w-0 align-middle">
        <span className="block truncate text-muted-foreground">{toolPolicyLabel(toolPolicy)}</span>
      </TableCell>
      <TableCell className="align-middle text-center">
        <div className="flex justify-center gap-1">
          {tab === "builtin" ? (
            <Button type="button" variant="ghost" size="icon-sm" aria-label={`配置模型：${item.name}`} onClick={() => onConfigureModel(item)}>
              <Settings2 />
            </Button>
          ) : item.source === "user" ? (
            <>
              <Button type="button" variant="ghost" size="icon-sm" aria-label={`编辑智能体：${item.name}`} onClick={() => onEdit(item)}>
                <Pencil />
              </Button>
              <Button type="button" variant="ghost" size="icon-sm" aria-label={`删除智能体：${item.name}`} onClick={() => onDelete(item)}>
                <Trash2 />
              </Button>
            </>
          ) : null}
        </div>
      </TableCell>
    </TableRow>
  )
}

function AgentPersonaDialog({
  form,
  modelDialogOpen,
  onFormChange,
  onModelDialogOpenChange,
  onOpenChange,
  onSubmit,
  open,
  saving,
}: {
  readonly form: AgentPersonaFormState
  readonly modelDialogOpen: boolean
  readonly onFormChange: Dispatch<SetStateAction<AgentPersonaFormState>>
  readonly onModelDialogOpenChange: (open: boolean) => void
  readonly onOpenChange: (open: boolean) => void
  readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void
  readonly open: boolean
  readonly saving: boolean
}) {
  const isTextReadonly = form.mode === "configureBuiltinModel"
  const title = form.mode === "edit"
    ? "编辑智能体"
    : form.mode === "configureBuiltinModel"
      ? "配置模型"
      : "新增智能体"
  const saveLabel = form.mode === "configureBuiltinModel" ? "保存模型" : "保存智能体"
  const modelLabel = useProviderModelLabel(form.providerModel)
  const modelDisplay = form.providerModel ? modelLabel || form.providerModel.providerId : "未指定"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <form className="grid gap-4" onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle className="text-balance">{title}</DialogTitle>
            <DialogDescription className="sr-only">管理智能体基础配置。</DialogDescription>
          </DialogHeader>
          <FieldGroup className="gap-4">
            <div className="grid gap-4 md:grid-cols-2" data-agent-persona-basic-grid>
              <Field data-invalid={Boolean(form.errors.name) || undefined}>
                <FieldLabel htmlFor="agent-persona-name">名称</FieldLabel>
                <FieldContent>
                  <Input
                    id="agent-persona-name"
                    value={form.name}
                    disabled={saving}
                    readOnly={isTextReadonly}
                    aria-invalid={Boolean(form.errors.name)}
                    onChange={(event) => onFormChange((current) => ({
                      ...current,
                      name: event.target.value,
                      errors: { ...current.errors, name: undefined, form: undefined },
                    }))}
                    autoFocus={!isTextReadonly}
                  />
                  {form.errors.name ? <FieldError>{form.errors.name}</FieldError> : null}
                </FieldContent>
              </Field>
              <Field data-invalid={Boolean(form.errors.description) || undefined}>
                <FieldLabel htmlFor="agent-persona-description">简介</FieldLabel>
                <FieldContent>
                  <Input
                    id="agent-persona-description"
                    value={form.description}
                    disabled={saving}
                    readOnly={isTextReadonly}
                    aria-invalid={Boolean(form.errors.description)}
                    onChange={(event) => onFormChange((current) => ({
                      ...current,
                      description: event.target.value,
                      errors: { ...current.errors, description: undefined, form: undefined },
                    }))}
                  />
                  {form.errors.description ? <FieldError>{form.errors.description}</FieldError> : null}
                </FieldContent>
              </Field>
            </div>
            <Field data-invalid={Boolean(form.errors.systemPrompt) || undefined}>
              <FieldLabel htmlFor="agent-persona-system-prompt">系统提示词</FieldLabel>
              <FieldContent>
                <Textarea
                  id="agent-persona-system-prompt"
                  value={form.systemPrompt}
                  disabled={saving}
                  readOnly={isTextReadonly}
                  className="min-h-40 resize-y"
                  aria-invalid={Boolean(form.errors.systemPrompt)}
                  onChange={(event) => onFormChange((current) => ({
                    ...current,
                    systemPrompt: event.target.value,
                    errors: { ...current.errors, systemPrompt: undefined, form: undefined },
                  }))}
                />
                {form.errors.systemPrompt ? <FieldError>{form.errors.systemPrompt}</FieldError> : null}
              </FieldContent>
            </Field>
            <div className="grid gap-4 md:grid-cols-2" data-agent-persona-options-grid>
              <Field>
                <FieldLabel>模型</FieldLabel>
                <FieldContent>
                  <div className="flex min-w-0 items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="min-w-0 flex-1 justify-between"
                      disabled={saving}
                      onClick={() => onModelDialogOpenChange(true)}
                    >
                      <span className="truncate text-muted-foreground">
                        {modelDisplay}
                      </span>
                      <ChevronDown data-icon="inline-end" />
                    </Button>
                    {form.providerModel ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        aria-label="清除模型"
                        disabled={saving}
                        onClick={() => onFormChange((current) => ({ ...current, providerModel: null }))}
                      >
                        <X className="size-4" />
                      </Button>
                    ) : null}
                  </div>
                </FieldContent>
              </Field>
              <AgentPersonaToolPolicyField
                form={form}
                saving={saving}
                readonly={isTextReadonly}
                onFormChange={onFormChange}
              />
            </div>
            {form.errors.form ? <FieldError>{form.errors.form}</FieldError> : null}
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              取消
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? <Spinner data-icon="inline-start" /> : null}
              {saving ? "保存中" : saveLabel}
            </Button>
          </DialogFooter>
        </form>
        <ProviderModelSelectDialog
          open={modelDialogOpen}
          onOpenChange={onModelDialogOpenChange}
          defaultSelection={form.providerModel ?? undefined}
          onSelect={(selection) => onFormChange((current) => ({ ...current, providerModel: selection }))}
        />
      </DialogContent>
    </Dialog>
  )
}

function AgentPersonaToolPolicyField({
  form,
  onFormChange,
  readonly,
  saving,
}: {
  readonly form: AgentPersonaFormState
  readonly onFormChange: Dispatch<SetStateAction<AgentPersonaFormState>>
  readonly readonly: boolean
  readonly saving: boolean
}) {
  if (readonly) {
    return (
      <Field>
        <FieldLabel htmlFor="agent-persona-tool-policy-readonly">工具能力</FieldLabel>
        <FieldContent>
          <Input
            id="agent-persona-tool-policy-readonly"
            value={toolPolicyLabel({
              mode: form.toolPolicyMode,
              allowedTools: form.allowedTools,
            })}
            readOnly
            disabled={saving}
          />
        </FieldContent>
      </Field>
    )
  }

  return (
    <>
      <Field>
        <FieldLabel htmlFor="agent-persona-tool-policy-mode">工具能力</FieldLabel>
        <FieldContent>
          <NativeSelect
            id="agent-persona-tool-policy-mode"
            className="w-full"
            value={form.toolPolicyMode}
            disabled={saving}
            onChange={(event) => onFormChange((current) => ({
              ...current,
              toolPolicyMode: event.target.value as SynapseAgentPersonaToolPolicyMode,
              allowedTools: event.target.value === "allowlist" ? current.allowedTools : [],
              errors: { ...current.errors, form: undefined },
            }))}
          >
            <NativeSelectOption value="inherit">继承默认工具</NativeSelectOption>
            <NativeSelectOption value="allowlist">白名单</NativeSelectOption>
            <NativeSelectOption value="none">禁用全部工具</NativeSelectOption>
          </NativeSelect>
        </FieldContent>
      </Field>
      {form.toolPolicyMode === "allowlist" ? (
        <Field className="md:col-span-2" data-agent-persona-tool-allowlist-field>
          <FieldLabel htmlFor="agent-persona-tool-allowlist">工具白名单</FieldLabel>
          <FieldContent>
            <AgentPersonaToolAllowlistSelector
              id="agent-persona-tool-allowlist"
              value={form.allowedTools}
              disabled={saving}
              onChange={(allowedTools) => onFormChange((current) => ({
                ...current,
                allowedTools,
                errors: { ...current.errors, form: undefined },
              }))}
            />
          </FieldContent>
        </Field>
      ) : null}
    </>
  )
}

function AgentPersonaToolAllowlistSelector({
  disabled,
  id,
  onChange,
  value,
}: {
  readonly disabled: boolean
  readonly id: string
  readonly onChange: (value: string[]) => void
  readonly value: string[]
}) {
  const [open, setOpen] = useState(false)
  const selected = useMemo(() => new Set(value), [value])
  const customTools = value.filter((tool) => !agentPersonaToolOptions.includes(tool as (typeof agentPersonaToolOptions)[number]))
  const triggerLabel = value.length > 0 ? `${value.length} 个工具` : "选择工具"

  const toggleTool = (tool: string) => {
    onChange(selected.has(tool) ? value.filter((item) => item !== tool) : [...value, tool])
  }

  const removeTool = (tool: string) => {
    onChange(value.filter((item) => item !== tool))
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Popover open={open} onOpenChange={setOpen} data-track="agent-persona-tool-allowlist">
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            className="w-full justify-between"
            disabled={disabled}
          >
            <span className="truncate text-muted-foreground">{triggerLabel}</span>
            <ChevronDown data-icon="inline-end" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 p-0">
          <Command>
            <CommandInput placeholder="搜索工具" data-track="agent-persona-tool-search" />
            <CommandList>
              <CommandEmpty>没有匹配工具</CommandEmpty>
              <CommandGroup>
                {agentPersonaToolOptions.map((tool) => (
                  <CommandItem
                    key={tool}
                    value={tool}
                    data-checked={selected.has(tool)}
                    onSelect={() => toggleTool(tool)}
                  >
                    <Checkbox
                      checked={selected.has(tool)}
                      aria-label={`选择工具：${tool}`}
                      tabIndex={-1}
                      onClick={(event) => event.stopPropagation()}
                      onCheckedChange={() => toggleTool(tool)}
                    />
                    <span className="truncate">{tool}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
              {customTools.length > 0 ? (
                <CommandGroup heading="已选工具">
                  {customTools.map((tool) => (
                    <CommandItem
                      key={tool}
                      value={tool}
                      data-checked
                      onSelect={() => removeTool(tool)}
                    >
                      <Checkbox
                        checked
                        aria-label={`选择工具：${tool}`}
                        tabIndex={-1}
                        onClick={(event) => event.stopPropagation()}
                        onCheckedChange={() => removeTool(tool)}
                      />
                      <span className="truncate">{tool}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ) : null}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {value.length > 0 ? (
        <div className="flex min-w-0 flex-wrap gap-1">
          {value.map((tool) => (
            <Badge key={tool} variant="secondary" className="max-w-full gap-1 pr-1">
              <span className="truncate">{tool}</span>
              <button
                type="button"
                className="rounded-full px-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`移除工具：${tool}`}
                disabled={disabled}
                onClick={() => removeTool(tool)}
              >
                <X />
              </button>
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function validateForm(form: AgentPersonaFormState): AgentPersonaFormState["errors"] {
  const errors: AgentPersonaFormState["errors"] = {}
  if (!form.name.trim()) errors.name = "名称不能为空"
  if (!form.description.trim()) errors.description = "简介不能为空"
  if (!form.systemPrompt.trim()) errors.systemPrompt = "系统提示词不能为空"
  return errors
}

function formToolPolicy(form: AgentPersonaFormState): SynapseAgentPersonaToolPolicy {
  if (form.toolPolicyMode !== "allowlist") {
    return { mode: form.toolPolicyMode, allowedTools: [] }
  }
  return { mode: "allowlist", allowedTools: uniqueNonBlankStrings(form.allowedTools) }
}

function normalizeToolPolicy(value: SynapseAgentPersonaToolPolicy | undefined): Required<SynapseAgentPersonaToolPolicy> {
  if (!value || value.mode !== "allowlist") {
    return { mode: value?.mode ?? "inherit", allowedTools: [] }
  }
  return { mode: "allowlist", allowedTools: uniqueNonBlankStrings(value.allowedTools ?? []) }
}

function uniqueNonBlankStrings(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const tool = value.trim()
    if (!tool || seen.has(tool)) continue
    seen.add(tool)
    result.push(tool)
  }
  return result
}

function toolPolicyLabel(policy: Required<SynapseAgentPersonaToolPolicy>): string {
  if (policy.mode === "none") return "禁用全部工具"
  if (policy.mode === "allowlist") return `白名单 · ${policy.allowedTools.length}`
  return "继承默认工具"
}

function mergeItem(items: SynapseAgentPersona[], item: SynapseAgentPersona): SynapseAgentPersona[] {
  const next = items.some((entry) => entry.id === item.id)
    ? items.map((entry) => entry.id === item.id ? item : entry)
    : [...items, item]
  return [
    ...next.filter((entry) => entry.source === "builtin"),
    ...next.filter((entry) => entry.source === "user"),
  ]
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message
  return fallback
}
