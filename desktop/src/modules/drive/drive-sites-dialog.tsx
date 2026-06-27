import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react"
import { Copy, ExternalLink, LoaderCircle, MoreHorizontal, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import type { DriveAccessExpiresIn, DriveSiteDto } from "@synapse/shared"
import { FormDialog } from "@/components/form-dialog"
import { RelativeTime } from "@/components/relative-time"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import { DRIVE_SITE_TABLE_COLUMNS, DriveTableColumns } from "./drive-table-columns"

type DriveSitesDialogProps = {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
}

type DriveSitesState = {
  readonly items: DriveSiteDto[]
  readonly loading: boolean
  readonly loadingMore: boolean
  readonly error: string | null
  readonly page: {
    readonly hasMore: boolean
    readonly nextOffset: number | null
  } | null
}

type DriveSiteAccessState = {
  readonly site: DriveSiteDto
  readonly passwordEnabled: boolean
  readonly expiresIn: DriveAccessExpiresIn
}

type DriveSiteConfirmState =
  | { readonly action: "disable"; readonly site: DriveSiteDto }
  | { readonly action: "delete"; readonly site: DriveSiteDto }

const DRIVE_SITE_PAGE_SIZE = 50
const DRIVE_SITE_SKELETON_ROWS = Array.from({ length: 5 }, (_, index) => index)
const DRIVE_SITE_EXPIRES_OPTIONS: ReadonlyArray<{ readonly label: string; readonly value: DriveAccessExpiresIn }> = [
  { label: "3 天", value: "3d" },
  { label: "7 天", value: "7d" },
  { label: "30 天", value: "30d" },
  { label: "1 年", value: "1y" },
  { label: "永久", value: "forever" },
]

function DriveSitesDialog({ open, onOpenChange }: DriveSitesDialogProps) {
  const [state, setState] = useState<DriveSitesState>(() => createInitialState())
  const [busySiteId, setBusySiteId] = useState<string | null>(null)
  const [accessState, setAccessState] = useState<DriveSiteAccessState | null>(null)
  const [confirmState, setConfirmState] = useState<DriveSiteConfirmState | null>(null)
  const loadGenerationRef = useRef(0)

  const loadSites = useCallback(async (input: { readonly offset?: number; readonly append?: boolean; readonly generation?: number } = {}) => {
    const append = input.append ?? false
    const generation = input.generation ?? loadGenerationRef.current
    setState((current) => ({ ...current, loading: !append, loadingMore: append, error: null }))
    try {
      const result = await requireSynapseBridge().account.listDriveSites({
        offset: input.offset ?? 0,
        limit: DRIVE_SITE_PAGE_SIZE,
      })
      if (loadGenerationRef.current !== generation) return
      setState((current) => ({
        items: append ? [...current.items, ...result.items] : [...result.items],
        loading: false,
        loadingMore: false,
        error: null,
        page: result.page,
      }))
    } catch (rawError) {
      if (loadGenerationRef.current !== generation) return
      const message = errorMessage(rawError, "站点列表加载失败")
      setState((current) => ({ ...current, loading: false, loadingMore: false, error: message }))
      toast(message)
    }
  }, [])

  useEffect(() => {
    const generation = loadGenerationRef.current + 1
    loadGenerationRef.current = generation
    if (!open) return
    setState(createInitialState())
    void loadSites({ generation })
  }, [loadSites, open])

  const reloadSites = useCallback(async () => {
    await loadSites({ generation: loadGenerationRef.current })
  }, [loadSites])

  const mutateSite = useCallback(async (site: DriveSiteDto, action: "enable" | "republish") => {
    setBusySiteId(site.siteId)
    try {
      if (action === "enable") {
        await requireSynapseBridge().account.enableDriveSite({ siteId: site.siteId })
        toast("站点已启用")
      } else {
        await requireSynapseBridge().account.republishDriveSite({ siteId: site.siteId, entryPath: site.entryPath })
        toast("站点已重新发布")
      }
      await reloadSites()
    } catch (rawError) {
      toast(errorMessage(rawError, action === "enable" ? "启用失败" : "重新发布失败"))
    } finally {
      setBusySiteId(null)
    }
  }, [reloadSites])

  const confirmMutation = async () => {
    if (!confirmState) return
    setBusySiteId(confirmState.site.siteId)
    try {
      if (confirmState.action === "disable") {
        await requireSynapseBridge().account.disableDriveSite({ siteId: confirmState.site.siteId })
        toast("站点已停用")
      } else {
        await requireSynapseBridge().account.deleteDriveSite({ siteId: confirmState.site.siteId })
        toast("站点已删除")
      }
      setConfirmState(null)
      await reloadSites()
    } catch (rawError) {
      toast(errorMessage(rawError, confirmState.action === "disable" ? "停用失败" : "删除失败"))
    } finally {
      setBusySiteId(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined} className="max-h-[85vh] w-[calc(100%-2rem)] overflow-hidden p-0 sm:max-w-5xl">
        <div className="flex max-h-[85vh] min-h-0 flex-col overflow-hidden">
          <DialogHeader className="px-5 pt-5">
            <DialogTitle>站点</DialogTitle>
          </DialogHeader>
          <ScrollArea className="min-h-0 flex-1">
            <div className="px-5 py-4">
              <DriveSiteTableContent
                busySiteId={busySiteId}
                error={state.error}
                loading={state.loading}
                loadingMore={state.loadingMore}
                page={state.page}
                sites={state.items}
                onAccess={setAccessState}
                onConfirm={setConfirmState}
                onEnable={(site) => { void mutateSite(site, "enable") }}
                onLoadMore={() => {
                  if (!state.page?.hasMore || state.page.nextOffset === null) return
                  void loadSites({ offset: state.page.nextOffset, append: true, generation: loadGenerationRef.current })
                }}
                onReload={reloadSites}
                onRepublish={(site) => { void mutateSite(site, "republish") }}
              />
            </div>
          </ScrollArea>
          <DialogFooter className="mx-0 mb-0 shrink-0 flex-col gap-2 rounded-none rounded-b-xl px-5 py-4 sm:flex-row sm:items-center sm:justify-end">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>关闭</Button>
          </DialogFooter>
        </div>
      </DialogContent>
      <DriveSiteAccessDialog
        accessState={accessState}
        busy={busySiteId !== null}
        onCancel={() => setAccessState(null)}
        onSaved={async () => {
          setAccessState(null)
          await reloadSites()
        }}
        setBusySiteId={setBusySiteId}
      />
      <AlertDialog open={confirmState !== null} onOpenChange={(nextOpen) => {
        if (!nextOpen && busySiteId === null) setConfirmState(null)
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmState?.action === "delete" ? "确认删除" : "确认停用"}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                <div>{confirmState?.action === "delete" ? "删除后站点链接将不可访问。" : "停用后站点链接将不可访问。"}</div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busySiteId !== null}>取消</AlertDialogCancel>
            <AlertDialogAction
              variant={confirmState?.action === "delete" ? "destructive" : "default"}
              disabled={busySiteId !== null}
              onClick={() => { void confirmMutation() }}
            >
              {confirmState?.action === "delete" ? "删除" : "停用"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  )
}

function DriveSiteTableContent({
  busySiteId,
  error,
  loading,
  loadingMore,
  page,
  sites,
  onAccess,
  onConfirm,
  onEnable,
  onLoadMore,
  onReload,
  onRepublish,
}: {
  readonly busySiteId: string | null
  readonly error: string | null
  readonly loading: boolean
  readonly loadingMore: boolean
  readonly page: DriveSitesState["page"]
  readonly sites: readonly DriveSiteDto[]
  readonly onAccess: (state: DriveSiteAccessState) => void
  readonly onConfirm: (state: DriveSiteConfirmState) => void
  readonly onEnable: (site: DriveSiteDto) => void
  readonly onLoadMore: () => void
  readonly onReload: () => Promise<void>
  readonly onRepublish: (site: DriveSiteDto) => void
}) {
  if (loading) return <DriveSiteTableSkeleton />
  if (error) {
    return (
      <Empty className="min-h-48 border">
        <EmptyHeader>
          <EmptyTitle>站点加载失败</EmptyTitle>
          <EmptyDescription>{error}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button type="button" size="sm" variant="outline" onClick={() => { void onReload() }}>
            <RefreshCw data-icon="inline-start" />
            重试
          </Button>
        </EmptyContent>
      </Empty>
    )
  }
  if (sites.length === 0) {
    return (
      <Empty className="min-h-48 border">
        <EmptyHeader>
          <EmptyTitle>暂无站点</EmptyTitle>
        </EmptyHeader>
      </Empty>
    )
  }
  return (
    <div className="grid gap-3">
      <Table containerClassName="rounded-lg border" className="min-w-[960px] table-fixed">
        <DriveTableColumns columns={DRIVE_SITE_TABLE_COLUMNS} />
        <DriveSiteTableHeader />
        <TableBody>
          {sites.map((site) => (
            <DriveSiteRow
              key={site.id}
              busy={busySiteId === site.siteId}
              site={site}
              onAccess={onAccess}
              onConfirm={onConfirm}
              onEnable={onEnable}
              onRepublish={onRepublish}
            />
          ))}
        </TableBody>
      </Table>
      {page?.hasMore ? (
        <div className="flex justify-center">
          <Button type="button" size="sm" variant="outline" disabled={loadingMore} onClick={onLoadMore}>
            {loadingMore ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : null}
            加载更多
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function DriveSiteTableHeader() {
  return (
    <TableHeader>
      <TableRow className="hover:bg-transparent">
        <TableHead>站点</TableHead>
        <TableHead>状态</TableHead>
        <TableHead>访问</TableHead>
        <TableHead className="text-right">到期</TableHead>
        <TableHead className="text-right">更新</TableHead>
        <TableHead className="text-right">大小</TableHead>
        <TableHead className="text-right" aria-label="操作" />
      </TableRow>
    </TableHeader>
  )
}

function DriveSiteRow({
  busy,
  site,
  onAccess,
  onConfirm,
  onEnable,
  onRepublish,
}: {
  readonly busy: boolean
  readonly site: DriveSiteDto
  readonly onAccess: (state: DriveSiteAccessState) => void
  readonly onConfirm: (state: DriveSiteConfirmState) => void
  readonly onEnable: (site: DriveSiteDto) => void
  readonly onRepublish: (site: DriveSiteDto) => void
}) {
  return (
    <TableRow>
      <TableCell className="min-w-0">
        <div className="grid gap-1">
          <div className="truncate font-medium" title={site.name}>{site.name}</div>
          <div className="truncate text-xs text-muted-foreground" title={site.url}>{site.url}</div>
        </div>
      </TableCell>
      <TableCell><DriveSiteStatusBadge status={site.status} /></TableCell>
      <TableCell>{site.accessMode === "password" ? "密码" : "公开"}</TableCell>
      <TableCell className="truncate text-right text-muted-foreground tabular-nums">
        <RelativeTime value={site.expiresAt} fallback="永久" />
      </TableCell>
      <TableCell className="truncate text-right text-muted-foreground tabular-nums">
        <RelativeTime value={site.updatedAt} />
      </TableCell>
      <TableCell className="text-right text-muted-foreground tabular-nums">{formatBytes(site.totalBytes)}</TableCell>
      <TableCell className="text-right">
        <div className="flex items-center justify-end gap-0.5">
          {busy ? <LoaderCircle className="size-4 animate-spin text-muted-foreground" aria-hidden="true" /> : null}
          <DriveSiteIconAction label={`复制 ${site.name}`} tooltip="复制链接" onClick={() => { void copyText(site.urlWithPassword, "链接已复制") }}>
            <Copy />
          </DriveSiteIconAction>
          <DriveSiteIconAction label={`打开 ${site.name}`} tooltip="打开" onClick={() => { void openExternal(site.urlWithPassword) }}>
            <ExternalLink />
          </DriveSiteIconAction>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="icon-xs" disabled={busy} aria-label={`更多 ${site.name}`}>
                <MoreHorizontal aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onAccess({
                site,
                passwordEnabled: site.accessMode === "password",
                expiresIn: site.expiresAt ? "30d" : "forever",
              })}>
                访问设置
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onRepublish(site)}>重新发布</DropdownMenuItem>
              {site.status === "disabled" ? (
                <DropdownMenuItem onClick={() => onEnable(site)}>启用</DropdownMenuItem>
              ) : (
                <DropdownMenuItem onClick={() => onConfirm({ action: "disable", site })}>停用</DropdownMenuItem>
              )}
              <DropdownMenuItem variant="destructive" onClick={() => onConfirm({ action: "delete", site })}>删除</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </TableCell>
    </TableRow>
  )
}

function DriveSiteAccessDialog({
  accessState,
  busy,
  onCancel,
  onSaved,
  setBusySiteId,
}: {
  readonly accessState: DriveSiteAccessState | null
  readonly busy: boolean
  readonly onCancel: () => void
  readonly onSaved: () => Promise<void>
  readonly setBusySiteId: (siteId: string | null) => void
}) {
  const [form, setForm] = useState<DriveSiteAccessState | null>(accessState)

  useEffect(() => {
    setForm(accessState)
  }, [accessState])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!form) return
    setBusySiteId(form.site.siteId)
    try {
      await requireSynapseBridge().account.updateDriveSiteAccess({
        siteId: form.site.siteId,
        accessMode: form.passwordEnabled ? "password" : "public",
        expiresIn: form.expiresIn,
      })
      toast("访问设置已保存")
      await onSaved()
    } catch (rawError) {
      toast(errorMessage(rawError, "保存失败"))
    } finally {
      setBusySiteId(null)
    }
  }

  return (
    <Dialog open={accessState !== null} onOpenChange={(nextOpen) => {
      if (!nextOpen && !busy) onCancel()
    }}>
      {form ? (
        <FormDialog
          title="访问设置"
          description={<span className="block truncate">{form.site.name}</span>}
          contentClassName="sm:max-w-lg"
          onSubmit={handleSubmit}
          footer={(
            <>
              <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>取消</Button>
              <Button type="submit" disabled={busy}>保存</Button>
            </>
          )}
        >
          <div className="grid gap-5">
            <label className="flex min-h-8 items-center justify-between gap-4" htmlFor="drive-site-access-password-enabled">
              <span className="text-sm font-medium leading-none">需要密码</span>
              <Switch
                id="drive-site-access-password-enabled"
                aria-label="需要密码"
                checked={form.passwordEnabled}
                onCheckedChange={(checked) => setForm((current) => current ? { ...current, passwordEnabled: checked } : current)}
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
                  setForm((current) => current ? { ...current, expiresIn: value as DriveAccessExpiresIn } : current)
                }}
              >
                {DRIVE_SITE_EXPIRES_OPTIONS.map((option) => (
                  <ToggleGroupItem key={option.value} className="h-8 flex-1" type="button" value={option.value}>
                    {option.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
          </div>
        </FormDialog>
      ) : null}
    </Dialog>
  )
}

function DriveSiteTableSkeleton() {
  return (
    <Table containerClassName="rounded-lg border" className="min-w-[960px] table-fixed">
      <DriveTableColumns columns={DRIVE_SITE_TABLE_COLUMNS} />
      <DriveSiteTableHeader />
      <TableBody>
        {DRIVE_SITE_SKELETON_ROWS.map((row) => (
          <TableRow key={row}>
            <TableCell><Skeleton className="h-4 w-56 max-w-full" /></TableCell>
            <TableCell><Skeleton className="h-5 w-14" /></TableCell>
            <TableCell><Skeleton className="h-4 w-10" /></TableCell>
            <TableCell><Skeleton className="ml-auto h-4 w-24" /></TableCell>
            <TableCell><Skeleton className="ml-auto h-4 w-24" /></TableCell>
            <TableCell><Skeleton className="ml-auto h-4 w-14" /></TableCell>
            <TableCell><Skeleton className="ml-auto h-7 w-24" /></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function DriveSiteIconAction({
  children,
  label,
  onClick,
  tooltip,
}: {
  readonly children: ReactNode
  readonly label: string
  readonly onClick: () => void
  readonly tooltip: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant="ghost" size="icon-xs" aria-label={label} onClick={onClick}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  )
}

function DriveSiteStatusBadge({ status }: { readonly status: DriveSiteDto["status"] }) {
  const label = ({
    active: "正常",
    disabled: "停用",
    expired: "过期",
    deleted: "删除",
    failed: "失败",
  } satisfies Record<DriveSiteDto["status"], string>)[status]
  return <Badge variant={status === "failed" ? "destructive" : status === "active" ? "secondary" : "outline"}>{label}</Badge>
}

function createInitialState(): DriveSitesState {
  return {
    items: [],
    loading: false,
    loadingMore: false,
    error: null,
    page: null,
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

export { DriveSitesDialog }
