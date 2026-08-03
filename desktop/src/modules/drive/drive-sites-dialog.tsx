import { useCallback, useEffect, useRef, useState, type FormEvent, type MouseEvent, type ReactNode } from "react"
import { Copy, ExternalLink, KeyRound, LoaderCircle, MoreHorizontal, RefreshCw, Settings2 } from "lucide-react"
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
import { Dialog } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { driveErrorMessage as errorMessage, formatDriveBytes as formatBytes } from "@/lib/drive-format"
import { shouldBypassDeleteConfirm } from "@/lib/delete-confirm-bypass"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import {
  DRIVE_SHARE_TABLE_COLUMNS,
  DRIVE_TABLE_STICKY_ACTION_COLUMN_CLASS,
  DriveTableColumns,
} from "./drive-table-columns"

type DriveSitesPanelProps = {
  readonly active: boolean
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

function DriveSitesPanel({ active }: DriveSitesPanelProps) {
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
      const result = await requireSynapseBridge().drive.site.list({
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
      const message = errorMessage(rawError, "网页分享列表加载失败")
      setState((current) => ({ ...current, loading: false, loadingMore: false, error: message }))
      toast(message)
    }
  }, [])

  useEffect(() => {
    const generation = loadGenerationRef.current + 1
    loadGenerationRef.current = generation
    if (!active) return
    setState(createInitialState())
    void loadSites({ generation })
  }, [active, loadSites])

  const reloadSites = useCallback(async () => {
    await loadSites({ generation: loadGenerationRef.current })
  }, [loadSites])

  const mutateSite = useCallback(async (site: DriveSiteDto, action: "enable" | "republish") => {
    setBusySiteId(site.siteId)
    try {
      if (action === "enable") {
        await requireSynapseBridge().drive.site.enable({ siteId: site.siteId })
        toast("网页分享已恢复")
      } else {
        await requireSynapseBridge().drive.site.republish({ siteId: site.siteId, entryPath: site.entryPath })
        toast("网页已更新")
      }
      await reloadSites()
    } catch (rawError) {
      toast(errorMessage(rawError, action === "enable" ? "恢复分享失败" : "更新网页失败"))
    } finally {
      setBusySiteId(null)
    }
  }, [reloadSites])

  const deleteSite = useCallback(async (site: DriveSiteDto) => {
    setBusySiteId(site.siteId)
    try {
      await requireSynapseBridge().drive.site.delete({ siteId: site.siteId })
      toast("网页分享已删除")
      setConfirmState(null)
      await reloadSites()
    } catch (rawError) {
      toast(errorMessage(rawError, "删除失败"))
    } finally {
      setBusySiteId(null)
    }
  }, [reloadSites])

  const confirmMutation = async () => {
    if (!confirmState) return
    if (confirmState.action === "delete") {
      await deleteSite(confirmState.site)
      return
    }
    setBusySiteId(confirmState.site.siteId)
    try {
      if (confirmState.action === "disable") {
        await requireSynapseBridge().drive.site.disable({ siteId: confirmState.site.siteId })
        toast("网页分享已停止")
      }
      setConfirmState(null)
      await reloadSites()
    } catch (rawError) {
      toast(errorMessage(rawError, confirmState.action === "disable" ? "停止分享失败" : "删除失败"))
    } finally {
      setBusySiteId(null)
    }
  }

  const handleConfirmStart = useCallback((state: DriveSiteConfirmState, event?: Pick<MouseEvent<HTMLElement>, "altKey">) => {
    if (state.action === "delete" && event && shouldBypassDeleteConfirm(event)) {
      void deleteSite(state.site)
      return
    }
    setConfirmState(state)
  }, [deleteSite])

  return (
    <>
      <DriveSiteTableContent
        busySiteId={busySiteId}
        error={state.error}
        loading={state.loading}
        loadingMore={state.loadingMore}
        page={state.page}
        sites={state.items}
        onAccess={setAccessState}
        onConfirm={handleConfirmStart}
        onEnable={(site) => { void mutateSite(site, "enable") }}
        onLoadMore={() => {
          if (!state.page?.hasMore || state.page.nextOffset === null) return
          void loadSites({ offset: state.page.nextOffset, append: true, generation: loadGenerationRef.current })
        }}
        onReload={reloadSites}
        onRepublish={(site) => { void mutateSite(site, "republish") }}
      />
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
            <AlertDialogTitle>{confirmState?.action === "delete" ? "确认删除网页分享" : "确认停止分享"}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                <div>{confirmState?.action === "delete" ? "删除后网页链接将不可访问。" : "停止后网页链接将不可访问。"}</div>
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
              {confirmState?.action === "delete" ? "删除" : "停止分享"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
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
  readonly onConfirm: (state: DriveSiteConfirmState, event?: MouseEvent<HTMLElement>) => void
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
          <EmptyTitle>网页分享加载失败</EmptyTitle>
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
          <EmptyTitle>暂无网页分享</EmptyTitle>
        </EmptyHeader>
      </Empty>
    )
  }
  return (
    <div className="grid gap-3">
      <Table className="table-fixed">
        <DriveTableColumns columns={DRIVE_SHARE_TABLE_COLUMNS} />
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
        <TableHead>名称</TableHead>
        <TableHead>链接信息</TableHead>
        <TableHead className={DRIVE_TABLE_STICKY_ACTION_COLUMN_CLASS}>操作</TableHead>
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
  readonly onConfirm: (state: DriveSiteConfirmState, event?: MouseEvent<HTMLElement>) => void
  readonly onEnable: (site: DriveSiteDto) => void
  readonly onRepublish: (site: DriveSiteDto) => void
}) {
  const password = site.password
  return (
    <TableRow>
      <TableCell className="min-w-0 whitespace-normal align-top">
        <div className="grid gap-1">
          <div className="truncate font-medium" title={site.name}>{site.name}</div>
          <div className="truncate text-xs text-muted-foreground" title={password ?? "无"}>
            密码 {password ?? "无"}
          </div>
        </div>
      </TableCell>
      <TableCell className="min-w-0 whitespace-normal align-top">
        <div className="grid gap-1.5">
          <div className="flex min-w-0 flex-wrap items-center gap-1">
            <Badge variant="outline">网页</Badge>
            <Badge variant="outline">{site.accessMode === "password" ? "密码" : "公开"}</Badge>
            <DriveSiteStatusBadge status={site.status} />
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs tabular-nums text-muted-foreground">
            <span className="truncate">到期 <RelativeTime value={site.expiresAt} fallback="永久" /></span>
            <span className="truncate">更新 <RelativeTime value={site.updatedAt} /></span>
            <span className="truncate">大小 {formatBytes(site.totalBytes)}</span>
          </div>
        </div>
      </TableCell>
      <TableCell className={`${DRIVE_TABLE_STICKY_ACTION_COLUMN_CLASS} align-top`}>
        <div className="flex items-center justify-end gap-0.5">
          <DriveSiteIconAction
            label={`访问设置 ${site.name}`}
            tooltip="访问设置"
            onClick={() => onAccess({
              site,
              passwordEnabled: site.accessMode === "password",
              expiresIn: site.expiresIn,
            })}
          >
            <Settings2 />
          </DriveSiteIconAction>
          <DriveSiteIconAction label={`复制 ${site.name}`} tooltip="复制链接" onClick={() => { void copyText(site.urlWithPassword, "链接已复制") }}>
            <Copy />
          </DriveSiteIconAction>
          {password ? (
            <DriveSiteIconAction label={`复制 ${site.name} 密码`} tooltip="复制密码" onClick={() => { void copyText(password, "密码已复制") }}>
              <KeyRound />
            </DriveSiteIconAction>
          ) : null}
          <DriveSiteIconAction label={`打开 ${site.name}`} tooltip="打开" onClick={() => { void openExternal(site.urlWithPassword) }}>
            <ExternalLink />
          </DriveSiteIconAction>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="icon-sm" disabled={busy} aria-label={`更多 ${site.name}`}>
                {busy ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <MoreHorizontal aria-hidden="true" />}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onRepublish(site)}>更新网页</DropdownMenuItem>
              {site.status === "disabled" ? (
                <DropdownMenuItem onClick={() => onEnable(site)}>恢复分享</DropdownMenuItem>
              ) : (
                <DropdownMenuItem onClick={() => onConfirm({ action: "disable", site })}>停止分享</DropdownMenuItem>
              )}
              <DropdownMenuItem variant="destructive" onClick={(event) => onConfirm({ action: "delete", site }, event)}>删除网页分享</DropdownMenuItem>
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
      await requireSynapseBridge().drive.site.updateAccess({
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
    <Table className="table-fixed">
      <DriveTableColumns columns={DRIVE_SHARE_TABLE_COLUMNS} />
      <DriveSiteTableHeader />
      <TableBody>
        {DRIVE_SITE_SKELETON_ROWS.map((row) => (
          <TableRow key={row}>
            <TableCell className="whitespace-normal align-top">
              <div className="grid gap-2">
                <Skeleton className="h-4 w-56 max-w-full" />
                <Skeleton className="h-3 w-24 max-w-full" />
              </div>
            </TableCell>
            <TableCell className="whitespace-normal align-top">
              <div className="grid gap-2">
                <Skeleton className="h-5 w-56 max-w-full" />
                <Skeleton className="h-3 w-72 max-w-full" />
              </div>
            </TableCell>
            <TableCell className={`${DRIVE_TABLE_STICKY_ACTION_COLUMN_CLASS} align-top`}><Skeleton className="ml-auto h-7 w-28 max-w-full" /></TableCell>
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
        <Button type="button" variant="ghost" size="icon-sm" aria-label={label} onClick={onClick}>
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
    disabled: "已停止",
    expired: "过期",
    deleted: "已删除",
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

export { DriveSitesPanel }
