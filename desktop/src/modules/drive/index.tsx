import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react"
import { toast } from "sonner"
import {
  ChevronRight,
  CircleUserRound,
  Copy,
  ExternalLink,
  FileText,
  Folder,
  FolderPlus,
  KeyRound,
  Link2,
  LoaderCircle,
  MoreHorizontal,
  RefreshCw,
  Search,
  Upload,
  X,
} from "lucide-react"
import {
  DRIVE_DEFAULT_ACCESS_SETTINGS,
  type DriveAccessSettingsInput,
  type DriveBrowserChildrenPageDto,
  type DriveItemDto,
  type DrivePublicLinksPageInput,
  type DriveShareDto,
  type DriveShareListItemDto,
  type DriveUploadPrepareResult,
  type DriveUsageDto,
} from "@synapse/shared"
import { useAccount } from "@/app-shell/account"
import { ModuleContentPanel, ModulePage } from "@/components/module-page"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import { FormDialog } from "@/components/form-dialog"
import {
  DRIVE_LOCAL_UPLOAD_MAX_FILES,
  DRIVE_LOCAL_UPLOAD_MAX_FOLDER_DEPTH,
  createDriveLocalUploadTooDeepError,
  createDriveLocalUploadTooManyFilesError,
} from "@/lib/drive-local-upload-limits"
import { cn } from "@/lib/utils"
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
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { DriveLocalUploadFolderItem, DriveLocalUploadItem, DriveLocalUploadRequest, DriveLocalUploadResult } from "@/types/bridge"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

type DrivePathEntry = {
  readonly id: string | null
  readonly name: string
}

type NameDialogState =
  | { readonly mode: "create"; readonly item: null; readonly value: string }
  | { readonly mode: "rename"; readonly item: DriveItemDto; readonly value: string }

type DriveMoveTreeBranch = {
  readonly error: string | null
  readonly folders: readonly DriveItemDto[]
  readonly loaded: boolean
  readonly loading: boolean
}

type DriveLoadError =
  | { readonly type: "auth" }
  | { readonly type: "load"; readonly message: string }

type DriveUsageState =
  | { readonly status: "idle"; readonly usage: null }
  | { readonly status: "loading"; readonly usage: DriveUsageDto | null }
  | { readonly status: "ready"; readonly usage: DriveUsageDto }
  | { readonly status: "error"; readonly usage: null }

type DriveAccessSettingsTarget = {
  readonly kind: "share"
  readonly item: DriveItemDto
}

type DriveAccessResultState = Pick<DriveShareDto, "url" | "urlWithPassword" | "passwordEnabled" | "password" | "expiresAt">
type DriveShareSuccessState = Pick<DriveItemDto, "name" | "type"> & {
  readonly url: DriveShareDto["url"]
  readonly urlWithPassword: DriveShareDto["urlWithPassword"]
  readonly passwordEnabled: DriveShareDto["passwordEnabled"]
  readonly password: DriveShareDto["password"]
  readonly expiresAt: DriveShareDto["expiresAt"]
}

type DriveAccessExpiresInOption = DriveAccessSettingsInput["expiresIn"]

type DriveStatusBadge = {
  readonly key: string
  readonly label: string
  readonly variant: "secondary" | "destructive" | "outline"
}

const DRIVE_ROOT_PARENT_VALUE = "root"
const DRIVE_SKELETON_ROWS = Array.from({ length: 8 }, (_, index) => index)
const DRIVE_PUBLIC_LINKS_PAGE_SIZE = 20
const DRIVE_PUBLIC_LINKS_FULL_LOAD_PAGE_SIZE = 100
const DRIVE_BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const
const DRIVE_BYTE_NUMBER_FORMAT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 })
const DRIVE_ACCESS_EXPIRES_OPTIONS: ReadonlyArray<{ readonly label: string; readonly value: DriveAccessExpiresInOption }> = [
  { label: "3 天", value: "3d" },
  { label: "7 天", value: "7d" },
  { label: "30 天", value: "30d" },
  { label: "1 年", value: "1y" },
  { label: "永久", value: "forever" },
]

function driveMoveTreeKey(parentId: string | null): string {
  return parentId ?? DRIVE_ROOT_PARENT_VALUE
}

function DriveModule() {
  const { pendingAction, startLogin, state: accountState } = useAccount()
  const [items, setItems] = useState<DriveItemDto[]>([])
  const [path, setPath] = useState<DrivePathEntry[]>([{ id: null, name: "根目录" }])
  const [loading, setLoading] = useState(false)
  const [usageState, setUsageState] = useState<DriveUsageState>({ status: "idle", usage: null })
  const [openingFolderId, setOpeningFolderId] = useState<string | null>(null)
  const [error, setError] = useState<DriveLoadError | null>(null)
  const [nameDialog, setNameDialog] = useState<NameDialogState | null>(null)
  const [moveTarget, setMoveTarget] = useState<DriveItemDto | null>(null)
  const [moveParentId, setMoveParentId] = useState<string>("root")
  const [deleteTarget, setDeleteTarget] = useState<DriveItemDto | null>(null)
  const [publicLinksOpen, setPublicLinksOpen] = useState(false)
  const [shareSuccess, setShareSuccess] = useState<DriveShareSuccessState | null>(null)
  const [accessSettingsTarget, setAccessSettingsTarget] = useState<DriveAccessSettingsTarget | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadItemCount, setUploadItemCount] = useState<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const prefetchedParentIdRef = useRef<string | null | undefined>(undefined)
  const currentParentIdRef = useRef<string | null>(null)

  const accountAuthenticated = accountState.status === "authenticated"
  const parentId = path.at(-1)?.id ?? null
  useEffect(() => {
    currentParentIdRef.current = parentId
  }, [parentId])

  const loadItems = useCallback(async () => {
    if (!accountAuthenticated) return
    setLoading(true)
    setError(null)
    try {
      const bridge = requireSynapseBridge()
      const nextItems = await bridge.account.listDriveItems({ parentId })
      setItems(nextItems)
    } catch (rawError) {
      setError(driveLoadError(rawError))
    } finally {
      setLoading(false)
    }
  }, [accountAuthenticated, parentId])

  const loadDriveUsage = useCallback(async () => {
    if (!accountAuthenticated) return
    setUsageState((current) => ({ status: "loading", usage: current.usage }))
    try {
      const usage = await requireSynapseBridge().account.getDriveUsage()
      setUsageState({ status: "ready", usage })
    } catch {
      setUsageState({ status: "error", usage: null })
    }
  }, [accountAuthenticated])

  const refreshDriveView = useCallback(async () => {
    await Promise.all([
      loadItems(),
      loadDriveUsage(),
    ])
  }, [loadDriveUsage, loadItems])

  useEffect(() => {
    if (!accountAuthenticated) {
      setItems([])
      setUsageState({ status: "idle", usage: null })
      setLoading(false)
      setOpeningFolderId(null)
      setError(null)
      setPath([{ id: null, name: "根目录" }])
      return
    }
    if (prefetchedParentIdRef.current !== undefined && prefetchedParentIdRef.current === parentId) {
      prefetchedParentIdRef.current = undefined
      return
    }
    void refreshDriveView()
  }, [accountAuthenticated, parentId, refreshDriveView])

  const actionsDisabled = !accountAuthenticated || loading || openingFolderId !== null || error !== null
  const uploadActionsDisabled = actionsDisabled || uploading

  const visibleItems = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return items
    return items.filter((item) => item.name.toLowerCase().includes(keyword))
  }, [items, query])

  const openFolder = useCallback(async (item: DriveItemDto) => {
    if (item.type !== "folder") return
    if (openingFolderId !== null) return
    setOpeningFolderId(item.id)
    setError(null)
    try {
      const nextItems = await requireSynapseBridge().account.listDriveItems({ parentId: item.id })
      prefetchedParentIdRef.current = item.id
      setItems(nextItems)
      setPath((current) => [...current, { id: item.id, name: item.name }])
    } catch (rawError) {
      setError(driveLoadError(rawError))
    } finally {
      setOpeningFolderId(null)
    }
  }, [openingFolderId])

  const jumpToPath = useCallback((index: number) => {
    setPath((current) => current.slice(0, index + 1))
  }, [])

  const refreshCurrentItemsAfterUpload = useCallback(async () => {
    if (!accountAuthenticated) return
    try {
      const nextItems = await requireSynapseBridge().account.listDriveItems({ parentId: currentParentIdRef.current })
      setError(null)
      setItems(nextItems)
    } catch (rawError) {
      setError(driveLoadError(rawError))
    }
    await loadDriveUsage()
  }, [accountAuthenticated, loadDriveUsage])

  const runLocalUpload = useCallback(async (createRequest: () => Promise<DriveLocalUploadBuildResult>) => {
    if (uploadActionsDisabled) return
    setUploading(true)
    try {
      const { request, skipped } = await createRequest()
      if (request.items.length === 0) {
        toast(skipped > 0 ? `已跳过 ${skipped} 个文件` : "没有可上传的文件")
        return
      }
      setUploadItemCount(countDriveLocalUploadItems(request.items))
      const result = await requireSynapseBridge().account.uploadDriveLocalItems(request)
      toast(uploadResultMessage(withSkipped(result, skipped)))
      await refreshCurrentItemsAfterUpload()
    } catch (rawError) {
      toast(errorMessage(rawError, "上传失败"))
    } finally {
      setUploading(false)
      setUploadItemCount(null)
    }
  }, [refreshCurrentItemsAfterUpload, uploadActionsDisabled])

  const handleFileSelected = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? [])
    event.currentTarget.value = ""
    await runLocalUpload(async () => buildDriveLocalUploadRequestFromFiles({
      files,
      mode: "files",
      parentId,
    }))
  }, [parentId, runLocalUpload])

  const handleFolderSelected = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? [])
    event.currentTarget.value = ""
    await runLocalUpload(async () => buildDriveLocalUploadRequestFromFiles({
      files,
      mode: "folders",
      parentId,
    }))
  }, [parentId, runLocalUpload])

  const handleDroppedFiles = useCallback(async (dataTransfer: DataTransfer) => {
    await runLocalUpload(async () => buildDriveLocalUploadRequestFromDrop({
      dataTransfer,
      parentId,
    }))
  }, [parentId, runLocalUpload])

  const handleCreateFolder = useCallback(() => {
    if (actionsDisabled) return
    setNameDialog({ mode: "create", item: null, value: "" })
  }, [actionsDisabled])

  const handleNameSubmit = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!nameDialog) return
    const name = nameDialog.value.trim()
    if (!name) return
    setSubmitting(true)
    try {
      if (nameDialog.mode === "create") {
        await requireSynapseBridge().account.createDriveFolder({ parentId, name })
        toast("文件夹已创建")
      } else {
        await requireSynapseBridge().account.renameDriveItem({ itemId: nameDialog.item.id, name })
        toast("已重命名")
      }
      setNameDialog(null)
      await loadItems()
    } catch (rawError) {
      toast(errorMessage(rawError, nameDialog.mode === "create" ? "创建失败" : "重命名失败"))
    } finally {
      setSubmitting(false)
    }
  }, [loadItems, nameDialog, parentId])

  const handleRename = useCallback(async (item: DriveItemDto) => {
    setNameDialog({ mode: "rename", item, value: item.name })
  }, [])

  const handleMove = useCallback(async (item: DriveItemDto) => {
    setMoveTarget(item)
    setMoveParentId("root")
  }, [])

  const handleMoveSubmit = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!moveTarget) return
    setSubmitting(true)
    try {
      await requireSynapseBridge().account.moveDriveItem({
        itemId: moveTarget.id,
        parentId: moveParentId === "root" ? null : moveParentId,
      })
      toast("已移动")
      setMoveTarget(null)
      await loadItems()
    } catch (rawError) {
      toast(errorMessage(rawError, "移动失败"))
    } finally {
      setSubmitting(false)
    }
  }, [loadItems, moveParentId, moveTarget])

  const handleDelete = useCallback(async (item: DriveItemDto) => {
    setDeleteTarget(item)
  }, [])

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return
    setSubmitting(true)
    try {
      await requireSynapseBridge().account.deleteDriveItem({
        itemId: deleteTarget.id,
      })
      toast("已删除")
      setDeleteTarget(null)
      await loadItems()
      await loadDriveUsage()
    } catch (rawError) {
      toast(errorMessage(rawError, "删除失败"))
    } finally {
      setSubmitting(false)
    }
  }, [deleteTarget, loadDriveUsage, loadItems])

  const handleShare = useCallback((item: DriveItemDto) => {
    setAccessSettingsTarget({ kind: "share", item })
  }, [])

  const handlePreview = useCallback(async (item: DriveItemDto) => {
    try {
      const { url } = await requireSynapseBridge().account.getDriveItemPreviewUrl({ itemId: item.id })
      await openDriveUrl(url)
    } catch {
      toast("打开失败")
    }
  }, [])

  const handleAccessSettingsConfirm = useCallback(async (settings: DriveAccessSettingsInput) => {
    const target = accessSettingsTarget
    if (!target) return
    let afterCreate: (() => Promise<void>) | null = null
    setSubmitting(true)
    try {
      const bridge = requireSynapseBridge()
      const share = await bridge.account.shareDriveItem({
        itemId: target.item.id,
        ...settings,
      })
      setAccessSettingsTarget(null)
      setShareSuccess({
        name: target.item.name,
        type: target.item.type,
        url: share.url,
        urlWithPassword: share.urlWithPassword,
        passwordEnabled: share.passwordEnabled,
        password: share.password,
        expiresAt: share.expiresAt,
      })
      afterCreate = async () => {
        await copySharedUrlAfterShare(getDriveAccessUrl(share))
        await reloadDriveItemsAfterAccessChange(loadItems)
      }
    } catch (rawError) {
      toast(errorMessage(rawError, "分享失败"))
    } finally {
      setSubmitting(false)
    }
    if (afterCreate) await afterCreate()
  }, [accessSettingsTarget, loadItems])

  const handleDisableShare = useCallback(async (item: DriveItemDto) => {
    if (!item.activeShareId) return
    try {
      await requireSynapseBridge().account.disableDriveShare({ shareId: item.activeShareId })
      toast("已取消分享")
      await loadItems()
    } catch (rawError) {
      toast(errorMessage(rawError, "取消分享失败"))
    }
  }, [loadItems])

  const content = (() => {
    if (!accountAuthenticated) {
      if (accountState.status === "authenticating") {
        return (
          <DriveStatusState
            icon={<LoaderCircle className="animate-spin" />}
            title="等待账号登录"
            description="在浏览器完成登录后会自动刷新。"
          />
        )
      }

      return (
        <DriveStatusState
          icon={<CircleUserRound />}
          title="需要登录账号"
          description="登录后才能查看云盘。"
          action={(
            <Button size="sm" disabled={pendingAction === "login"} onClick={() => { void startLogin() }}>
              <CircleUserRound data-icon="inline-start" />
              登录
            </Button>
          )}
        />
      )
    }

    if (error) {
      if (error.type === "auth") {
        return (
          <DriveStatusState
            icon={<CircleUserRound />}
            title="需要登录账号"
            description="登录后才能查看云盘。"
            action={(
              <Button size="sm" disabled={pendingAction === "login"} onClick={() => { void startLogin() }}>
                <CircleUserRound data-icon="inline-start" />
                登录
              </Button>
            )}
          />
        )
      }

      return (
        <DriveStatusState
          icon={<RefreshCw />}
          title="云盘加载失败"
          description={error.message}
          action={(
            <Button size="sm" variant="outline" onClick={() => { void loadItems() }}>
              <RefreshCw data-icon="inline-start" />
              重试
            </Button>
          )}
        />
      )
    }
    return (
      <DriveFileList
        items={items}
        loading={loading}
        openingFolderId={openingFolderId}
        path={path}
        onJumpToPath={jumpToPath}
        onOpenFolder={openFolder}
        onRename={handleRename}
        onMove={handleMove}
        onDelete={handleDelete}
        onOpenItem={handlePreview}
        onShare={handleShare}
        onDisableShare={handleDisableShare}
        onUploadDroppedFiles={handleDroppedFiles}
        actions={(
          <>
            <Button variant="outline" size="sm" disabled={uploadActionsDisabled} onClick={() => fileInputRef.current?.click()}>
              <Upload data-icon="inline-start" />
              上传文件
            </Button>
            <Button variant="outline" size="sm" disabled={uploadActionsDisabled} onClick={() => folderInputRef.current?.click()}>
              <Upload data-icon="inline-start" />
              上传文件夹
            </Button>
            <Button variant="outline" size="sm" disabled={actionsDisabled} onClick={handleCreateFolder}>
              <FolderPlus data-icon="inline-start" />
              新建文件夹
            </Button>
          </>
        )}
        uploadDisabled={uploadActionsDisabled}
        uploadItemCount={uploadItemCount}
        uploading={uploading}
      />
    )
  })()

  return (
    <TooltipProvider>
      <ModulePage
        title="云盘"
        titleAddon={accountAuthenticated ? <DriveUsageIndicator state={usageState} /> : undefined}
        actions={(
          <>
            <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileSelected} />
            <input ref={folderInputRef} type="file" multiple className="hidden" onChange={handleFolderSelected} {...{ webkitdirectory: "" }} />
            <Button variant="outline" size="sm" disabled={!accountAuthenticated || loading} onClick={() => setPublicLinksOpen(true)}>
              <Link2 data-icon="inline-start" />
              公开链接
            </Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-sm" disabled={!accountAuthenticated || loading || openingFolderId !== null} onClick={() => void refreshDriveView()}>
                  <RefreshCw />
                  <span className="sr-only">刷新</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>刷新</TooltipContent>
            </Tooltip>
          </>
        )}
        afterContent={(
          <>
            <Dialog open={nameDialog !== null} onOpenChange={(open) => {
              if (!open) setNameDialog(null)
            }}>
              {nameDialog ? (
                <FormDialog
                  title={nameDialog.mode === "create" ? "新建文件夹" : "重命名"}
                  onSubmit={handleNameSubmit}
                  footer={(
                    <>
                      <Button type="button" variant="outline" disabled={submitting} onClick={() => setNameDialog(null)}>取消</Button>
                      <Button type="submit" disabled={submitting || nameDialog.value.trim().length === 0}>
                        {nameDialog.mode === "create" ? "新建" : "保存"}
                      </Button>
                    </>
                  )}
                >
                  <div className="grid gap-2">
                    <Label htmlFor="drive-item-name">
                      {nameDialog.mode === "create" ? "文件夹名称" : "名称"}
                    </Label>
                    <Input
                      id="drive-item-name"
                      aria-label={nameDialog.mode === "create" ? "文件夹名称" : "名称"}
                      value={nameDialog.value}
                      onChange={(event) => {
                        const value = event.target.value
                        setNameDialog((current) => current ? { ...current, value } : current)
                      }}
                      autoFocus
                    />
                  </div>
                </FormDialog>
              ) : null}
            </Dialog>
            <Dialog open={moveTarget !== null} onOpenChange={(open) => {
              if (!open) setMoveTarget(null)
            }}>
              {moveTarget ? (
                <FormDialog
                  title="移动"
                  onSubmit={handleMoveSubmit}
                  footer={(
                    <>
                      <Button type="button" variant="outline" disabled={submitting} onClick={() => setMoveTarget(null)}>取消</Button>
                      <Button type="submit" disabled={submitting}>移动</Button>
                    </>
                  )}
                >
                  <div className="grid gap-2">
                    <Label>目标位置</Label>
                    <DriveMoveTargetTree
                      disabledFolderId={moveTarget.type === "folder" ? moveTarget.id : null}
                      selectedParentId={moveParentId}
                      onSelect={setMoveParentId}
                    />
                  </div>
                </FormDialog>
              ) : null}
            </Dialog>
            <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => {
              if (!open) {
                setDeleteTarget(null)
              }
            }}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>确认删除</AlertDialogTitle>
                  <AlertDialogDescription asChild>
                    <div>
                      <div>删除后无法在云盘中继续访问「{deleteTarget?.name}」。</div>
                    </div>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={submitting}>取消</AlertDialogCancel>
                  <AlertDialogAction variant="destructive" disabled={submitting} onClick={() => { void confirmDelete() }}>删除</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <DrivePublicLinksDialog
              open={publicLinksOpen}
              onOpenChange={setPublicLinksOpen}
              onDriveItemsChanged={loadItems}
            />
            <DriveAccessSettingsDialog
              target={accessSettingsTarget}
              submitting={submitting}
              onCancel={() => setAccessSettingsTarget(null)}
              onConfirm={handleAccessSettingsConfirm}
            />
            <DriveShareSuccessDialog
              share={shareSuccess}
              onOpenChange={(open) => {
                if (!open) setShareSuccess(null)
              }}
            />
          </>
        )}
      >
        {content}
      </ModulePage>
    </TooltipProvider>
  )
}

function DriveUsageIndicator({ state }: { readonly state: DriveUsageState }) {
  if (state.status === "idle") return null
  if (state.status === "loading" && !state.usage) {
    return (
      <div className="flex min-w-48 items-center gap-2" aria-label="云盘容量加载中">
        <Skeleton className="h-2 w-28 rounded-full" />
        <Skeleton className="h-3 w-24" />
      </div>
    )
  }
  if (state.status === "error") {
    return <span className="text-xs text-muted-foreground">用量加载失败</span>
  }
  if (!state.usage) return null

  const usage = getDriveUsageViewModel(state.usage)
  return (
    <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground" aria-busy={state.status === "loading" || undefined}>
      <Progress
        aria-label="云盘容量"
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={Math.round(usage.percent)}
        className="h-2 w-40 shrink-0"
        value={usage.percent}
      />
      <span className="shrink-0">{usage.occupiedLabel} / {usage.quotaLabel}</span>
    </div>
  )
}

function DriveMoveTargetTree({
  disabledFolderId,
  selectedParentId,
  onSelect,
}: {
  readonly disabledFolderId: string | null
  readonly selectedParentId: string
  readonly onSelect: (parentId: string) => void
}) {
  const [branches, setBranches] = useState<Record<string, DriveMoveTreeBranch>>({})
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(new Set())

  const loadFolders = useCallback(async (parentId: string | null, force = false) => {
    const key = driveMoveTreeKey(parentId)
    const existing = branches[key]
    if (!force && (existing?.loaded || existing?.loading)) return

    setBranches((current) => ({
      ...current,
      [key]: {
        error: null,
        folders: current[key]?.folders ?? [],
        loaded: false,
        loading: true,
      },
    }))

    try {
      const nextItems = await requireSynapseBridge().account.listDriveItems({ parentId })
      setBranches((current) => ({
        ...current,
        [key]: {
          error: null,
          folders: nextItems.filter((item) => item.type === "folder"),
          loaded: true,
          loading: false,
        },
      }))
    } catch (rawError) {
      setBranches((current) => ({
        ...current,
        [key]: {
          error: errorMessage(rawError, "加载失败"),
          folders: current[key]?.folders ?? [],
          loaded: false,
          loading: false,
        },
      }))
    }
  }, [branches])

  useEffect(() => {
    void loadFolders(null)
  }, [loadFolders])

  const toggleFolder = useCallback((folder: DriveItemDto) => {
    if (folder.id === disabledFolderId) return
    setExpandedIds((current) => {
      const next = new Set(current)
      const shouldOpen = !next.has(folder.id)
      if (shouldOpen) {
        next.add(folder.id)
        void loadFolders(folder.id)
      } else {
        next.delete(folder.id)
      }
      return next
    })
  }, [disabledFolderId, loadFolders])

  const rootBranch = branches[DRIVE_ROOT_PARENT_VALUE]

  return (
    <div className="rounded-lg border bg-background" role="tree" aria-label="目标位置">
      <DriveMoveTreeSelectButton
        label="根目录"
        selected={selectedParentId === DRIVE_ROOT_PARENT_VALUE}
        onSelect={() => onSelect(DRIVE_ROOT_PARENT_VALUE)}
      />
      <div className="border-t">
        <DriveMoveTreeChildren
          branch={rootBranch}
          branches={branches}
          disabledFolderId={disabledFolderId}
          expandedIds={expandedIds}
          loadFolders={loadFolders}
          onRetry={() => { void loadFolders(null, true) }}
          onSelect={onSelect}
          onToggle={toggleFolder}
          parentName="根目录"
          selectedParentId={selectedParentId}
        />
      </div>
    </div>
  )
}

function DriveStatusState({
  action,
  description,
  icon,
  title,
}: {
  readonly action?: ReactNode
  readonly description?: string
  readonly icon: ReactNode
  readonly title: string
}) {
  return (
    <Empty className="h-full border-0">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          {icon}
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        {description ? <EmptyDescription>{description}</EmptyDescription> : null}
      </EmptyHeader>
      {action ? <EmptyContent>{action}</EmptyContent> : null}
    </Empty>
  )
}

function DriveMoveTreeChildren({
  branch,
  branches,
  disabledFolderId,
  expandedIds,
  loadFolders,
  onRetry,
  onSelect,
  onToggle,
  parentName,
  selectedParentId,
}: {
  readonly branch: DriveMoveTreeBranch | undefined
  readonly branches: Record<string, DriveMoveTreeBranch>
  readonly disabledFolderId: string | null
  readonly expandedIds: ReadonlySet<string>
  readonly loadFolders: (parentId: string | null, force?: boolean) => Promise<void>
  readonly onRetry: () => void
  readonly onSelect: (parentId: string) => void
  readonly onToggle: (folder: DriveItemDto) => void
  readonly parentName: string
  readonly selectedParentId: string
}) {
  if (branch?.loading) {
    return (
      <div className="px-3 py-2 text-sm text-muted-foreground">
        加载中
      </div>
    )
  }

  if (branch?.error) {
    return (
      <div className="flex items-center justify-between gap-2 px-3 py-2 text-sm text-muted-foreground">
        <span>加载失败</span>
        <Button type="button" variant="ghost" size="xs" aria-label={`重试 ${parentName}`} onClick={onRetry}>
          重试
        </Button>
      </div>
    )
  }

  const folders = branch?.folders ?? []
  if (folders.length === 0) {
    return (
      <div className="px-3 py-2 text-sm text-muted-foreground">
        暂无文件夹
      </div>
    )
  }

  return (
    <div className="py-1">
      {folders.map((folder) => (
        <DriveMoveTreeFolder
          key={folder.id}
          branches={branches}
          disabledFolderId={disabledFolderId}
          expandedIds={expandedIds}
          folder={folder}
          loadFolders={loadFolders}
          onSelect={onSelect}
          onToggle={onToggle}
          selectedParentId={selectedParentId}
        />
      ))}
    </div>
  )
}

function DriveMoveTreeFolder({
  branches,
  disabledFolderId,
  expandedIds,
  folder,
  loadFolders,
  onSelect,
  onToggle,
  selectedParentId,
}: {
  readonly branches: Record<string, DriveMoveTreeBranch>
  readonly disabledFolderId: string | null
  readonly expandedIds: ReadonlySet<string>
  readonly folder: DriveItemDto
  readonly loadFolders: (parentId: string | null, force?: boolean) => Promise<void>
  readonly onSelect: (parentId: string) => void
  readonly onToggle: (folder: DriveItemDto) => void
  readonly selectedParentId: string
}) {
  const disabled = folder.id === disabledFolderId
  const expanded = expandedIds.has(folder.id)
  const childBranch = branches[folder.id]

  return (
    <div role="treeitem" aria-expanded={disabled ? undefined : expanded}>
      <div className="flex items-center gap-1 px-1">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`${expanded ? "收起" : "展开"} ${folder.name}`}
          disabled={disabled}
          onClick={() => onToggle(folder)}
        >
          <ChevronRight className={cn("size-4", expanded ? "rotate-90" : "")} aria-hidden="true" />
        </Button>
        <DriveMoveTreeSelectButton
          disabled={disabled}
          label={folder.name}
          selected={selectedParentId === folder.id}
          onSelect={() => onSelect(folder.id)}
        />
      </div>
      {expanded ? (
        <div className="ml-5 border-l pl-2">
          <DriveMoveTreeChildren
            branch={childBranch}
            branches={branches}
            disabledFolderId={disabledFolderId}
            expandedIds={expandedIds}
            loadFolders={loadFolders}
            onRetry={() => { void loadFolders(folder.id, true) }}
            onSelect={onSelect}
            onToggle={onToggle}
            parentName={folder.name}
            selectedParentId={selectedParentId}
          />
        </div>
      ) : null}
    </div>
  )
}

function DriveMoveTreeSelectButton({
  disabled = false,
  label,
  selected,
  onSelect,
}: {
  readonly disabled?: boolean
  readonly label: string
  readonly selected: boolean
  readonly onSelect: () => void
}) {
  return (
    <Button
      type="button"
      variant={selected ? "secondary" : "ghost"}
      size="sm"
      className="min-w-0 flex-1 justify-start"
      aria-label={`选择 ${label}`}
      aria-pressed={selected}
      disabled={disabled}
      onClick={onSelect}
    >
      <Folder data-icon="inline-start" />
      <span className="truncate">{label}</span>
    </Button>
  )
}

function DriveFileList({
  items,
  loading,
  openingFolderId,
  path,
  onJumpToPath,
  onOpenFolder,
  onRename,
  onMove,
  onDelete,
  onOpenItem,
  onShare,
  onDisableShare,
  onUploadDroppedFiles,
  actions,
  uploadDisabled,
  uploadItemCount,
  uploading,
}: {
  readonly items: readonly DriveItemDto[]
  readonly loading: boolean
  readonly openingFolderId: string | null
  readonly path: readonly DrivePathEntry[]
  readonly onJumpToPath: (index: number) => void
  readonly onOpenFolder: (item: DriveItemDto) => void
  readonly onRename: (item: DriveItemDto) => void
  readonly onMove: (item: DriveItemDto) => void
  readonly onDelete: (item: DriveItemDto) => void
  readonly onOpenItem: (item: DriveItemDto) => void
  readonly onShare: (item: DriveItemDto) => void
  readonly onDisableShare: (item: DriveItemDto) => void
  readonly onUploadDroppedFiles: (dataTransfer: DataTransfer) => Promise<void>
  readonly actions?: ReactNode
  readonly uploadDisabled: boolean
  readonly uploadItemCount: number | null
  readonly uploading: boolean
}) {
  const [dragDepth, setDragDepth] = useState(0)
  const currentFolderName = path.at(-1)?.name ?? "根目录"
  const dragActive = dragDepth > 0 && !uploadDisabled

  const handleDragEnter = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!hasExternalDraggedFiles(event.dataTransfer)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = uploadDisabled ? "none" : "copy"
    setDragDepth((current) => current + 1)
  }, [uploadDisabled])

  const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!hasExternalDraggedFiles(event.dataTransfer)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = uploadDisabled ? "none" : "copy"
  }, [uploadDisabled])

  const handleDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!hasExternalDraggedFiles(event.dataTransfer)) return
    event.preventDefault()
    setDragDepth((current) => Math.max(0, current - 1))
  }, [])

  const handleDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!hasExternalDraggedFiles(event.dataTransfer)) return
    event.preventDefault()
    setDragDepth(0)
    if (uploadDisabled) return
    void onUploadDroppedFiles(event.dataTransfer)
  }, [onUploadDroppedFiles, uploadDisabled])

  return (
    <div
      className="relative flex min-h-full flex-col gap-3"
      data-testid="drive-file-list-dropzone"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <DriveBreadcrumbs path={path} onJumpToPath={onJumpToPath} />
        <div className="flex flex-wrap items-center justify-end gap-2">
          {uploading ? <Badge variant="outline">{uploadItemCount === null ? "上传中" : `正在上传 ${uploadItemCount} 项`}</Badge> : null}
          {actions ? <div className="flex flex-wrap items-center justify-end gap-1">{actions}</div> : null}
        </div>
      </div>

      {loading ? (
        <ModuleContentPanel>
          <DriveFileTableSkeleton />
        </ModuleContentPanel>
      ) : items.length === 0 ? (
        <Empty className="min-h-64 border">
          <EmptyHeader>
            <EmptyTitle>暂无文件</EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : (
        <ModuleContentPanel>
          <Table className="table-fixed">
            <DriveFileTableHeader />
            <TableBody>
              {items.map((item) => (
                <DriveFileListRow
                  key={item.id}
                  item={item}
                  opening={openingFolderId === item.id}
                  onOpenFolder={onOpenFolder}
                  onRename={onRename}
                  onMove={onMove}
                  onDelete={onDelete}
                  onOpenItem={onOpenItem}
                  onShare={onShare}
                  onDisableShare={onDisableShare}
                />
              ))}
            </TableBody>
          </Table>
        </ModuleContentPanel>
      )}
      {dragActive ? (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg border border-dashed bg-background/80">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Upload className="size-4" aria-hidden="true" />
            <span>松开上传到 {currentFolderName}</span>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function DriveFileTableHeader() {
  return (
    <TableHeader>
      <TableRow className="hover:bg-transparent">
        <TableHead>名称</TableHead>
        <TableHead className="w-32">状态</TableHead>
        <TableHead className="w-24 text-right">大小</TableHead>
        <TableHead className="w-40 text-right">更新时间</TableHead>
        <TableHead className="w-40 text-right">操作</TableHead>
      </TableRow>
    </TableHeader>
  )
}

function DriveFileTableSkeleton() {
  return (
    <Table className="table-fixed">
      <DriveFileTableHeader />
      <TableBody>
        {DRIVE_SKELETON_ROWS.map((row) => (
          <TableRow key={row}>
            <TableCell>
              <div className="flex min-w-0 items-center gap-2">
                <Skeleton className="size-4 shrink-0" />
                <Skeleton className="h-4 w-48" />
              </div>
            </TableCell>
            <TableCell>
              <div className="flex items-center gap-1">
                <Skeleton className="h-5 w-14" />
                <Skeleton className="h-5 w-14" />
              </div>
            </TableCell>
            <TableCell>
              <Skeleton className="ml-auto h-4 w-16" />
            </TableCell>
            <TableCell>
              <Skeleton className="ml-auto h-4 w-32" />
            </TableCell>
            <TableCell>
              <Skeleton className="ml-auto h-7 w-28" />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function DriveBreadcrumbs({
  path,
  onJumpToPath,
}: {
  readonly path: readonly DrivePathEntry[]
  readonly onJumpToPath: (index: number) => void
}) {
  return (
    <nav
      className="h-7 min-w-0 max-w-full overflow-x-auto rounded-md border bg-background px-1"
      aria-label="当前位置"
    >
      <ol className="flex h-full min-w-max items-center gap-0.5 text-sm text-muted-foreground">
        {path.map((entry, index) => {
          const isCurrent = index === path.length - 1
          return (
            <li key={`${entry.id ?? "root"}-${index}`} className="flex items-center gap-0.5">
              {index > 0 ? <ChevronRight className="size-3.5 shrink-0" aria-hidden="true" /> : null}
              {isCurrent ? (
                <span
                  className="flex h-5 max-w-40 items-center truncate rounded-sm px-1.5 font-medium text-foreground"
                  aria-current="page"
                >
                  {entry.name}
                </span>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="h-5 max-w-40 rounded-sm px-1.5 text-sm"
                  onClick={() => onJumpToPath(index)}
                >
                  <span className="truncate">{entry.name}</span>
                </Button>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

function DriveFileListRow({
  item,
  opening,
  onOpenFolder,
  onRename,
  onMove,
  onDelete,
  onOpenItem,
  onShare,
  onDisableShare,
}: {
  readonly item: DriveItemDto
  readonly opening: boolean
  readonly onOpenFolder: (item: DriveItemDto) => void
  readonly onRename: (item: DriveItemDto) => void
  readonly onMove: (item: DriveItemDto) => void
  readonly onDelete: (item: DriveItemDto) => void
  readonly onOpenItem: (item: DriveItemDto) => void
  readonly onShare: (item: DriveItemDto) => void
  readonly onDisableShare: (item: DriveItemDto) => void
}) {
  const isFolder = item.type === "folder"
  const statusBadges = getDriveStatusBadges(item)
  const canShare = canShareDriveItem(item)

  return (
    <TableRow
      className={cn(isFolder && !opening ? "cursor-pointer" : undefined)}
      aria-busy={opening || undefined}
      onClick={isFolder && !opening ? () => onOpenFolder(item) : undefined}
    >
      <TableCell className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          {opening ? (
            <LoaderCircle className="size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />
          ) : isFolder ? (
            <Folder className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          ) : (
            <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          )}
          {isFolder ? (
            <Button
              type="button"
              variant="ghost"
              className="h-auto min-w-0 max-w-full justify-start px-0 py-0 font-medium hover:bg-transparent"
              aria-label={opening ? `正在打开文件夹 ${item.name}` : `打开文件夹 ${item.name}`}
              disabled={opening}
              title={item.name}
              onClick={(event) => {
                event.stopPropagation()
                if (opening) return
                onOpenFolder(item)
              }}
            >
              <span className="min-w-0 truncate whitespace-nowrap">{item.name}</span>
            </Button>
          ) : (
            <span className="block min-w-0 truncate whitespace-nowrap font-medium" title={item.name}>
              <span className="sr-only">文件 </span>
              {item.name}
            </span>
          )}
        </div>
      </TableCell>
      <TableCell>
        {statusBadges.length > 0 ? (
          <div className="flex items-center gap-1">
            {statusBadges.map((badge) => (
              <Badge key={badge.key} variant={badge.variant}>
                {badge.label}
              </Badge>
            ))}
          </div>
        ) : null}
      </TableCell>
      <TableCell className="text-right tabular-nums text-muted-foreground">
        {isFolder ? "-" : formatBytes(item.size)}
      </TableCell>
      <TableCell className="truncate text-right tabular-nums text-muted-foreground">
        {formatDriveDateTime(item.updatedAt)}
      </TableCell>
      <TableCell className="text-right">
        <div
          className="flex items-center justify-end gap-1"
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <Button type="button" variant="ghost" size="xs" onClick={() => onOpenItem(item)}>
            打开
          </Button>
          <Button type="button" variant="ghost" size="xs" disabled={!canShare} onClick={() => onShare(item)}>
            分享
          </Button>
          <DriveItemMenu
            item={item}
            onRename={onRename}
            onMove={onMove}
            onDelete={onDelete}
            onDisableShare={onDisableShare}
          />
        </div>
      </TableCell>
    </TableRow>
  )
}

function DriveItemMenu({
  item,
  onRename,
  onMove,
  onDelete,
  onDisableShare,
}: {
  readonly item: DriveItemDto
  readonly onRename: (item: DriveItemDto) => void
  readonly onMove: (item: DriveItemDto) => void
  readonly onDelete: (item: DriveItemDto) => void
  readonly onDisableShare: (item: DriveItemDto) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`更多 ${item.name}`}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {item.activeShareId ? (
          <>
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={() => onDisableShare(item)}>取消分享</DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={() => onRename(item)}>重命名</DropdownMenuItem>
          <DropdownMenuItem onClick={() => onMove(item)}>移动</DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={() => onDelete(item)}>删除</DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

type DriveLocalUploadBuildResult = {
  readonly request: DriveLocalUploadRequest
  readonly skipped: number
}

function DriveAccessSettingsDialog({
  target,
  submitting,
  onCancel,
  onConfirm,
}: {
  readonly target: DriveAccessSettingsTarget | null
  readonly submitting: boolean
  readonly onCancel: () => void
  readonly onConfirm: (settings: DriveAccessSettingsInput) => Promise<void>
}) {
  const [settings, setSettings] = useState<DriveAccessSettingsInput>(DRIVE_DEFAULT_ACCESS_SETTINGS)

  useEffect(() => {
    if (target) setSettings(DRIVE_DEFAULT_ACCESS_SETTINGS)
  }, [target])

  const title = "分享设置"

  return (
    <Dialog open={target !== null} onOpenChange={(open) => {
      if (!open && !submitting) onCancel()
    }}>
      {target ? (
        <FormDialog
          title={title}
          contentClassName="sm:max-w-md"
          onSubmit={(event) => {
            event.preventDefault()
            void onConfirm(settings)
          }}
          footer={(
            <>
              <Button type="button" variant="outline" disabled={submitting} onClick={onCancel}>取消</Button>
              <Button type="submit" disabled={submitting}>确定</Button>
            </>
          )}
        >
          <div className="grid gap-5">
            <label className="flex min-h-8 items-center justify-between gap-4" htmlFor="drive-access-password-enabled">
              <span className="text-sm font-medium leading-none">需要密码</span>
              <Switch
                id="drive-access-password-enabled"
                aria-label="需要密码"
                checked={settings.passwordEnabled}
                onCheckedChange={(checked) => setSettings((current) => ({ ...current, passwordEnabled: checked }))}
              />
            </label>
            <div className="grid gap-2.5">
              <Label>有效时长</Label>
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                className="w-full"
                value={settings.expiresIn}
                onValueChange={(value) => {
                  if (!value) return
                  setSettings((current) => ({
                    ...current,
                    expiresIn: value as DriveAccessExpiresInOption,
                  }))
                }}
              >
                {DRIVE_ACCESS_EXPIRES_OPTIONS.map((option) => (
                  <ToggleGroupItem
                    key={option.value}
                    className="h-8 flex-1"
                    type="button"
                    value={option.value}
                  >
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

type DrivePublicLinksPageState<TItem> = {
  readonly items: TItem[]
  readonly page: DriveBrowserChildrenPageDto | null
  readonly loading: boolean
  readonly loadingMore: boolean
  readonly error: string | null
  readonly loaded: boolean
}

function createEmptyDrivePublicLinksPageState<TItem>(): DrivePublicLinksPageState<TItem> {
  return {
    items: [],
    page: null,
    loading: false,
    loadingMore: false,
    error: null,
    loaded: false,
  }
}

function DrivePublicLinksDialog({
  open,
  onOpenChange,
  onDriveItemsChanged,
}: {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onDriveItemsChanged: () => Promise<void>
}) {
  const [shareState, setShareState] = useState<DrivePublicLinksPageState<DriveShareListItemDto>>(() => createEmptyDrivePublicLinksPageState())

  const loadShares = useCallback(async (input: { readonly offset?: number; readonly append?: boolean } = {}) => {
    const append = input.append ?? false
    setShareState((current) => ({ ...current, loading: !append, loadingMore: append, error: null }))
    try {
      const result = await requireSynapseBridge().account.listDriveShares({
        offset: input.offset ?? 0,
        limit: DRIVE_PUBLIC_LINKS_PAGE_SIZE,
      })
      setShareState((current) => ({
        items: append ? [...current.items, ...result.items] : [...result.items],
        page: result.page,
        loading: false,
        loadingMore: false,
        error: null,
        loaded: true,
      }))
    } catch (rawError) {
      const message = errorMessage(rawError, "公开链接加载失败")
      setShareState((current) => ({
        ...current,
        loading: false,
        loadingMore: false,
        error: message,
        loaded: true,
      }))
      toast(message)
    }
  }, [])

  useEffect(() => {
    if (open) {
      setShareState(createEmptyDrivePublicLinksPageState<DriveShareListItemDto>())
      void loadShares()
    }
  }, [loadShares, open])

  const reloadAfterPublicLinkChange = useCallback(async () => {
    await loadShares()
    await onDriveItemsChanged()
  }, [loadShares, onDriveItemsChanged])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="max-h-[calc(100vh-2rem)] overflow-hidden p-0 sm:max-w-4xl"
      >
        <form
          className="flex h-full min-h-0 max-h-[calc(100vh-2rem)] flex-col overflow-hidden"
          onSubmit={(event) => event.preventDefault()}
        >
          <DialogHeader
            className="px-5 pt-5"
            data-testid="drive-public-links-dialog-header"
          >
            <DialogTitle className="pr-10 sm:pr-0">公开链接</DialogTitle>
          </DialogHeader>
          <ScrollArea className="min-h-0 flex-1">
            <div className="px-5 py-4">
              <DrivePublicLinkList
                emptyTitle="暂无分享"
                error={shareState.error}
                loading={shareState.loading}
                loadingMore={shareState.loadingMore}
                page={shareState.page}
                shares={shareState.items}
                onLoadMore={async () => {
                  if (shareState.page?.nextOffset === null || shareState.page?.nextOffset === undefined) return
                  await loadShares({ offset: shareState.page.nextOffset, append: true })
                }}
                onRetry={loadShares}
                onReload={reloadAfterPublicLinkChange}
              />
            </div>
          </ScrollArea>
          <DialogFooter className="mx-0 mb-0 shrink-0 flex-col gap-2 rounded-none rounded-b-xl px-5 py-4 sm:flex-row sm:items-center sm:justify-end">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>关闭</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function DrivePublicLinkList({
  emptyTitle,
  error,
  loading,
  loadingMore,
  page,
  shares,
  onLoadMore,
  onRetry,
  onReload,
}: {
  readonly emptyTitle: string
  readonly error: string | null
  readonly loading: boolean
  readonly loadingMore: boolean
  readonly page: DriveBrowserChildrenPageDto | null
  readonly shares: readonly DriveShareListItemDto[]
  readonly onLoadMore: () => Promise<void>
  readonly onRetry: () => Promise<void>
  readonly onReload: () => Promise<void>
}) {
  if (loading) return <DrivePublicLinkTableSkeleton />
  if (error) return <DriveDialogErrorState message={error} onRetry={onRetry} />
  if (shares.length === 0) return <DriveDialogEmptyState title={emptyTitle} />

  return (
    <div className="grid gap-3">
      <DriveShareList error={null} items={shares} loading={false} onReload={onReload} />
      {page?.hasMore ? (
        <div className="flex justify-center pt-1">
          <Button type="button" size="sm" variant="outline" disabled={loadingMore} onClick={() => { void onLoadMore() }}>
            {loadingMore ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : null}
            加载更多
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function DrivePublicLinkTableHeader() {
  return (
    <TableHeader>
      <TableRow className="hover:bg-transparent">
        <TableHead className="w-72">名称</TableHead>
        <TableHead>链接信息</TableHead>
        <TableHead className="w-36 text-right">操作</TableHead>
      </TableRow>
    </TableHeader>
  )
}

function DriveShareActions({
  item,
  onReload,
}: {
  readonly item: DriveShareListItemDto
  readonly onReload: () => Promise<void>
}) {
  const password = item.password
  return (
    <div className="flex items-center justify-end gap-0.5">
      {!item.sourceDeleted ? (
        <DriveIconAction
          label={`复制 ${item.itemName}`}
          tooltip="复制链接"
          onClick={() => { void copyDriveUrl(getDriveAccessUrl(item)) }}
        >
          <Copy />
        </DriveIconAction>
      ) : null}
      {!item.sourceDeleted && password ? (
        <DriveIconAction
          label={`复制 ${item.itemName} 密码`}
          tooltip="复制密码"
          onClick={() => { void copyDrivePassword(password) }}
        >
          <KeyRound />
        </DriveIconAction>
      ) : null}
      {!item.sourceDeleted ? (
        <DriveIconAction
          label={`打开 ${item.itemName}`}
          tooltip="打开"
          onClick={() => { void openDriveUrl(getDriveAccessUrl(item)) }}
        >
          <ExternalLink />
        </DriveIconAction>
      ) : null}
      <DriveIconAction
        label={`取消分享 ${item.itemName}`}
        tooltip="取消分享"
        onClick={() => { void disableDriveShare(item.id, onReload) }}
      >
        <X />
      </DriveIconAction>
    </div>
  )
}

function DriveIconAction({
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
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  )
}

function DriveSourceBadge({ sourceDeleted }: { readonly sourceDeleted: boolean }) {
  return (
    <Badge variant={sourceDeleted ? "outline" : "secondary"}>
      {sourceDeleted ? "来源已删除" : "来源正常"}
    </Badge>
  )
}

function DriveDialogErrorState({
  message,
  onRetry,
}: {
  readonly message: string
  readonly onRetry: () => Promise<void>
}) {
  return (
    <Empty className="min-h-48 border">
      <EmptyHeader>
        <EmptyTitle>读取失败</EmptyTitle>
        <EmptyDescription>{message}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button type="button" size="sm" variant="outline" onClick={() => { void onRetry() }}>
          <RefreshCw data-icon="inline-start" />
          重试
        </Button>
      </EmptyContent>
    </Empty>
  )
}

function DriveDialogEmptyState({ title }: { readonly title: string }) {
  return (
    <Empty className="min-h-48 border">
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
      </EmptyHeader>
    </Empty>
  )
}

function DriveShareTableSkeleton() {
  return <DrivePublicLinkTableSkeleton />
}

function DrivePublicLinkTableSkeleton() {
  return (
    <Table className="table-fixed" containerClassName="overflow-x-hidden">
      <DrivePublicLinkTableHeader />
      <TableBody>
        {DRIVE_SKELETON_ROWS.slice(0, 4).map((row) => (
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
            <TableCell className="align-top"><Skeleton className="ml-auto h-7 w-28 max-w-full" /></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function DriveShareSuccessDialog({
  share,
  onOpenChange,
}: {
  readonly share: DriveShareSuccessState | null
  readonly onOpenChange: (open: boolean) => void
}) {
  if (!share) return null

  const isFolder = share.type === "folder"
  const accessUrl = getDriveAccessUrl(share)
  const password = share.password
  return (
    <Dialog open={true} onOpenChange={onOpenChange}>
      <FormDialog
        title={isFolder ? "文件夹已分享" : "文件已分享"}
        description={<span className="block truncate">{share.name}</span>}
        contentClassName="sm:max-w-xl"
        onSubmit={(event) => event.preventDefault()}
        footer={(
          <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>关闭</Button>
            {password ? (
              <Button type="button" variant="outline" onClick={() => { void copyDrivePassword(password) }}>
                <KeyRound data-icon="inline-start" />
                复制密码
              </Button>
            ) : null}
            <Button type="button" variant="outline" onClick={() => { void copyDriveUrl(accessUrl) }}>
              <Copy data-icon="inline-start" />
              复制链接
            </Button>
            <Button type="button" onClick={() => { void openDriveUrl(accessUrl) }}>
              <ExternalLink data-icon="inline-start" />
              {isFolder ? "打开文件夹" : "打开文件"}
            </Button>
          </div>
        )}
      >
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="drive-share-success-url">访问链接</Label>
            <Input id="drive-share-success-url" className="font-mono text-sm" value={accessUrl} readOnly />
          </div>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="font-medium">密码</dt>
              <dd className="truncate text-muted-foreground" title={formatDriveAccessPassword(share)}>
                {formatDriveAccessPassword(share)}
              </dd>
            </div>
            <div>
              <dt className="font-medium">到期</dt>
              <dd className="truncate text-muted-foreground tabular-nums" title={formatDriveAccessExpiresAt(share.expiresAt)}>
                {formatDriveAccessExpiresAt(share.expiresAt)}
              </dd>
            </div>
          </dl>
        </div>
      </FormDialog>
    </Dialog>
  )
}

function DriveShareList({
  error,
  items,
  loading,
  onReload,
}: {
  readonly error: string | null
  readonly items: readonly DriveShareListItemDto[]
  readonly loading: boolean
  readonly onReload: () => Promise<void>
}) {
  if (loading) return <DriveShareTableSkeleton />
  if (error) return <DriveDialogErrorState message={error} onRetry={onReload} />
  if (items.length === 0) return <DriveDialogEmptyState title="暂无分享" />

  return (
    <Table className="table-fixed" containerClassName="overflow-x-hidden">
      <DrivePublicLinkTableHeader />
      <TableBody>
        {items.map((item) => (
          <TableRow key={item.id}>
            <TableCell className="min-w-0 whitespace-normal align-top">
              <div className="grid gap-1">
                <div className="truncate font-medium" title={item.itemName}>{item.itemName}</div>
                <div className="truncate text-xs text-muted-foreground" title={formatDriveAccessPassword(item)}>
                  密码 {formatDriveAccessPassword(item)}
                </div>
              </div>
            </TableCell>
            <TableCell className="min-w-0 whitespace-normal align-top">
              <div className="grid gap-1.5">
                <div className="flex min-w-0 flex-wrap items-center gap-1">
                  <Badge variant="outline">{item.itemType === "folder" ? "文件夹" : "文件"}</Badge>
                  <DriveSourceBadge sourceDeleted={item.sourceDeleted} />
                </div>
                <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs tabular-nums text-muted-foreground">
                  <span className="truncate" title={formatDriveAccessExpiresAt(item.expiresAt)}>
                    到期 {formatDriveAccessExpiresAt(item.expiresAt)}
                  </span>
                  <span className="truncate" title={formatDriveDateTime(item.createdAt)}>
                    时间 {formatDriveDateTime(item.createdAt)}
                  </span>
                </div>
              </div>
            </TableCell>
            <TableCell className="align-top">
              <DriveShareActions item={item} onReload={onReload} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

type UploadResult = {
  readonly completed: number
  readonly failed: number
  readonly error?: string
}

type DriveLocalUploadFilesMode = "files" | "folders"

type DriveFileSystemEntry = {
  readonly fullPath?: string
  readonly isDirectory: boolean
  readonly isFile: boolean
  readonly name: string
}

type DriveFileSystemFileEntry = DriveFileSystemEntry & {
  readonly isFile: true
  readonly file: (success: (file: File) => void, failure?: (error: DOMException) => void) => void
}

type DriveFileSystemDirectoryEntry = DriveFileSystemEntry & {
  readonly isDirectory: true
  readonly createReader: () => {
    readonly readEntries: (success: (entries: DriveFileSystemEntry[]) => void, failure?: (error: DOMException) => void) => void
  }
}

type DriveDirectoryFile = {
  readonly file: File
  readonly relativePath: string
}

async function buildDriveLocalUploadRequestFromFiles({
  files,
  mode,
  parentId,
}: {
  readonly files: readonly File[]
  readonly mode: DriveLocalUploadFilesMode
  readonly parentId: string | null
}): Promise<DriveLocalUploadBuildResult> {
  assertDriveLocalUploadFileCapacity(files.length)
  const items = mode === "folders"
    ? await buildDriveLocalFolderItemsFromFiles(files)
    : buildDriveLocalFileItems(files)
  return {
    request: { parentId, items: items.items },
    skipped: items.skipped,
  }
}

async function buildDriveLocalUploadRequestFromDrop({
  dataTransfer,
  parentId,
}: {
  readonly dataTransfer: DataTransfer
  readonly parentId: string | null
}): Promise<DriveLocalUploadBuildResult> {
  const entries = Array.from(dataTransfer.items ?? [])
    .map(webkitEntryFromDataTransferItem)
    .filter((entry): entry is DriveFileSystemEntry => entry !== null)

  if (entries.length === 0) {
    const files = Array.from(dataTransfer.files ?? [])
    return buildDriveLocalUploadRequestFromFiles({
      files,
      mode: files.some((file) => readRelativeFilePath(file).includes("/")) ? "folders" : "files",
      parentId,
    })
  }

  const items: DriveLocalUploadItem[] = []
  let skipped = 0
  let selectedFileCount = 0
  for (const entry of entries) {
    if (isDriveFileEntry(entry)) {
      selectedFileCount = nextDriveLocalUploadFileCount(selectedFileCount, 1)
      const file = await fileFromEntry(entry)
      const item = driveLocalFileItemFromFile(file)
      if (item) {
        items.push(item)
      } else {
        skipped += 1
      }
      continue
    }
    if (isDriveDirectoryEntry(entry)) {
      const folder = await driveLocalFolderItemFromDirectoryEntry(entry, DRIVE_LOCAL_UPLOAD_MAX_FILES - selectedFileCount)
      if (folder.item) {
        items.push(folder.item)
        selectedFileCount = nextDriveLocalUploadFileCount(selectedFileCount, countDriveLocalUploadItems([folder.item]))
      }
      skipped += folder.skipped
    }
  }

  return { request: { parentId, items }, skipped }
}

function buildDriveLocalFileItems(files: readonly File[]): { readonly items: DriveLocalUploadItem[]; readonly skipped: number } {
  const items: DriveLocalUploadItem[] = []
  let skipped = 0
  for (const file of files) {
    const item = driveLocalFileItemFromFile(file)
    if (item) {
      items.push(item)
    } else {
      skipped += 1
    }
  }
  return { items, skipped }
}

async function buildDriveLocalFolderItemsFromFiles(files: readonly File[]): Promise<{ readonly items: DriveLocalUploadItem[]; readonly skipped: number }> {
  assertDriveLocalUploadFileCapacity(files.length)
  const folders = new Map<string, DriveLocalUploadFolderItem["files"]>()
  let skipped = 0

  for (const file of files) {
    const path = requireSynapseBridge().account.filePathForDroppedFile(file)
    const relativePath = normalizeSlashRelativePath(readRelativeFilePath(file))
    if (!path || !relativePath) {
      skipped += 1
      continue
    }

    assertDriveLocalUploadRelativePathDepth(relativePath)
    const [folderName, ...rest] = relativePath.split("/")
    if (!folderName) {
      skipped += 1
      continue
    }
    const fileRelativePath = rest.join("/") || file.name
    const folderFiles = folders.get(folderName) ?? []
    folderFiles.push({
      path,
      relativePath: fileRelativePath,
      mimeType: file.type || null,
    })
    folders.set(folderName, folderFiles)
  }

  return {
    items: Array.from(folders.entries()).map(([folderName, folderFiles]) => ({
      kind: "folder",
      folderName,
      files: folderFiles,
    })),
    skipped,
  }
}

function driveLocalFileItemFromFile(file: File): DriveLocalUploadItem | null {
  const path = requireSynapseBridge().account.filePathForDroppedFile(file)
  if (!path) return null
  return {
    kind: "file",
    path,
    name: file.name,
    mimeType: file.type || null,
  }
}

async function driveLocalFolderItemFromDirectoryEntry(entry: DriveFileSystemDirectoryEntry, maxFiles: number): Promise<{ readonly item: DriveLocalUploadItem | null; readonly skipped: number }> {
  const files = await filesFromDirectoryEntry(entry, maxFiles)
  const uploadFiles: DriveLocalUploadFolderItem["files"] = []
  let skipped = 0

  for (const file of files) {
    const path = requireSynapseBridge().account.filePathForDroppedFile(file.file)
    const relativePath = normalizeSlashRelativePath(file.relativePath)
    if (!path || !relativePath) {
      skipped += 1
      continue
    }
    uploadFiles.push({
      path,
      relativePath,
      mimeType: file.file.type || null,
    })
  }

  if (uploadFiles.length === 0) return { item: null, skipped }
  return {
    item: {
      kind: "folder",
      folderName: entry.name,
      files: uploadFiles,
    },
    skipped,
  }
}

async function filesFromDirectoryEntry(entry: DriveFileSystemDirectoryEntry, maxFiles = DRIVE_LOCAL_UPLOAD_MAX_FILES): Promise<DriveDirectoryFile[]> {
  const files: DriveDirectoryFile[] = []
  await collectFilesFromDirectoryEntry({
    entry,
    files,
    maxFiles,
    prefix: "",
    depth: 0,
  })
  return files
}

async function collectFilesFromDirectoryEntry({
  entry,
  files,
  maxFiles,
  prefix,
  depth,
}: {
  readonly entry: DriveFileSystemDirectoryEntry
  readonly files: DriveDirectoryFile[]
  readonly maxFiles: number
  readonly prefix: string
  readonly depth: number
}): Promise<void> {
  if (depth > DRIVE_LOCAL_UPLOAD_MAX_FOLDER_DEPTH) {
    throw createDriveLocalUploadTooDeepError()
  }
  const reader = entry.createReader()

  for (;;) {
    const entries = await readDirectoryEntries(reader)
    if (entries.length === 0) break
    for (const child of entries) {
      if (isDriveFileEntry(child)) {
        if (files.length >= maxFiles) {
          throw createDriveLocalUploadTooManyFilesError()
        }
        files.push({ file: await fileFromEntry(child), relativePath: `${prefix}${child.name}` })
        continue
      }
      if (isDriveDirectoryEntry(child)) {
        await collectFilesFromDirectoryEntry({
          entry: child,
          files,
          maxFiles,
          prefix: `${prefix}${child.name}/`,
          depth: depth + 1,
        })
      }
    }
  }
}

function readDirectoryEntries(reader: ReturnType<DriveFileSystemDirectoryEntry["createReader"]>): Promise<DriveFileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    reader.readEntries(resolve, reject)
  })
}

function fileFromEntry(entry: DriveFileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => {
    entry.file(resolve, reject)
  })
}

function isDriveFileEntry(entry: DriveFileSystemEntry): entry is DriveFileSystemFileEntry {
  return entry.isFile
}

function isDriveDirectoryEntry(entry: DriveFileSystemEntry): entry is DriveFileSystemDirectoryEntry {
  return entry.isDirectory
}

function webkitEntryFromDataTransferItem(item: DataTransferItem): DriveFileSystemEntry | null {
  const candidate = item as { readonly webkitGetAsEntry?: () => unknown }
  const entry = candidate.webkitGetAsEntry?.()
  return isDriveFileSystemEntry(entry) ? entry : null
}

function isDriveFileSystemEntry(entry: unknown): entry is DriveFileSystemEntry {
  if (!entry || typeof entry !== "object") return false
  const candidate = entry as Partial<DriveFileSystemEntry>
  return typeof candidate.name === "string"
    && typeof candidate.isFile === "boolean"
    && typeof candidate.isDirectory === "boolean"
}

function hasExternalDraggedFiles(dataTransfer: DataTransfer | null | undefined): boolean {
  return Array.from(dataTransfer?.types ?? []).includes("Files") || (dataTransfer?.files.length ?? 0) > 0
}

function normalizeSlashRelativePath(value: string): string | null {
  if (!value || value.includes("\\")) return null
  const parts = value.split("/").filter(Boolean)
  if (parts.length === 0) return null
  if (parts.some((part) => part === "." || part === "..")) return null
  return parts.join("/")
}

function assertDriveLocalUploadFileCapacity(fileCount: number): void {
  if (fileCount > DRIVE_LOCAL_UPLOAD_MAX_FILES) {
    throw createDriveLocalUploadTooManyFilesError()
  }
}

function nextDriveLocalUploadFileCount(current: number, added: number): number {
  const next = current + added
  assertDriveLocalUploadFileCapacity(next)
  return next
}

function assertDriveLocalUploadRelativePathDepth(relativePath: string): void {
  const folderDepth = Math.max(0, relativePath.split("/").length - 2)
  if (folderDepth > DRIVE_LOCAL_UPLOAD_MAX_FOLDER_DEPTH) {
    throw createDriveLocalUploadTooDeepError()
  }
}

async function copyDriveUrl(url: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(url)
    toast("链接已复制")
  } catch (rawError) {
    toast(errorMessage(rawError, "复制失败"))
  }
}

async function copyDrivePassword(password: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(password)
    toast("密码已复制")
  } catch (rawError) {
    toast(errorMessage(rawError, "复制失败"))
  }
}

async function copySharedUrlAfterShare(url: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(url)
    toast("链接已复制")
  } catch (_rawError) {
    toast("分享成功，复制失败")
  }
}

async function reloadDriveItemsAfterAccessChange(loadItems: () => Promise<void>): Promise<void> {
  try {
    await loadItems()
  } catch (rawError) {
    toast(errorMessage(rawError, "刷新失败"))
  }
}

function getDriveAccessUrl(item: { readonly url: string; readonly urlWithPassword?: string | null }): string {
  return item.urlWithPassword || item.url
}

async function openDriveUrl(url: string): Promise<void> {
  try {
    await requireSynapseBridge().shell.openExternal(url)
  } catch (rawError) {
    toast(errorMessage(rawError, "打开失败"))
  }
}

async function disableDriveShare(shareId: string, onReload: () => Promise<void>): Promise<void> {
  try {
    await requireSynapseBridge().account.disableDriveShare({ shareId })
    toast("已取消分享")
    await onReload()
  } catch (rawError) {
    toast(errorMessage(rawError, "取消分享失败"))
  }
}

function readRelativeFilePath(file: File): string {
  const withDirectory = file as File & { webkitRelativePath?: string }
  return withDirectory.webkitRelativePath || file.name
}

function isHtmlDriveItem(item: DriveItemDto): boolean {
  const name = item.name.toLowerCase()
  return item.type === "file" && (name.endsWith(".html") || name.endsWith(".htm") || item.mimeType === "text/html")
}

function formatBytes(value: string): string {
  const bytes = Number(value)
  if (!Number.isFinite(bytes) || bytes < 0) return "-"

  let nextValue = bytes
  let unitIndex = 0
  while (nextValue >= 1024 && unitIndex < DRIVE_BYTE_UNITS.length - 1) {
    nextValue /= 1024
    unitIndex += 1
  }

  const formattedValue = unitIndex === 0 ? String(Math.round(nextValue)) : DRIVE_BYTE_NUMBER_FORMAT.format(nextValue)
  return `${formattedValue} ${DRIVE_BYTE_UNITS[unitIndex]}`
}

function getDriveUsageViewModel(usage: DriveUsageDto): {
  readonly occupiedLabel: string
  readonly quotaLabel: string
  readonly percent: number
} {
  const usedBytes = parseDriveUsageBytes(usage.usedBytes)
  const reservedBytes = parseDriveUsageBytes(usage.reservedBytes)
  const quotaBytes = parseDriveUsageBytes(usage.quotaBytes)
  const occupiedBytes = usedBytes + reservedBytes
  const percent = quotaBytes > 0 ? Math.min(100, Math.max(0, occupiedBytes / quotaBytes * 100)) : 0

  return {
    occupiedLabel: formatBytes(String(occupiedBytes)),
    quotaLabel: quotaBytes > 0 ? formatBytes(String(quotaBytes)) : "-",
    percent,
  }
}

function parseDriveUsageBytes(value: string): number {
  const bytes = Number(value)
  if (!Number.isFinite(bytes) || bytes < 0) return 0
  return bytes
}

function getDriveStatusBadges(item: DriveItemDto): DriveStatusBadge[] {
  const badges: DriveStatusBadge[] = []
  const storageBadge = getDriveStorageStatusBadge(item.storageStatus)
  if (storageBadge) badges.push(storageBadge)
  if (item.shared || item.activeShareId) {
    badges.push({ key: "shared", label: "已分享", variant: "outline" })
  }
  return badges
}

function getDriveStorageStatusBadge(storageStatus: DriveItemDto["storageStatus"]): DriveStatusBadge | null {
  if (storageStatus === "pending") return { key: "pending", label: "上传中", variant: "outline" }
  if (storageStatus === "failed") return { key: "failed", label: "上传失败", variant: "destructive" }
  if (storageStatus === "delete_pending") return { key: "delete-pending", label: "删除中", variant: "outline" }
  return null
}

function canShareDriveItem(item: DriveItemDto): boolean {
  return item.storageStatus === "active"
}

function formatDriveDateTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "-"
  return date.toLocaleString("zh-CN")
}

function formatDriveAccessExpiresAt(value: string | null): string {
  if (!value) return "永久"
  return formatDriveDateTime(value)
}

function formatDriveAccessPassword(item: { readonly passwordEnabled?: boolean; readonly password?: string | null }): string {
  if (!item.passwordEnabled) return "无"
  return item.password || "无"
}

function uploadResultMessage(result: DriveLocalUploadResult): string {
  if (result.failed === 0) {
    return result.skipped > 0
      ? `已上传 ${result.completed} 个文件，跳过 ${result.skipped} 个`
      : `已上传 ${result.completed} 个文件`
  }
  return result.message
    ? `上传完成 ${result.completed} 个，失败 ${result.failed} 个：${result.message}`
    : `上传完成 ${result.completed} 个，失败 ${result.failed} 个`
}

function withSkipped(result: DriveLocalUploadResult, skipped: number): DriveLocalUploadResult {
  if (skipped === 0) return result
  return { ...result, skipped: result.skipped + skipped }
}

function countDriveLocalUploadItems(items: readonly DriveLocalUploadItem[]): number {
  return items.length
}

function driveLoadError(error: unknown): DriveLoadError {
  const message = errorMessage(error, "加载失败")
  if (message.includes("账号未登录")) return { type: "auth" }
  return { type: "load", message }
}

function errorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error) || !error.message) return fallback
  return readableErrorMessage(error.message) || fallback
}

function readableErrorMessage(message: string): string {
  return message
    .replace(/^Error invoking remote method '[^']+':\s*/, "")
    .replace(/^Error:\s*/, "")
    .trim()
}

export { DriveModule }
