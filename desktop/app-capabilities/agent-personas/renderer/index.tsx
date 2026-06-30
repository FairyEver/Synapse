import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type FormEvent,
  type ReactNode,
  type SetStateAction,
} from "react"
import { ChevronDown, CircleAlert, Eye, Pencil, Plus, RefreshCw, Trash2, X } from "lucide-react"
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
  EmptyContent,
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
import type { SynapseAgentPersona } from "../../../src/types/agent-persona"
import type { ProviderModelSelection } from "../../../src/types/provider-model"

const logger = createRendererLogger("agent-personas.app")
const tactileButtonClassName = [
  "transition-[scale,translate,background-color,color,border-color,box-shadow]",
  "duration-150 ease-out active:scale-[0.96]",
  "motion-reduce:transition-none motion-reduce:active:scale-100",
].join(" ")
const iconActionButtonClassName = ["size-10", tactileButtonClassName].join(" ")

type AgentPersonaFormState = {
  readonly mode: "create" | "edit" | "view"
  readonly item: SynapseAgentPersona | null
  readonly name: string
  readonly description: string
  readonly systemPrompt: string
  readonly providerModel: ProviderModelSelection | null
  readonly errors: Partial<Record<"name" | "description" | "systemPrompt" | "form", string>>
}

const emptyFormState: AgentPersonaFormState = {
  mode: "create",
  item: null,
  name: "",
  description: "",
  systemPrompt: "",
  providerModel: null,
  errors: {},
}

export function AgentPersonasModule() {
  const [items, setItems] = useState<SynapseAgentPersona[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [saving, setSaving] = useState(false)
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
    if (saving || form.mode === "view") return

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
      }
      const saved = form.mode === "edit" && form.item
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
      actions={(
        <Button type="button" className={tactileButtonClassName} onClick={openCreateForm}>
          <Plus data-icon="inline-start" />
          新增
        </Button>
      )}
    >
      <ScrollArea className="h-full min-h-0">
        <div className="mx-auto grid w-full max-w-5xl gap-5 p-3 sm:p-5">
          {loading ? (
            <AgentPersonaSkeleton />
          ) : items.length === 0 && loadError ? (
            <Alert variant="destructive">
              <CircleAlert />
              <AlertTitle className="text-balance">加载失败</AlertTitle>
              <AlertDescription className="break-words">{loadError}</AlertDescription>
              <Button type="button" variant="outline" size="sm" className={`mt-2 w-fit ${tactileButtonClassName}`} onClick={() => void reload()}>
                <RefreshCw data-icon="inline-start" />
                重试
              </Button>
            </Alert>
          ) : (
            <>
              <AgentPersonaSection title="系统内置">
                <AgentPersonaTable
                  items={builtinItems}
                  onView={(item) => openItem(item, "view")}
                  onEdit={(item) => openItem(item, "edit")}
                  onDelete={setDeleteTarget}
                />
              </AgentPersonaSection>
              <AgentPersonaSection title="我创建的">
                {userItems.length === 0 ? (
                  <Empty className="min-h-40 rounded-md border bg-background">
                    <EmptyHeader>
                      <EmptyTitle className="text-balance">暂无智能体</EmptyTitle>
                    </EmptyHeader>
                    <EmptyContent>
                      <Button type="button" variant="outline" className={tactileButtonClassName} onClick={openCreateForm}>新增智能体</Button>
                    </EmptyContent>
                  </Empty>
                ) : (
                  <AgentPersonaTable
                    items={userItems}
                    onView={(item) => openItem(item, "view")}
                    onEdit={(item) => openItem(item, "edit")}
                    onDelete={setDeleteTarget}
                  />
                )}
              </AgentPersonaSection>
            </>
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
            <AlertDialogCancel className={tactileButtonClassName}>取消</AlertDialogCancel>
            <AlertDialogAction variant="destructive" className={tactileButtonClassName} onClick={() => void deleteItem()}>删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SystemAppWindowShell>
  )
}

function AgentPersonaSection({ children, title }: { readonly children: ReactNode; readonly title: string }) {
  return (
    <section className="grid gap-2">
      <h2 className="text-balance text-sm font-medium">{title}</h2>
      {children}
    </section>
  )
}

function AgentPersonaSkeleton() {
  return (
    <div className="grid gap-5">
      {Array.from({ length: 2 }).map((_, sectionIndex) => (
        <div key={sectionIndex} className="grid gap-2">
          <Skeleton className="h-4 w-20" />
          <div className="rounded-md border bg-background p-3">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="mt-3 h-4 w-full max-w-xl" />
          </div>
        </div>
      ))}
    </div>
  )
}

function AgentPersonaTable({
  items,
  onDelete,
  onEdit,
  onView,
}: {
  readonly items: SynapseAgentPersona[]
  readonly onDelete: (item: SynapseAgentPersona) => void
  readonly onEdit: (item: SynapseAgentPersona) => void
  readonly onView: (item: SynapseAgentPersona) => void
}) {
  return (
    <Table containerClassName="rounded-md border bg-background" className="min-w-[48rem] table-fixed">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="w-44">名称</TableHead>
          <TableHead>简介</TableHead>
          <TableHead className="w-40">模型</TableHead>
          <TableHead className="w-40 text-right">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) => (
          <AgentPersonaRow
            key={item.id}
            item={item}
            onDelete={onDelete}
            onEdit={onEdit}
            onView={onView}
          />
        ))}
      </TableBody>
    </Table>
  )
}

function AgentPersonaRow({
  item,
  onDelete,
  onEdit,
  onView,
}: {
  readonly item: SynapseAgentPersona
  readonly onDelete: (item: SynapseAgentPersona) => void
  readonly onEdit: (item: SynapseAgentPersona) => void
  readonly onView: (item: SynapseAgentPersona) => void
}) {
  const modelLabel = useProviderModelLabel(item.providerModel)
  return (
    <TableRow>
      <TableCell className="min-w-0 align-top font-medium">
        <span className="block truncate">{item.name}</span>
      </TableCell>
      <TableCell className="min-w-0 align-top">
        <span className="block truncate text-muted-foreground">{item.description}</span>
      </TableCell>
      <TableCell className="min-w-0 align-top">
        <span className="block truncate text-muted-foreground">
          {item.providerModel ? modelLabel || item.providerModel.providerId : "未指定"}
        </span>
      </TableCell>
      <TableCell className="align-top text-right">
        <div className="flex justify-end gap-1">
          <Button type="button" variant="ghost" size="icon" className={iconActionButtonClassName} aria-label={`查看智能体：${item.name}`} onClick={() => onView(item)}>
            <Eye className="size-3.5" />
          </Button>
          {item.source === "user" ? (
            <>
              <Button type="button" variant="ghost" size="icon" className={iconActionButtonClassName} aria-label={`编辑智能体：${item.name}`} onClick={() => onEdit(item)}>
                <Pencil className="size-3.5" />
              </Button>
              <Button type="button" variant="ghost" size="icon" className={iconActionButtonClassName} aria-label={`删除智能体：${item.name}`} onClick={() => onDelete(item)}>
                <Trash2 className="size-3.5" />
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
  const isReadonly = form.mode === "view"
  const title = form.mode === "edit" ? "编辑智能体" : form.mode === "view" ? "查看智能体" : "新增智能体"
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
          <FieldGroup>
            <Field data-invalid={Boolean(form.errors.name) || undefined}>
              <FieldLabel htmlFor="agent-persona-name">名称</FieldLabel>
              <FieldContent>
                <Input
                  id="agent-persona-name"
                  value={form.name}
                  disabled={saving}
                  readOnly={isReadonly}
                  aria-invalid={Boolean(form.errors.name)}
                  onChange={(event) => onFormChange((current) => ({
                    ...current,
                    name: event.target.value,
                    errors: { ...current.errors, name: undefined, form: undefined },
                  }))}
                  autoFocus={!isReadonly}
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
                  readOnly={isReadonly}
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
            <Field data-invalid={Boolean(form.errors.systemPrompt) || undefined}>
              <FieldLabel htmlFor="agent-persona-system-prompt">系统提示词</FieldLabel>
              <FieldContent>
                <Textarea
                  id="agent-persona-system-prompt"
                  value={form.systemPrompt}
                  disabled={saving}
                  readOnly={isReadonly}
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
            <Field>
              <FieldLabel>模型</FieldLabel>
              <FieldContent>
                {isReadonly ? (
                  <Input id="agent-persona-model" value={modelDisplay} readOnly />
                ) : (
                  <div className="flex min-w-0 items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className={`min-w-0 flex-1 justify-between ${tactileButtonClassName}`}
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
                        className={tactileButtonClassName}
                        aria-label="清除模型"
                        disabled={saving}
                        onClick={() => onFormChange((current) => ({ ...current, providerModel: null }))}
                      >
                        <X className="size-4" />
                      </Button>
                    ) : null}
                  </div>
                )}
              </FieldContent>
            </Field>
            {form.errors.form ? <FieldError>{form.errors.form}</FieldError> : null}
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" className={tactileButtonClassName} onClick={() => onOpenChange(false)} disabled={saving}>
              {isReadonly ? "关闭" : "取消"}
            </Button>
            {!isReadonly ? (
              <Button type="submit" className={tactileButtonClassName} disabled={saving}>
                {saving ? <Spinner data-icon="inline-start" /> : null}
                {saving ? "保存中" : "保存智能体"}
              </Button>
            ) : null}
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

function validateForm(form: AgentPersonaFormState): AgentPersonaFormState["errors"] {
  const errors: AgentPersonaFormState["errors"] = {}
  if (!form.name.trim()) errors.name = "名称不能为空"
  if (!form.description.trim()) errors.description = "简介不能为空"
  if (!form.systemPrompt.trim()) errors.systemPrompt = "系统提示词不能为空"
  return errors
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
