import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent } from "react"
import { Clipboard, Eye, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react"
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
import { Textarea } from "../../../src/components/ui/textarea"
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
import { shouldBypassDeleteConfirm } from "../../../src/lib/delete-confirm-bypass"
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

type SecretRevealState = {
  readonly loading?: boolean
  readonly error?: string
}

type SecretRevealStateById = Record<string, SecretRevealState>

type SecretValueDialogState = {
  readonly secret: SecretSafeView
  readonly value: string
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
  const [secretReveals, setSecretReveals] = useState<SecretRevealStateById>({})
  const [secretValueDialog, setSecretValueDialog] = useState<SecretValueDialogState | null>(null)
  const secretRevealGeneration = useRef(0)

  const secretsBridge = useMemo(() => requireBridgeDomain("secrets"), [])

  const clearSecretReveals = useCallback(() => {
    secretRevealGeneration.current += 1
    setSecretReveals({})
    setSecretValueDialog(null)
  }, [])

  const reload = useCallback(async () => {
    try {
      setLoading(true)
      setLoadError("")
      const result = await secretsBridge.list()
      setSecrets(result.secrets)
      clearSecretReveals()
    } catch (error) {
      const message = errorMessage(error, "加载失败")
      logger.error("Failed to load secrets.", error)
      setLoadError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }, [clearSecretReveals, secretsBridge])

  useEffect(() => {
    void reload()
    return secretsBridge.onChanged((event) => {
      setSecrets(event.secrets)
      clearSecretReveals()
    })
  }, [clearSecretReveals, reload, secretsBridge])

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
      clearSecretReveals()
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

  const deleteSecret = async (secret: SecretSafeView) => {
    try {
      await secretsBridge.delete({ name: secret.name })
      setSecrets((current) => current.filter((entry) => entry.id !== secret.id))
      clearSecretReveals()
      setDeleting(null)
    } catch (error) {
      logger.error("Failed to delete secret.", error)
      toast.error("删除失败")
    }
  }

  const startDeleteSecret = (secret: SecretSafeView, event: MouseEvent<HTMLElement>) => {
    if (shouldBypassDeleteConfirm(event)) {
      void deleteSecret(secret)
      return
    }
    setDeleting(secret)
  }

  const toggleSecretReveal = useCallback(async (secret: SecretSafeView) => {
    if (!secret.hasValue) return

    const current = secretReveals[secret.id]
    if (current?.loading) return

    setSecretReveals((reveals) => ({
      ...reveals,
      [secret.id]: { loading: true },
    }))
    const requestGeneration = secretRevealGeneration.current

    try {
      const valueView = await secretsBridge.get({ name: secret.name, includeValue: true })
      if (!("value" in valueView)) {
        throw new Error("Secret value was not returned.")
      }
      setSecretReveals((reveals) => {
        if (requestGeneration !== secretRevealGeneration.current) return reveals
        const next = { ...reveals }
        delete next[secret.id]
        return next
      })
      if (requestGeneration === secretRevealGeneration.current) {
        setSecretValueDialog({ secret, value: valueView.value })
      }
    } catch (error) {
      logger.error("Failed to reveal secret value.", { name: secret.name, ...errorDiagnostic(error) })
      setSecretReveals((reveals) => {
        if (requestGeneration !== secretRevealGeneration.current) return reveals
        return {
          ...reveals,
          [secret.id]: { error: "读取失败" },
        }
      })
      if (requestGeneration === secretRevealGeneration.current) {
        toast.error("读取失败")
      }
    }
  }, [secretReveals, secretsBridge])

  const copySecretValue = useCallback(async (): Promise<boolean> => {
    if (!secretValueDialog) return false
    try {
      await navigator.clipboard.writeText(secretValueDialog.value)
      toast.success("已复制")
      return true
    } catch (error) {
      logger.error("Failed to copy secret value.", { name: secretValueDialog.secret.name, ...errorDiagnostic(error) })
      toast.error("复制失败")
      return false
    }
  }, [secretValueDialog])

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
              reveals={secretReveals}
              onDelete={startDeleteSecret}
              onEdit={openEditForm}
              onRevealToggle={(secret) => void toggleSecretReveal(secret)}
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
        onDelete={() => {
          if (deleting) void deleteSecret(deleting)
        }}
      />
      <SecretValueDialog
        dialog={secretValueDialog}
        onCopy={copySecretValue}
        onOpenChange={(open) => {
          if (!open) setSecretValueDialog(null)
        }}
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
        <col data-column="value" className="w-64" />
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
  reveals,
  onDelete,
  onEdit,
  onRevealToggle,
}: {
  readonly secrets: SecretSafeView[]
  readonly reveals: SecretRevealStateById
  readonly onDelete: (secret: SecretSafeView, event: MouseEvent<HTMLElement>) => void
  readonly onEdit: (secret: SecretSafeView) => void
  readonly onRevealToggle: (secret: SecretSafeView) => void
}) {
  return (
    <Table containerClassName="rounded-md border bg-background" className="min-w-[42rem] table-fixed">
      <colgroup>
        <col data-column="name" className="w-56" />
        <col data-column="description" />
        <col data-column="value" className="w-64" />
        <col data-column="actions" className="w-24" />
      </colgroup>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>名称</TableHead>
          <TableHead>描述</TableHead>
          <TableHead>值</TableHead>
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
            <TableCell className="min-w-0 align-middle">
              <SecretValueCell
                reveal={reveals[secret.id]}
                secret={secret}
                onRevealToggle={onRevealToggle}
              />
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
                  onClick={(event) => onDelete(secret, event)}
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

function SecretValueCell({
  reveal,
  secret,
  onRevealToggle,
}: {
  readonly reveal: SecretRevealState | undefined
  readonly secret: SecretSafeView
  readonly onRevealToggle: (secret: SecretSafeView) => void
}) {
  if (!secret.hasValue) {
    return <span className="text-sm text-muted-foreground">空值</span>
  }

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={`显示密钥值：${secret.name}`}
        disabled={reveal?.loading === true}
        onClick={() => onRevealToggle(secret)}
      >
        <Eye className="size-3.5" />
      </Button>
      {reveal?.loading ? (
        <span className="truncate text-sm text-muted-foreground">读取中</span>
      ) : reveal?.error ? (
        <span className="truncate text-sm text-destructive">读取失败</span>
      ) : (
        <span className="truncate font-mono text-sm text-muted-foreground">••••••••</span>
      )}
    </div>
  )
}

function SecretValueDialog({
  dialog,
  onCopy,
  onOpenChange,
}: {
  readonly dialog: SecretValueDialogState | null
  readonly onCopy: () => Promise<boolean>
  readonly onOpenChange: (open: boolean) => void
}) {
  const [copied, setCopied] = useState(false)
  const copyButtonRef = useRef<HTMLButtonElement>(null)
  const copiedResetTimer = useRef<number | null>(null)

  const clearCopiedResetTimer = useCallback(() => {
    if (copiedResetTimer.current === null) return
    window.clearTimeout(copiedResetTimer.current)
    copiedResetTimer.current = null
  }, [])

  useEffect(() => {
    clearCopiedResetTimer()
    setCopied(false)
    if (dialog) copyButtonRef.current?.focus()
    return clearCopiedResetTimer
  }, [clearCopiedResetTimer, dialog])

  const handleCopy = async () => {
    const ok = await onCopy()
    if (!ok) return
    clearCopiedResetTimer()
    setCopied(true)
    copiedResetTimer.current = window.setTimeout(() => {
      setCopied(false)
      copiedResetTimer.current = null
    }, 1600)
  }

  return (
    <Dialog open={Boolean(dialog)} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{dialog?.secret.name ?? "密钥值"}</DialogTitle>
          <DialogDescription>值已明文显示。</DialogDescription>
        </DialogHeader>
        <Textarea
          aria-label="密钥值"
          className="min-h-28 font-mono text-sm"
          value={dialog?.value ?? ""}
          readOnly
          data-allow-select="true"
        />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
          <Button ref={copyButtonRef} type="button" onClick={() => void handleCopy()} disabled={!dialog} autoFocus>
            <Clipboard data-icon="inline-start" />
            {copied ? "已复制" : "复制"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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

function errorDiagnostic(error: unknown): { readonly errorName?: string, readonly errorMessageLength: number } {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessageLength: error.message.length,
    }
  }
  return {
    errorMessageLength: String(error).length,
  }
}
