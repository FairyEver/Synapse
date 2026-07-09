import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react"
import { EyeOff, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { createRendererLogger } from "../../../src/app-shell/logging"
import { Button } from "../../../src/components/ui/button"
import { Checkbox } from "../../../src/components/ui/checkbox"
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
import { ScrollArea } from "../../../src/components/ui/scroll-area"
import { Skeleton } from "../../../src/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../src/components/ui/table"
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
import { requireBridgeDomain } from "../../../src/lib/electron-bridge"
import { SystemAppTopBarActionButton } from "../../../src/modules/apps/components/system-app-top-bar"
import { SystemAppWindowShell } from "../../../src/modules/apps/components/system-app-window-shell"
import type { SecretSafeView } from "../shared/schema"

const logger = createRendererLogger("secrets.app")

type SecretFormMode = "create" | "edit"

type SecretFormState = {
  readonly mode: SecretFormMode
  readonly secret: SecretSafeView | null
  readonly name: string
  readonly value: string
  readonly updateValue: boolean
  readonly description: string
  readonly error: string
}

const emptyFormState: SecretFormState = {
  mode: "create",
  secret: null,
  name: "",
  value: "",
  updateValue: true,
  description: "",
  error: "",
}

export function SecretsModule() {
  const [secrets, setSecrets] = useState<SecretSafeView[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [saving, setSaving] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState<SecretFormState>(emptyFormState)
  const [deleting, setDeleting] = useState<SecretSafeView | null>(null)

  const secretsBridge = useMemo(() => requireBridgeDomain("secrets"), [])

  const reload = useCallback(async () => {
    try {
      setLoading(true)
      setLoadError("")
      const result = await secretsBridge.list()
      setSecrets(result.secrets)
    } catch (error) {
      const message = errorMessage(error, "加载失败")
      logger.error("Failed to load secrets.", error)
      setLoadError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }, [secretsBridge])

  useEffect(() => {
    void reload()
    return secretsBridge.onChanged((event) => {
      setSecrets(event.secrets)
    })
  }, [reload, secretsBridge])

  const openCreateForm = () => {
    setForm(emptyFormState)
    setFormOpen(true)
  }

  const openEditForm = (secret: SecretSafeView) => {
    setForm({
      mode: "edit",
      secret,
      name: secret.name,
      value: "",
      updateValue: false,
      description: secret.description ?? "",
      error: "",
    })
    setFormOpen(true)
  }

  const closeForm = () => {
    if (saving) return
    setFormOpen(false)
    setForm(emptyFormState)
  }

  const submitForm = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (saving) return

    const name = form.name.trim()
    if (!name) {
      setForm((current) => ({ ...current, error: "名称不能为空" }))
      return
    }

    try {
      setSaving(true)
      const saved = form.mode === "edit" && form.secret
        ? await secretsBridge.update({
            name: form.secret.name,
            ...(name !== form.secret.name ? { newName: name } : undefined),
            ...(form.updateValue ? { value: form.value } : undefined),
            description: form.description,
          })
        : await secretsBridge.create({
            name,
            value: form.value,
            description: form.description,
          })

      setSecrets((current) => mergeSecret(current, saved))
      toast.success("已保存")
      closeForm()
    } catch (error) {
      const message = errorMessage(error, "保存失败")
      logger.error("Failed to save secret.", error)
      setForm((current) => ({ ...current, error: message }))
      toast.error(message)
    } finally {
      setSaving(false)
    }
  }

  const deleteSecret = async () => {
    if (!deleting) return
    try {
      await secretsBridge.delete({ name: deleting.name })
      setSecrets((current) => current.filter((secret) => secret.id !== deleting.id))
      setDeleting(null)
    } catch (error) {
      logger.error("Failed to delete secret.", error)
      toast.error("删除失败")
    }
  }

  return (
    <SystemAppWindowShell
      actions={(
        <>
          <SystemAppTopBarActionButton type="button" iconOnly tooltip="刷新" onClick={() => void reload()}>
            <RefreshCw />
          </SystemAppTopBarActionButton>
          <SystemAppTopBarActionButton type="button" onClick={openCreateForm}>
            <Plus data-icon="inline-start" />
            新增
          </SystemAppTopBarActionButton>
        </>
      )}
    >
      <ScrollArea className="h-full min-h-0">
        <div className="mx-auto grid w-full max-w-4xl gap-3 p-3 sm:p-5">
          {loading ? (
            <SecretsTableSkeleton />
          ) : loadError ? (
            <Empty className="min-h-48 border">
              <EmptyHeader>
                <EmptyTitle>加载失败</EmptyTitle>
              </EmptyHeader>
              <EmptyContent>
                <Button type="button" variant="outline" onClick={() => void reload()}>
                  <RefreshCw data-icon="inline-start" />
                  重试
                </Button>
              </EmptyContent>
            </Empty>
          ) : secrets.length === 0 ? (
            <Empty className="min-h-48 border">
              <EmptyHeader>
                <EmptyTitle>暂无密钥</EmptyTitle>
              </EmptyHeader>
              <EmptyContent>
                <Button type="button" variant="outline" onClick={openCreateForm}>
                  <Plus data-icon="inline-start" />
                  新增密钥
                </Button>
              </EmptyContent>
            </Empty>
          ) : (
            <SecretsTable
              secrets={secrets}
              onDelete={setDeleting}
              onEdit={openEditForm}
            />
          )}
        </div>
      </ScrollArea>
      <SecretDialog
        form={form}
        open={formOpen}
        saving={saving}
        onDescriptionChange={(description) => setForm((current) => ({ ...current, description, error: "" }))}
        onNameChange={(name) => setForm((current) => ({ ...current, name, error: "" }))}
        onOpenChange={(open) => {
          if (open) {
            setFormOpen(true)
          } else {
            closeForm()
          }
        }}
        onSubmit={submitForm}
        onUpdateValueChange={(updateValue) => setForm((current) => ({ ...current, updateValue, error: "" }))}
        onValueChange={(value) => setForm((current) => ({ ...current, value, error: "" }))}
      />
      <DeleteSecretDialog
        secret={deleting}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
        onDelete={() => void deleteSecret()}
      />
    </SystemAppWindowShell>
  )
}

function SecretsTableSkeleton() {
  return (
    <Table containerClassName="rounded-md border bg-background" className="min-w-[42rem] table-fixed">
      <colgroup>
        <col data-column="name" className="w-56" />
        <col data-column="description" />
        <col data-column="status" className="w-24" />
        <col data-column="actions" className="w-24" />
      </colgroup>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead><Skeleton className="h-4 w-16" /></TableHead>
          <TableHead><Skeleton className="h-4 w-16" /></TableHead>
          <TableHead><Skeleton className="h-4 w-12" /></TableHead>
          <TableHead><Skeleton className="ml-auto h-4 w-12" /></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {Array.from({ length: 5 }).map((_, index) => (
          <TableRow key={index}>
            <TableCell><Skeleton className="h-4 w-full max-w-48" /></TableCell>
            <TableCell><Skeleton className="h-4 w-full max-w-80" /></TableCell>
            <TableCell><Skeleton className="h-4 w-14" /></TableCell>
            <TableCell>
              <div className="flex justify-end gap-1">
                <Skeleton className="size-7" />
                <Skeleton className="size-7" />
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function SecretsTable({
  secrets,
  onDelete,
  onEdit,
}: {
  readonly secrets: SecretSafeView[]
  readonly onDelete: (secret: SecretSafeView) => void
  readonly onEdit: (secret: SecretSafeView) => void
}) {
  return (
    <Table containerClassName="rounded-md border bg-background" className="min-w-[42rem] table-fixed">
      <colgroup>
        <col data-column="name" className="w-56" />
        <col data-column="description" />
        <col data-column="status" className="w-24" />
        <col data-column="actions" className="w-24" />
      </colgroup>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>名称</TableHead>
          <TableHead>描述</TableHead>
          <TableHead>状态</TableHead>
          <TableHead className="text-right">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {secrets.map((secret) => (
          <TableRow key={secret.id}>
            <TableCell className="min-w-0 align-middle font-mono text-sm">
              <span className="block truncate">{secret.name}</span>
            </TableCell>
            <TableCell className="min-w-0 align-middle text-muted-foreground">
              <span className="block truncate">{secret.description || "-"}</span>
            </TableCell>
            <TableCell className="align-middle">
              <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                <EyeOff className="size-3.5" />
                {secret.hasValue ? "有值" : "空值"}
              </span>
            </TableCell>
            <TableCell className="align-middle text-right">
              <div className="flex justify-end gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`编辑密钥：${secret.name}`}
                  onClick={() => onEdit(secret)}
                >
                  <Pencil className="size-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`删除密钥：${secret.name}`}
                  onClick={() => onDelete(secret)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function SecretDialog({
  form,
  open,
  saving,
  onDescriptionChange,
  onNameChange,
  onOpenChange,
  onSubmit,
  onUpdateValueChange,
  onValueChange,
}: {
  readonly form: SecretFormState
  readonly open: boolean
  readonly saving: boolean
  readonly onDescriptionChange: (description: string) => void
  readonly onNameChange: (name: string) => void
  readonly onOpenChange: (open: boolean) => void
  readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void
  readonly onUpdateValueChange: (checked: boolean) => void
  readonly onValueChange: (value: string) => void
}) {
  const isEdit = form.mode === "edit"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form className="grid gap-4" onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>{isEdit ? "编辑密钥" : "新增密钥"}</DialogTitle>
            <DialogDescription className="sr-only">编辑本机密钥库条目。</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field data-invalid={Boolean(form.error) || undefined}>
              <FieldLabel htmlFor="secret-name">名称</FieldLabel>
              <FieldContent>
                <Input
                  id="secret-name"
                  value={form.name}
                  onChange={(event) => onNameChange(event.target.value)}
                  disabled={saving}
                  autoFocus
                  aria-invalid={Boolean(form.error)}
                />
                {form.error ? <FieldError>{form.error}</FieldError> : null}
              </FieldContent>
            </Field>
            {isEdit ? (
              <Field orientation="horizontal">
                <Checkbox
                  id="secret-update-value"
                  checked={form.updateValue}
                  disabled={saving}
                  onCheckedChange={(checked) => onUpdateValueChange(checked === true)}
                />
                <FieldLabel htmlFor="secret-update-value">更新值</FieldLabel>
              </Field>
            ) : null}
            {form.mode === "create" || form.updateValue ? (
              <Field>
                <FieldLabel htmlFor="secret-value">值</FieldLabel>
                <FieldContent>
                  <Input
                    id="secret-value"
                    type="password"
                    value={form.value}
                    onChange={(event) => onValueChange(event.target.value)}
                    disabled={saving}
                  />
                </FieldContent>
              </Field>
            ) : null}
            <Field>
              <FieldLabel htmlFor="secret-description">描述</FieldLabel>
              <FieldContent>
                <Input
                  id="secret-description"
                  value={form.description}
                  onChange={(event) => onDescriptionChange(event.target.value)}
                  disabled={saving}
                />
              </FieldContent>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              取消
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "保存中" : "保存密钥"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function DeleteSecretDialog({
  secret,
  onDelete,
  onOpenChange,
}: {
  readonly secret: SecretSafeView | null
  readonly onDelete: () => void
  readonly onOpenChange: (open: boolean) => void
}) {
  return (
    <AlertDialog open={Boolean(secret)} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>删除密钥</AlertDialogTitle>
          <AlertDialogDescription>
            {secret ? `删除“${secret.name}”后不可恢复。` : "删除后不可恢复。"}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onDelete}>删除</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function mergeSecret(secrets: SecretSafeView[], secret: SecretSafeView): SecretSafeView[] {
  const next = secrets.some((entry) => entry.id === secret.id)
    ? secrets.map((entry) => entry.id === secret.id ? secret : entry)
    : [...secrets, secret]
  return next.sort((a, b) => a.name.localeCompare(b.name))
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message
  return fallback
}
