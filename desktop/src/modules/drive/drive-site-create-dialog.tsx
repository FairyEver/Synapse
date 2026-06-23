import { useEffect, useMemo, useState, type FormEvent } from "react"
import { Check, Copy, ExternalLink, LoaderCircle } from "lucide-react"
import { toast } from "sonner"
import { DRIVE_DEFAULT_ACCESS_SETTINGS, type DriveAccessExpiresIn, type DriveItemDto, type DriveSiteDto, type DriveSitePreflightDto } from "@synapse/shared"
import { FormDialog } from "@/components/form-dialog"
import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { requireSynapseBridge } from "@/lib/electron-bridge"

type DriveSiteCreateDialogProps = {
  readonly folder: DriveItemDto | null
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onCreated: (site: DriveSiteDto) => void
}

type DriveSiteCreateState = {
  readonly name: string
  readonly entryPath: string
  readonly passwordEnabled: boolean
  readonly expiresIn: DriveAccessExpiresIn
}

const DRIVE_SITE_EXPIRES_OPTIONS: ReadonlyArray<{ readonly label: string; readonly value: DriveAccessExpiresIn }> = [
  { label: "3 天", value: "3d" },
  { label: "7 天", value: "7d" },
  { label: "30 天", value: "30d" },
  { label: "1 年", value: "1y" },
  { label: "永久", value: "forever" },
]

function DriveSiteCreateDialog({
  folder,
  open,
  onCreated,
  onOpenChange,
}: DriveSiteCreateDialogProps) {
  const [preflight, setPreflight] = useState<DriveSitePreflightDto | null>(null)
  const [createdSite, setCreatedSite] = useState<DriveSiteDto | null>(null)
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<DriveSiteCreateState>(() => createInitialForm(null, null))

  useEffect(() => {
    if (!open || !folder) return
    let cancelled = false
    setPreflight(null)
    setCreatedSite(null)
    setError(null)
    setForm(createInitialForm(folder, null))
    setLoading(true)
    requireSynapseBridge().account.preflightDriveSite({ sourceFolderItemId: folder.id })
      .then((result) => {
        if (cancelled) return
        setPreflight(result)
        setForm(createInitialForm(folder, result))
      })
      .catch((rawError) => {
        if (cancelled) return
        setError(errorMessage(rawError, "站点预检失败"))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [folder, open])

  const htmlFiles = preflight?.htmlFiles ?? []
  const canSubmit = Boolean(folder && preflight && htmlFiles.length > 0 && form.name.trim() && form.entryPath)
  const selectedEntryExists = useMemo(() => htmlFiles.includes(form.entryPath), [form.entryPath, htmlFiles])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!folder || !preflight || !canSubmit || !selectedEntryExists) return
    setSubmitting(true)
    setError(null)
    try {
      const site = await requireSynapseBridge().account.createDriveSite({
        sourceFolderItemId: folder.id,
        name: form.name.trim(),
        entryPath: form.entryPath,
        accessMode: form.passwordEnabled ? "password" : "public",
        expiresIn: form.expiresIn,
      })
      setCreatedSite(site)
      onCreated(site)
      toast("站点已发布")
    } catch (rawError) {
      setError(errorMessage(rawError, "站点发布失败"))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (!submitting) onOpenChange(nextOpen)
    }}>
      <FormDialog
        title="发布站点"
        description={folder ? <span className="block truncate">{folder.name}</span> : undefined}
        contentClassName="sm:max-w-lg"
        onSubmit={handleSubmit}
        footer={createdSite ? (
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>关闭</Button>
        ) : (
          <>
            <Button type="button" variant="outline" disabled={submitting} onClick={() => onOpenChange(false)}>取消</Button>
            <Button type="submit" disabled={!canSubmit || !selectedEntryExists || loading || submitting}>
              {submitting ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : null}
              发布
            </Button>
          </>
        )}
      >
        {createdSite ? (
          <DriveSiteCreatedContent site={createdSite} />
        ) : (
          <div className="grid gap-5">
            {loading ? (
              <div className="flex min-h-24 items-center justify-center text-sm text-muted-foreground">
                <LoaderCircle className="mr-2 size-4 animate-spin" aria-hidden="true" />
                读取中
              </div>
            ) : null}
            {!loading && preflight ? (
              <>
                <div className="grid gap-2">
                  <Label htmlFor="drive-site-name">名称</Label>
                  <Input
                    id="drive-site-name"
                    value={form.name}
                    onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                    autoFocus
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="drive-site-entry">首页</Label>
                  <NativeSelect
                    id="drive-site-entry"
                    className="w-full"
                    value={form.entryPath}
                    disabled={htmlFiles.length === 0}
                    onChange={(event) => setForm((current) => ({ ...current, entryPath: event.target.value }))}
                  >
                    {htmlFiles.length === 0 ? <NativeSelectOption value="">无 HTML 文件</NativeSelectOption> : null}
                    {htmlFiles.map((path) => (
                      <NativeSelectOption key={path} value={path}>{path}</NativeSelectOption>
                    ))}
                  </NativeSelect>
                </div>
                <label className="flex min-h-8 items-center justify-between gap-4" htmlFor="drive-site-password-enabled">
                  <span className="text-sm font-medium leading-none">需要密码</span>
                  <Switch
                    id="drive-site-password-enabled"
                    aria-label="需要密码"
                    checked={form.passwordEnabled}
                    onCheckedChange={(checked) => setForm((current) => ({ ...current, passwordEnabled: checked }))}
                  />
                </label>
                <div className="grid gap-2.5">
                  <Label>有效时长</Label>
                  <ToggleGroup
                    type="single"
                    variant="outline"
                    size="sm"
                    className="w-full"
                    value={form.expiresIn}
                    onValueChange={(value) => {
                      if (!value) return
                      setForm((current) => ({ ...current, expiresIn: value as DriveAccessExpiresIn }))
                    }}
                  >
                    {DRIVE_SITE_EXPIRES_OPTIONS.map((option) => (
                      <ToggleGroupItem key={option.value} className="h-8 flex-1" type="button" value={option.value}>
                        {option.label}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </div>
                <dl className="grid rounded-lg border text-sm sm:grid-cols-2">
                  <div className="min-w-0 border-b p-3 sm:border-r sm:border-b-0">
                    <dt className="font-medium">文件</dt>
                    <dd className="mt-1 text-muted-foreground tabular-nums">{preflight.fileCount}</dd>
                  </div>
                  <div className="min-w-0 p-3">
                    <dt className="font-medium">大小</dt>
                    <dd className="mt-1 text-muted-foreground">{formatBytes(preflight.totalBytes)}</dd>
                  </div>
                </dl>
              </>
            ) : null}
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>
        )}
      </FormDialog>
    </Dialog>
  )
}

function DriveSiteCreatedContent({ site }: { readonly site: DriveSiteDto }) {
  return (
    <div className="grid gap-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Check className="size-4 text-muted-foreground" aria-hidden="true" />
        <span>站点已发布</span>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="drive-site-created-url">访问链接</Label>
        <Input id="drive-site-created-url" className="font-mono text-sm" value={site.urlWithPassword} readOnly />
      </div>
      {site.passwordEnabled && site.password ? (
        <div className="grid gap-2">
          <Label htmlFor="drive-site-created-password">密码</Label>
          <div className="flex gap-2">
            <Input id="drive-site-created-password" className="font-mono text-sm" value={site.password} readOnly />
            <Button type="button" size="icon" variant="outline" aria-label="复制密码" onClick={() => { void copyText(site.password ?? "", "密码已复制") }}>
              <Copy aria-hidden="true" />
            </Button>
          </div>
        </div>
      ) : null}
      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button type="button" size="sm" variant="outline" className="w-full sm:w-auto" onClick={() => { void copyText(site.urlWithPassword, "链接已复制") }}>
          <Copy data-icon="inline-start" />
          复制链接
        </Button>
        <Button type="button" size="sm" variant="outline" className="w-full sm:w-auto" onClick={() => { void openExternal(site.urlWithPassword) }}>
          <ExternalLink data-icon="inline-start" />
          打开站点
        </Button>
      </div>
    </div>
  )
}

function createInitialForm(folder: DriveItemDto | null, preflight: DriveSitePreflightDto | null): DriveSiteCreateState {
  return {
    name: folder?.name ?? "",
    entryPath: preflight?.defaultEntryPath ?? preflight?.htmlFiles[0] ?? "",
    passwordEnabled: DRIVE_DEFAULT_ACCESS_SETTINGS.passwordEnabled,
    expiresIn: DRIVE_DEFAULT_ACCESS_SETTINGS.expiresIn,
  }
}

function formatBytes(value: string): string {
  const bytes = Number(value)
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B"
  const units = ["B", "KB", "MB", "GB", "TB"] as const
  let size = bytes
  let unitIndex = 0
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(size)} ${units[unitIndex]}`
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback
}

async function copyText(value: string, successMessage: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value)
    toast(successMessage)
  } catch {
    toast("复制失败")
  }
}

async function openExternal(url: string): Promise<void> {
  await requireSynapseBridge().shell.openExternal(url).catch(() => {
    toast("打开失败")
  })
}

export { DriveSiteCreateDialog }
