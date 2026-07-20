import { useEffect, useMemo, useState, type FormEvent } from "react"
import { Check, Copy, ExternalLink, Info, LoaderCircle } from "lucide-react"
import { toast } from "sonner"
import { DRIVE_DEFAULT_ACCESS_SETTINGS, type DriveAccessExpiresIn, type DriveItemDto, type DriveSiteDto, type DriveSitePreflightDto } from "@synapse/shared"
import { FormDialog } from "@/components/form-dialog"
import { MarkdownViewer } from "@/components/markdown-viewer"
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFrame, DialogFrameBody, DialogFrameFooter, DialogFrameHeader } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { driveErrorMessage as errorMessage, formatDriveBytes as formatBytes } from "@/lib/drive-format"
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

const DRIVE_SITE_BUNDLED_GUIDE_MARKDOWN = `## 打包站点发布设置

适用于 Vite、Vue、React 等打包后生成 \`dist\` 的前端项目。Synapse 站点链接位于 \`/sites/site_xxx/\` 下，构建产物需要使用相对路径。

### Vite

\`\`\`js
export default defineConfig({
  base: './',
})
\`\`\`

### 入口资源

\`\`\`html
<link rel="icon" href="./favicon/playground.png">
\`\`\`

### 路由

Vue Router 或 React Router 建议使用 hash 路由。history 路由刷新深层页面时，需要服务端回退到入口页，当前站点发布不会自动处理。

### 上传

上传 \`dist\` 里的内容，让 \`index.html\` 位于站点文件夹根目录。不要只上传外层 \`dist\` 文件夹。`

const DRIVE_SITE_AGENT_PROMPT = `请帮我把这个前端项目调整为适合发布到 Synapse 网盘站点的静态打包产物：

1. 检查项目使用的构建工具和路由模式。
2. 如果是 Vite 项目，在 vite.config 中设置 base: './'。
3. 检查 index.html、favicon、public 资源和动态导入资源，确保打包后使用相对路径，不要生成 /assets 或 /favicon 这样的站点根路径引用。
4. 如果使用 Vue Router 或 React Router，优先保持 hash 路由；如果必须使用 history 路由，请说明 Synapse 站点发布当前没有深层路径 fallback，刷新子路径可能 404。
5. 运行 build。
6. 检查 dist/index.html，确认不包含 src="/assets、href="/assets、href="/favicon 这类根路径引用。
7. 告诉我应该上传 dist 里的内容，而不是只上传外层 dist 文件夹。`

function DriveSiteCreateDialog({
  folder,
  open,
  onCreated,
  onOpenChange,
}: DriveSiteCreateDialogProps) {
  const [preflight, setPreflight] = useState<DriveSitePreflightDto | null>(null)
  const [createdSite, setCreatedSite] = useState<DriveSiteDto | null>(null)
  const [guideOpen, setGuideOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<DriveSiteCreateState>(() => createInitialForm(null, null))

  useEffect(() => {
    if (!open || !folder) return
    let cancelled = false
    setPreflight(null)
    setCreatedSite(null)
    setGuideOpen(false)
    setError(null)
    setForm(createInitialForm(folder, null))
    setLoading(true)
    requireSynapseBridge().drive.site.preflight({ sourceFolderItemId: folder.id })
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
  const showBundledSiteGuide = Boolean(preflight?.includesJavaScript && !createdSite)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!folder || !preflight || !canSubmit || !selectedEntryExists) return
    setSubmitting(true)
    setError(null)
    try {
      const site = await requireSynapseBridge().drive.site.create({
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
    <>
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
              <DriveSiteSubmitButton
                disabled={!canSubmit || !selectedEntryExists || loading}
                fileCount={preflight?.fileCount ?? 0}
                submitting={submitting}
              />
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
                  {showBundledSiteGuide ? <DriveSiteBundledGuideBanner onOpen={() => setGuideOpen(true)} /> : null}
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
      <DriveSiteBundledGuideDialog open={guideOpen} onOpenChange={setGuideOpen} />
    </>
  )
}

function DriveSiteSubmitButton({
  disabled,
  fileCount,
  submitting,
}: {
  readonly disabled: boolean
  readonly fileCount: number
  readonly submitting: boolean
}) {
  const [tooltipOpen, setTooltipOpen] = useState(false)
  const button = (
    <Button type="submit" disabled={disabled || submitting}>
      {submitting ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : null}
      {submitting ? "发布中" : "发布"}
    </Button>
  )
  if (!submitting) return button
  return (
    <TooltipProvider>
      <Tooltip open={tooltipOpen} onOpenChange={setTooltipOpen}>
        <TooltipTrigger asChild>
          <span
            className="inline-flex"
            onMouseEnter={() => setTooltipOpen(true)}
            onMouseLeave={() => setTooltipOpen(false)}
          >
            {button}
          </span>
        </TooltipTrigger>
        <TooltipContent>正在复制 {fileCount} 个文件</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

function DriveSiteBundledGuideBanner({ onOpen }: { readonly onOpen: () => void }) {
  return (
    <Alert>
      <Info className="size-4" aria-hidden="true" />
      <AlertTitle>打包站点需要相对路径</AlertTitle>
      <AlertDescription>发布前检查构建配置。</AlertDescription>
      <AlertAction>
        <Button type="button" size="sm" variant="outline" onClick={onOpen}>查看设置</Button>
      </AlertAction>
    </Alert>
  )
}

function DriveSiteBundledGuideDialog({
  open,
  onOpenChange,
}: {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined} className="max-h-[calc(100vh-2rem)] overflow-hidden p-0 sm:max-w-2xl" showCloseButton={false}>
        <DialogFrame className="max-h-[calc(100vh-2rem)]">
          <DialogFrameHeader title="打包站点设置" />
          <DialogFrameBody>
            <ScrollArea className="h-full min-h-0">
              <div className="px-5 py-4">
                <MarkdownViewer content={DRIVE_SITE_BUNDLED_GUIDE_MARKDOWN} showTabs={false} surface="plain" />
              </div>
            </ScrollArea>
          </DialogFrameBody>
          <DialogFrameFooter>
            <Button type="button" variant="outline" onClick={() => { void copyText(DRIVE_SITE_AGENT_PROMPT, "已复制") }}>
              <Copy data-icon="inline-start" />
              复制
            </Button>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>关闭</Button>
          </DialogFrameFooter>
        </DialogFrame>
      </DialogContent>
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
