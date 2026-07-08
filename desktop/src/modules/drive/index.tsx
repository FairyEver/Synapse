import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from "react"
import { toast } from "sonner"
import {
  ChevronRight,
  CircleUserRound,
  Copy,
  ExternalLink,
  Folder,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  X,
} from "lucide-react"
import {
  DRIVE_DEFAULT_ACCESS_SETTINGS,
  type DriveAccessSettingsInput,
  type DriveBrowserChildrenPageDto,
  type DriveItemDto,
  type DriveItemListPageDto,
  type DriveShareAccessMode,
  type DriveShareDto,
  type DriveShareListItemDto,
  type DriveSyncSnapshotDto,
  type DriveUsageDto,
} from "@synapse/shared"
import { useAccount } from "@/app-shell/account"
import { ModuleContentPanel, ModulePage } from "@/components/module-page"
import { RelativeTime } from "@/components/relative-time"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import { FormDialog } from "@/components/form-dialog"
import { SystemAppTopBarActionButton } from "@/modules/apps/components/system-app-top-bar"
import { DrivePublicAssetsView, type DrivePublicAssetsViewActionState, type DrivePublicAssetsViewHandle } from "./drive-public-assets-view"
import { DriveSiteCreateDialog } from "./drive-site-create-dialog"
import { DriveSitesDialog } from "./drive-sites-dialog"
import { DriveSyncDialog, DriveSyncStatusButton, type DriveSyncDialogState } from "./drive-sync-dialog"
import { DriveTrashView, type DriveTrashViewActionState, type DriveTrashViewHandle } from "./drive-trash-view"
import {
  DRIVE_PUBLIC_ASSETS_ENTRY_ID,
  DRIVE_TRASH_ENTRY_ID,
  driveRootSystemEntries,
  type DriveSystemEntry,
} from "./drive-system-entries"
import {
  DRIVE_FILE_TABLE_COLUMNS,
  DRIVE_SHARE_TABLE_COLUMNS,
  DriveTableColumns,
} from "./drive-table-columns"
import {
  DRIVE_LOCAL_UPLOAD_MAX_FILES,
  DRIVE_LOCAL_UPLOAD_MAX_FOLDER_DEPTH,
  createDriveLocalUploadTooDeepError,
  createDriveLocalUploadTooManyFilesError,
} from "@/lib/drive-local-upload-limits"
import { driveErrorMessage as errorMessage, formatDriveBytes as formatBytes } from "@/lib/drive-format"
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
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import {
  Dialog,
  DialogContent,
  DialogFrame,
  DialogFrameBody,
  DialogFrameFooter,
  DialogFrameHeader,
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupInput } from "@/components/ui/input-group"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
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
import { DriveItemIcon } from "./drive-item-icon"
import {
  DriveRendererActionsProvider,
  useDriveRendererActions,
  type DriveRendererAction,
} from "./markdown/drive-renderer-actions"

type DrivePathEntry = {
  readonly id: string | null
  readonly name: string
}

type DriveItemListBridgeResult = DriveItemListPageDto | DriveItemDto[]

type NameDialogState =
  | { readonly mode: "create"; readonly item: null; readonly value: string }
  | { readonly mode: "rename"; readonly item: DriveItemDto; readonly value: string }

type DriveMoveTreeBranch = {
  readonly error: string | null
  readonly folders: readonly DriveItemDto[]
  readonly loaded: boolean
  readonly loading: boolean
  readonly loadingMore: boolean
  readonly loadMoreError: string | null
  readonly page: DriveBrowserChildrenPageDto
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

type DriveShareSuccessState = Pick<DriveItemDto, "name" | "type"> & {
  readonly url: DriveShareDto["url"]
  readonly urlWithPassword: DriveShareDto["urlWithPassword"]
  readonly passwordEnabled: DriveShareDto["passwordEnabled"]
  readonly password: DriveShareDto["password"]
  readonly expiresAt: DriveShareDto["expiresAt"]
  readonly accessMode: DriveShareDto["accessMode"]
  readonly editorEmails: DriveShareDto["editorEmails"]
}

type DriveAccessExpiresInOption = DriveAccessSettingsInput["expiresIn"]
type DriveShareAccessModeOption = DriveShareAccessMode
type DrivePublicLinkFilter = DriveShareListItemDto["itemType"]
type DriveActiveView = "files" | "public-assets" | "trash"

type DriveStatusBadge = {
  readonly key: string
  readonly label: string
  readonly variant: "secondary" | "destructive" | "outline"
}

const DRIVE_ROOT_PARENT_VALUE = "root"
const DRIVE_SKELETON_ROWS = Array.from({ length: 8 }, (_, index) => index)
const DRIVE_ITEMS_PAGE_SIZE = 100
const DRIVE_PUBLIC_LINKS_PAGE_SIZE = 20
const DRIVE_ACCESS_EXPIRES_OPTIONS: ReadonlyArray<{ readonly label: string; readonly value: DriveAccessExpiresInOption }> = [
  { label: "3 天", value: "3d" },
  { label: "7 天", value: "7d" },
  { label: "30 天", value: "30d" },
  { label: "1 年", value: "1y" },
  { label: "永久", value: "forever" },
]
const DRIVE_SHARE_ACCESS_MODE_OPTIONS: ReadonlyArray<{ readonly label: string; readonly value: DriveShareAccessModeOption }> = [
  { label: "可阅读", value: "link_read" },
  { label: "登录用户可编辑", value: "link_edit" },
  { label: "指定用户可编辑", value: "specified_users_edit" },
]
const DRIVE_PUBLIC_LINK_FILTERS: ReadonlyArray<{ readonly label: string; readonly value: DrivePublicLinkFilter }> = [
  { label: "文件", value: "file" },
  { label: "文件夹", value: "folder" },
]

function createDefaultDriveAccessSettings(): DriveAccessSettingsInput {
  return {
    ...DRIVE_DEFAULT_ACCESS_SETTINGS,
    editorEmails: [...(DRIVE_DEFAULT_ACCESS_SETTINGS.editorEmails ?? [])],
  }
}

function driveMoveTreeKey(parentId: string | null): string {
  return parentId ?? DRIVE_ROOT_PARENT_VALUE
}

function formatDriveBreadcrumbPath(pathEntries: readonly DrivePathEntry[]): string {
  const names = pathEntries
    .filter((entry) => entry.id !== null)
    .map((entry) => entry.name.trim())
    .filter(Boolean)
  return names.length === 0 ? "根目录" : `/${names.join("/")}`
}

function createDriveItemsPage(items: readonly DriveItemDto[] = []): DriveItemListPageDto {
  return {
    items,
    page: {
      offset: 0,
      limit: Math.max(items.length, DRIVE_ITEMS_PAGE_SIZE),
      hasMore: false,
      nextOffset: null,
    },
  }
}

function normalizeDriveItemsPage(result: DriveItemListBridgeResult): DriveItemListPageDto {
  return Array.isArray(result) ? createDriveItemsPage(result) : result
}

function appendDriveItems(current: readonly DriveItemDto[], nextItems: readonly DriveItemDto[]): DriveItemDto[] {
  const seenIds = new Set(current.map((item) => item.id))
  return [
    ...current,
    ...nextItems.filter((item) => {
      if (seenIds.has(item.id)) return false
      seenIds.add(item.id)
      return true
    }),
  ]
}

function driveFoldersFromPage(page: DriveItemListPageDto): DriveItemDto[] {
  return page.items.filter((item) => item.type === "folder")
}

function useBusyIdSet() {
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(() => new Set())
  const busyIdsRef = useRef<Set<string>>(new Set())
  const setBusyId = useCallback((id: string, busy: boolean) => {
    const nextIds = new Set(busyIdsRef.current)
    if (busy) {
      nextIds.add(id)
    } else {
      nextIds.delete(id)
    }
    busyIdsRef.current = nextIds
    setBusyIds(nextIds)
  }, [])

  return { busyIds, busyIdsRef, setBusyId }
}

function DriveModule() {
  return (
    <DriveRendererActionsProvider>
      <DriveModuleContent />
    </DriveRendererActionsProvider>
  )
}

function DriveModuleContent() {
  const { pendingAction, startLogin, state: accountState } = useAccount()
  const { actions: rendererActions } = useDriveRendererActions()
  const [items, setItems] = useState<DriveItemDto[]>([])
  const [itemsPage, setItemsPage] = useState<DriveBrowserChildrenPageDto>(() => createDriveItemsPage().page)
  const [loadingMoreItems, setLoadingMoreItems] = useState(false)
  const [loadMoreItemsError, setLoadMoreItemsError] = useState<string | null>(null)
  const [path, setPath] = useState<DrivePathEntry[]>([{ id: null, name: "根目录" }])
  const [activeView, setActiveView] = useState<DriveActiveView>("files")
  const [loading, setLoading] = useState(false)
  const [usageState, setUsageState] = useState<DriveUsageState>({ status: "idle", usage: null })
  const [openingFolderId, setOpeningFolderId] = useState<string | null>(null)
  const [error, setError] = useState<DriveLoadError | null>(null)
  const [nameDialog, setNameDialog] = useState<NameDialogState | null>(null)
  const [moveTarget, setMoveTarget] = useState<DriveItemDto | null>(null)
  const [moveParentId, setMoveParentId] = useState<string>("root")
  const [deleteTarget, setDeleteTarget] = useState<DriveItemDto | null>(null)
  const [publicLinksOpen, setPublicLinksOpen] = useState(false)
  const [siteCreateTarget, setSiteCreateTarget] = useState<DriveItemDto | null>(null)
  const [sitesOpen, setSitesOpen] = useState(false)
  const [shareSuccess, setShareSuccess] = useState<DriveShareSuccessState | null>(null)
  const [accessSettingsTarget, setAccessSettingsTarget] = useState<DriveAccessSettingsTarget | null>(null)
  const {
    busyIds: disablingShareIds,
    busyIdsRef: disablingShareIdsRef,
    setBusyId: setDisablingShareId,
  } = useBusyIdSet()
  const [submitting, setSubmitting] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadItemCount, setUploadItemCount] = useState<number | null>(null)
  const [syncSnapshot, setSyncSnapshot] = useState<DriveSyncSnapshotDto | null>(null)
  const [syncDialog, setSyncDialog] = useState<DriveSyncDialogState | null>(null)
  const [publicAssetActionState, setPublicAssetActionState] = useState<DrivePublicAssetsViewActionState>({ loading: true, uploading: false })
  const [trashActionState, setTrashActionState] = useState<DriveTrashViewActionState>({ loading: true })
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const publicAssetsViewRef = useRef<DrivePublicAssetsViewHandle>(null)
  const trashViewRef = useRef<DriveTrashViewHandle>(null)
  const prefetchedParentIdRef = useRef<string | null | undefined>(undefined)
  const currentParentIdRef = useRef<string | null>(null)
  const driveItemsLoadRequestIdRef = useRef(0)

  const accountAuthenticated = accountState.status === "authenticated"
  const parentId = path.at(-1)?.id ?? null
  useEffect(() => {
    currentParentIdRef.current = parentId
  }, [parentId])

  const loadItems = useCallback(async () => {
    if (!accountAuthenticated) return
    const requestParentId = parentId
    const requestId = ++driveItemsLoadRequestIdRef.current
    setLoading(true)
    setLoadingMoreItems(false)
    setLoadMoreItemsError(null)
    setError(null)
    try {
      const bridge = requireSynapseBridge()
      const nextPage = normalizeDriveItemsPage(await bridge.account.listDriveItems({ parentId: requestParentId }))
      if (driveItemsLoadRequestIdRef.current !== requestId || currentParentIdRef.current !== requestParentId) return
      setItems([...nextPage.items])
      setItemsPage(nextPage.page)
    } catch (rawError) {
      if (driveItemsLoadRequestIdRef.current !== requestId || currentParentIdRef.current !== requestParentId) return
      setError(driveLoadError(rawError))
    } finally {
      if (driveItemsLoadRequestIdRef.current === requestId) {
        setLoading(false)
      }
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

  const loadMoreItems = useCallback(async () => {
    if (!accountAuthenticated || loadingMoreItems || !itemsPage.hasMore || itemsPage.nextOffset === null) return
    const requestParentId = parentId
    const requestId = driveItemsLoadRequestIdRef.current
    setLoadingMoreItems(true)
    setLoadMoreItemsError(null)
    try {
      const nextPage = normalizeDriveItemsPage(await requireSynapseBridge().account.listDriveItems({
        parentId: requestParentId,
        offset: itemsPage.nextOffset,
        limit: itemsPage.limit || DRIVE_ITEMS_PAGE_SIZE,
      }))
      if (driveItemsLoadRequestIdRef.current !== requestId || currentParentIdRef.current !== requestParentId) return
      setItems((current) => appendDriveItems(current, nextPage.items))
      setItemsPage(nextPage.page)
    } catch (rawError) {
      if (driveItemsLoadRequestIdRef.current !== requestId || currentParentIdRef.current !== requestParentId) return
      setLoadMoreItemsError(errorMessage(rawError, "加载更多失败"))
    } finally {
      if (driveItemsLoadRequestIdRef.current === requestId && currentParentIdRef.current === requestParentId) {
        setLoadingMoreItems(false)
      }
    }
  }, [accountAuthenticated, itemsPage, loadingMoreItems, parentId])

  useEffect(() => {
    if (!accountAuthenticated) {
      setItems([])
      setItemsPage(createDriveItemsPage().page)
      setLoadingMoreItems(false)
      setLoadMoreItemsError(null)
      setUsageState({ status: "idle", usage: null })
      setLoading(false)
      setOpeningFolderId(null)
      setError(null)
      currentParentIdRef.current = null
      setPath([{ id: null, name: "根目录" }])
      setActiveView("files")
      return
    }
    if (prefetchedParentIdRef.current !== undefined && prefetchedParentIdRef.current === parentId) {
      prefetchedParentIdRef.current = undefined
      return
    }
    void refreshDriveView()
  }, [accountAuthenticated, parentId, refreshDriveView])

  useEffect(() => {
    const bridge = requireSynapseBridge()
    let disposed = false
    void bridge.driveSync.getSnapshot()
      .then((snapshot) => {
        if (!disposed) setSyncSnapshot(snapshot)
      })
      .catch(() => {
        if (!disposed) setSyncSnapshot(null)
      })
    const unsubscribe = bridge.driveSync.onChanged((snapshot) => {
      setSyncSnapshot(snapshot)
    })
    return () => {
      disposed = true
      unsubscribe()
    }
  }, [])

  const actionsDisabled = activeView !== "files" || !accountAuthenticated || loading || openingFolderId !== null || error !== null
  const uploadActionsDisabled = actionsDisabled || uploading

  const openFolder = useCallback(async (item: DriveItemDto) => {
    if (item.type !== "folder") return
    if (openingFolderId !== null) return
    const requestId = ++driveItemsLoadRequestIdRef.current
    setLoading(false)
    setLoadingMoreItems(false)
    setLoadMoreItemsError(null)
    setOpeningFolderId(item.id)
    setError(null)
    try {
      const nextPage = normalizeDriveItemsPage(await requireSynapseBridge().account.listDriveItems({ parentId: item.id }))
      if (driveItemsLoadRequestIdRef.current !== requestId) return
      prefetchedParentIdRef.current = item.id
      setItems([...nextPage.items])
      setItemsPage(nextPage.page)
      setPath((current) => {
        currentParentIdRef.current = item.id
        return [...current, { id: item.id, name: item.name }]
      })
    } catch (rawError) {
      if (driveItemsLoadRequestIdRef.current !== requestId) return
      setError(driveLoadError(rawError))
    } finally {
      if (driveItemsLoadRequestIdRef.current === requestId) {
        setOpeningFolderId(null)
      }
    }
  }, [openingFolderId])

  const openSystemEntry = useCallback((entry: DriveSystemEntry) => {
    if (entry.id === DRIVE_PUBLIC_ASSETS_ENTRY_ID) {
      setActiveView("public-assets")
      return
    }
    if (entry.id === DRIVE_TRASH_ENTRY_ID) {
      setActiveView("trash")
    }
  }, [])

  const jumpToPath = useCallback((index: number) => {
    if (activeView !== "files") {
      if (index === 0) setActiveView("files")
      return
    }
    driveItemsLoadRequestIdRef.current += 1
    setPath((current) => {
      const nextPath = current.slice(0, index + 1)
      currentParentIdRef.current = nextPath.at(-1)?.id ?? null
      return nextPath
    })
  }, [activeView])

  const refreshCurrentItemsAfterUpload = useCallback(async () => {
    if (!accountAuthenticated) return
    const requestParentId = currentParentIdRef.current
    const requestId = ++driveItemsLoadRequestIdRef.current
    setLoadingMoreItems(false)
    setLoadMoreItemsError(null)
    try {
      const nextPage = normalizeDriveItemsPage(await requireSynapseBridge().account.listDriveItems({ parentId: requestParentId }))
      if (driveItemsLoadRequestIdRef.current !== requestId || currentParentIdRef.current !== requestParentId) return
      setError(null)
      setItems([...nextPage.items])
      setItemsPage(nextPage.page)
    } catch (rawError) {
      if (driveItemsLoadRequestIdRef.current !== requestId || currentParentIdRef.current !== requestParentId) return
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

  const handleOpenShareDetails = useCallback(async (item: DriveItemDto) => {
    if (!item.activeShareId) return
    try {
      const share = await requireSynapseBridge().account.getDriveShare({ shareId: item.activeShareId })
      setShareSuccess(driveShareSuccessFromListItem(item, share))
    } catch (rawError) {
      toast(errorMessage(rawError, "分享信息加载失败"))
      await loadItems()
    }
  }, [loadItems])

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
        accessMode: share.accessMode,
        editorEmails: share.editorEmails,
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
    const shareId = item.activeShareId
    if (!shareId || disablingShareIdsRef.current.has(shareId)) return
    setDisablingShareId(shareId, true)
    try {
      await requireSynapseBridge().account.disableDriveShare({ shareId })
      toast("已取消分享")
      await loadItems()
    } catch (rawError) {
      toast(errorMessage(rawError, "取消分享失败"))
    } finally {
      setDisablingShareId(shareId, false)
    }
  }, [disablingShareIdsRef, loadItems, setDisablingShareId])

  const activePath: readonly DrivePathEntry[] = (() => {
    if (activeView === "public-assets") {
      return [{ id: null, name: "根目录" }, { id: DRIVE_PUBLIC_ASSETS_ENTRY_ID, name: "公开素材" }]
    }
    if (activeView === "trash") {
      return [{ id: null, name: "根目录" }, { id: DRIVE_TRASH_ENTRY_ID, name: "回收站" }]
    }
    return path
  })()

  const activeStatusBadge: DriveStatusBadge | null = (() => {
    if (activeView === "files" && uploading) {
      return { key: "uploading", label: uploadItemCount === null ? "上传中" : `正在上传 ${uploadItemCount} 项`, variant: "outline" }
    }
    if (activeView === "public-assets" && publicAssetActionState.uploading) {
      return { key: "public-asset-uploading", label: "上传中", variant: "outline" }
    }
    return null
  })()

  const toolbarActions = (() => {
    if (activeView === "public-assets") {
      return (
        <DrivePublicAssetToolbarActions
          uploadDisabled={!accountAuthenticated || publicAssetActionState.uploading}
          refreshDisabled={!accountAuthenticated || publicAssetActionState.loading}
          onUpload={() => publicAssetsViewRef.current?.openUploadDialog()}
          onRefresh={() => publicAssetsViewRef.current?.refresh()}
        />
      )
    }
    if (activeView === "trash") {
      return (
        <DriveTrashToolbarActions
          refreshDisabled={!accountAuthenticated || trashActionState.loading}
          onRefresh={() => trashViewRef.current?.refresh()}
        />
      )
    }
    return (
      <DriveToolbarActions
        rendererActions={rendererActions}
        syncSnapshot={syncSnapshot}
        uploadDisabled={uploadActionsDisabled}
        createDisabled={actionsDisabled}
        publicLinksDisabled={!accountAuthenticated || loading}
        refreshDisabled={!accountAuthenticated || loading || openingFolderId !== null}
        onUploadFiles={() => fileInputRef.current?.click()}
        onUploadFolder={() => folderInputRef.current?.click()}
        onCreateFolder={handleCreateFolder}
        onOpenPublicLinks={() => setPublicLinksOpen(true)}
        onOpenSites={() => setSitesOpen(true)}
        onOpenLocalSync={() => setSyncDialog({
          mode: "local",
          item: null,
          targetParentId: parentId,
          drivePathHint: formatDriveBreadcrumbPath(path),
        })}
        onOpenSyncStatus={() => setSyncDialog({ mode: "status", item: null })}
        onRefresh={() => { void refreshDriveView() }}
      >
        <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileSelected} />
        <input ref={folderInputRef} type="file" multiple className="hidden" onChange={handleFolderSelected} {...{ webkitdirectory: "" }} />
      </DriveToolbarActions>
    )
  })()

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
    if (activeView === "public-assets") {
      return (
        <DrivePublicAssetsView
          ref={publicAssetsViewRef}
          inlineToolbar={false}
          onActionStateChange={setPublicAssetActionState}
          onUsageChange={() => { void loadDriveUsage() }}
        />
      )
    }
    if (activeView === "trash") {
      return (
        <DriveTrashView
          ref={trashViewRef}
          inlineToolbar={false}
          onActionStateChange={setTrashActionState}
          onDriveItemsChanged={() => { void loadItems() }}
          onUsageChange={() => { void loadDriveUsage() }}
        />
      )
    }
    return (
      <DriveFileList
        items={items}
        itemsPage={itemsPage}
        systemEntries={driveRootSystemEntries(parentId)}
        loading={loading}
        loadingMoreItems={loadingMoreItems}
        loadMoreItemsError={loadMoreItemsError}
        openingFolderId={openingFolderId}
        path={path}
        onOpenFolder={openFolder}
        onOpenSystemEntry={openSystemEntry}
        onLoadMoreItems={loadMoreItems}
        onRename={handleRename}
        onMove={handleMove}
        onDelete={handleDelete}
        onOpenItem={handlePreview}
        onShare={handleShare}
        onPublishSite={setSiteCreateTarget}
        onOpenSyncBinding={(item, drivePathHint) => setSyncDialog({ mode: "bind", item, drivePathHint })}
        onOpenShareDetails={handleOpenShareDetails}
        onDisableShare={handleDisableShare}
        disablingShareIds={disablingShareIds}
        onUploadDroppedFiles={handleDroppedFiles}
        uploadDisabled={uploadActionsDisabled}
      />
    )
  })()

  return (
    <TooltipProvider>
      <ModulePage
        title="云盘"
        titleAddon={accountAuthenticated ? <DriveUsageIndicator state={usageState} /> : undefined}
        actions={toolbarActions}
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
            <DriveSiteCreateDialog
              folder={siteCreateTarget}
              open={siteCreateTarget !== null}
              onOpenChange={(open) => {
                if (!open) setSiteCreateTarget(null)
              }}
              onCreated={() => setSitesOpen(true)}
            />
            <DriveSitesDialog open={sitesOpen} onOpenChange={setSitesOpen} />
            <DriveSyncDialog
              open={syncDialog !== null}
              state={syncDialog}
              snapshot={syncSnapshot}
              onDriveItemsChanged={refreshDriveView}
              onOpenChange={(open) => {
                if (!open) setSyncDialog(null)
              }}
              onSnapshotChange={setSyncSnapshot}
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
        {accountAuthenticated ? (
          <div className="flex min-h-full flex-col gap-2">
            <DriveViewNavigation path={activePath} statusBadge={activeStatusBadge} onJumpToPath={jumpToPath} />
            {content}
          </div>
        ) : content}
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
        folders: force ? [] : current[key]?.folders ?? [],
        loaded: false,
        loading: true,
        loadingMore: false,
        loadMoreError: null,
        page: createDriveItemsPage().page,
      },
    }))

    try {
      const nextPage = normalizeDriveItemsPage(await requireSynapseBridge().account.listDriveItems({
        parentId,
        limit: DRIVE_ITEMS_PAGE_SIZE,
      }))
      setBranches((current) => ({
        ...current,
        [key]: {
          error: null,
          folders: driveFoldersFromPage(nextPage),
          loaded: true,
          loading: false,
          loadingMore: false,
          loadMoreError: null,
          page: nextPage.page,
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
          loadingMore: false,
          loadMoreError: null,
          page: current[key]?.page ?? createDriveItemsPage().page,
        },
      }))
    }
  }, [branches])

  const loadMoreFolders = useCallback(async (parentId: string | null) => {
    const key = driveMoveTreeKey(parentId)
    const existing = branches[key]
    if (!existing || existing.loading || existing.loadingMore || !existing.page.hasMore || existing.page.nextOffset === null) return

    setBranches((current) => ({
      ...current,
      [key]: {
        ...current[key],
        loadingMore: true,
        loadMoreError: null,
      },
    }))

    try {
      const nextPage = normalizeDriveItemsPage(await requireSynapseBridge().account.listDriveItems({
        parentId,
        offset: existing.page.nextOffset,
        limit: existing.page.limit || DRIVE_ITEMS_PAGE_SIZE,
      }))
      setBranches((current) => ({
        ...current,
        [key]: {
          error: null,
          folders: appendDriveItems(current[key]?.folders ?? [], driveFoldersFromPage(nextPage)),
          loaded: true,
          loading: false,
          loadingMore: false,
          loadMoreError: null,
          page: nextPage.page,
        },
      }))
    } catch (rawError) {
      setBranches((current) => ({
        ...current,
        [key]: {
          ...current[key],
          loadingMore: false,
          loadMoreError: errorMessage(rawError, "加载更多失败"),
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
          loadMoreFolders={loadMoreFolders}
          onLoadMore={() => { void loadMoreFolders(null) }}
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
  loadMoreFolders,
  onLoadMore,
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
  readonly loadMoreFolders: (parentId: string | null) => Promise<void>
  readonly onLoadMore: () => void
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
  const hasMore = branch?.page.hasMore ?? false
  if (folders.length === 0 && !hasMore) {
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
          loadMoreFolders={loadMoreFolders}
          onSelect={onSelect}
          onToggle={onToggle}
          selectedParentId={selectedParentId}
        />
      ))}
      {branch?.loadMoreError ? (
        <div className="px-3 py-1 text-sm text-destructive">{branch.loadMoreError}</div>
      ) : null}
      {hasMore ? (
        <div className="px-3 py-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={branch?.loadingMore ?? false}
            aria-label={`加载更多 ${parentName}`}
            onClick={onLoadMore}
          >
            {branch?.loadingMore ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : null}
            {branch?.loadingMore ? "加载中" : "加载更多"}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function DriveMoveTreeFolder({
  branches,
  disabledFolderId,
  expandedIds,
  folder,
  loadFolders,
  loadMoreFolders,
  onSelect,
  onToggle,
  selectedParentId,
}: {
  readonly branches: Record<string, DriveMoveTreeBranch>
  readonly disabledFolderId: string | null
  readonly expandedIds: ReadonlySet<string>
  readonly folder: DriveItemDto
  readonly loadFolders: (parentId: string | null, force?: boolean) => Promise<void>
  readonly loadMoreFolders: (parentId: string | null) => Promise<void>
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
            loadMoreFolders={loadMoreFolders}
            onLoadMore={() => { void loadMoreFolders(folder.id) }}
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
  itemsPage,
  systemEntries,
  loading,
  loadingMoreItems,
  loadMoreItemsError,
  openingFolderId,
  path,
  onOpenFolder,
  onOpenSystemEntry,
  onLoadMoreItems,
  onRename,
  onMove,
  onDelete,
  onOpenItem,
  onShare,
  onPublishSite,
  onOpenSyncBinding,
  onOpenShareDetails,
  onDisableShare,
  disablingShareIds,
  onUploadDroppedFiles,
  uploadDisabled,
}: {
  readonly items: readonly DriveItemDto[]
  readonly itemsPage: DriveBrowserChildrenPageDto
  readonly systemEntries: readonly DriveSystemEntry[]
  readonly loading: boolean
  readonly loadingMoreItems: boolean
  readonly loadMoreItemsError: string | null
  readonly openingFolderId: string | null
  readonly path: readonly DrivePathEntry[]
  readonly onOpenFolder: (item: DriveItemDto) => void
  readonly onOpenSystemEntry: (entry: DriveSystemEntry) => void
  readonly onLoadMoreItems: () => void
  readonly onRename: (item: DriveItemDto) => void
  readonly onMove: (item: DriveItemDto) => void
  readonly onDelete: (item: DriveItemDto) => void
  readonly onOpenItem: (item: DriveItemDto) => void
  readonly onShare: (item: DriveItemDto) => void
  readonly onPublishSite: (item: DriveItemDto) => void
  readonly onOpenSyncBinding: (item: DriveItemDto, drivePathHint: string) => void
  readonly onOpenShareDetails: (item: DriveItemDto) => void
  readonly onDisableShare: (item: DriveItemDto) => void
  readonly disablingShareIds: ReadonlySet<string>
  readonly onUploadDroppedFiles: (dataTransfer: DataTransfer) => Promise<void>
  readonly uploadDisabled: boolean
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
      {loading ? (
        <ModuleContentPanel>
          <DriveFileTableSkeleton />
        </ModuleContentPanel>
      ) : items.length === 0 && systemEntries.length === 0 ? (
        <Empty className="min-h-64 border">
          <EmptyHeader>
            <EmptyTitle>暂无文件</EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : (
        <ModuleContentPanel>
          <Table className="table-fixed">
            <DriveTableColumns columns={DRIVE_FILE_TABLE_COLUMNS} />
            <DriveFileTableHeader />
            <TableBody>
              {systemEntries.map((entry) => (
                <DriveSystemEntryRow
                  key={entry.id}
                  entry={entry}
                  onOpen={onOpenSystemEntry}
                />
              ))}
              {items.map((item) => (
                <DriveFileListRow
                  key={item.id}
                  drivePath={buildDriveItemPath(path, item.name)}
                  item={item}
                  opening={openingFolderId === item.id}
                  onOpenFolder={onOpenFolder}
                  onRename={onRename}
                  onMove={onMove}
                  onDelete={onDelete}
                  onOpenItem={onOpenItem}
                  onShare={onShare}
                  onPublishSite={onPublishSite}
                  onOpenSyncBinding={onOpenSyncBinding}
                  onOpenShareDetails={onOpenShareDetails}
                  onDisableShare={onDisableShare}
                  disablingShare={item.activeShareId ? disablingShareIds.has(item.activeShareId) : false}
                />
              ))}
            </TableBody>
          </Table>
          {itemsPage.hasMore || loadMoreItemsError ? (
            <div className="flex flex-col items-center gap-2 border-t px-3 py-3">
              {loadMoreItemsError ? (
                <div className="text-sm text-destructive">{loadMoreItemsError}</div>
              ) : null}
              {itemsPage.hasMore ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={loadingMoreItems}
                  onClick={onLoadMoreItems}
                >
                  {loadingMoreItems ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : null}
                  {loadingMoreItems ? "加载中" : "加载更多"}
                </Button>
              ) : null}
            </div>
          ) : null}
        </ModuleContentPanel>
      )}
      {dragActive ? (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg border border-dashed bg-background/80">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
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
        <TableHead className="text-right">大小</TableHead>
        <TableHead className="text-right">更新时间</TableHead>
        <TableHead className="text-right" aria-label="操作" />
      </TableRow>
    </TableHeader>
  )
}

function DriveFileTableSkeleton() {
  return (
    <Table className="table-fixed">
      <DriveTableColumns columns={DRIVE_FILE_TABLE_COLUMNS} />
      <DriveFileTableHeader />
      <TableBody>
        {DRIVE_SKELETON_ROWS.map((row) => (
          <TableRow key={row}>
            <TableCell>
              <div className="flex min-w-0 items-center gap-2">
                <Skeleton className="size-4 shrink-0" />
                <Skeleton className="h-4 w-48" />
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

function DriveUploadActions({
  disabled,
  onUploadFiles,
  onUploadFolder,
}: {
  readonly disabled: boolean
  readonly onUploadFiles: () => void
  readonly onUploadFolder: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SystemAppTopBarActionButton disabled={disabled}>
          上传
        </SystemAppTopBarActionButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={onUploadFiles}>上传文件</DropdownMenuItem>
        <DropdownMenuItem onClick={onUploadFolder}>上传文件夹</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function DriveToolbarActions({
  children,
  createDisabled,
  onCreateFolder,
  onOpenLocalSync,
  onOpenPublicLinks,
  onOpenSites,
  onOpenSyncStatus,
  onRefresh,
  onUploadFiles,
  onUploadFolder,
  publicLinksDisabled,
  refreshDisabled,
  rendererActions,
  syncSnapshot,
  uploadDisabled,
}: {
  readonly children: ReactNode
  readonly createDisabled: boolean
  readonly publicLinksDisabled: boolean
  readonly refreshDisabled: boolean
  readonly rendererActions: readonly DriveRendererAction[]
  readonly syncSnapshot: DriveSyncSnapshotDto | null
  readonly uploadDisabled: boolean
  readonly onCreateFolder: () => void
  readonly onOpenLocalSync: () => void
  readonly onOpenPublicLinks: () => void
  readonly onOpenSites: () => void
  readonly onOpenSyncStatus: () => void
  readonly onRefresh: () => void
  readonly onUploadFiles: () => void
  readonly onUploadFolder: () => void
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-0" data-testid="drive-toolbar-actions">
      {children}
      {rendererActions.map((action) => (
        <SystemAppTopBarActionButton key={action.id} type="button" disabled={action.disabled} onClick={action.onClick}>
          {action.badge ? `${action.label} ${action.badge}` : action.label}
        </SystemAppTopBarActionButton>
      ))}
      <DriveSyncStatusButton snapshot={syncSnapshot} onOpen={onOpenSyncStatus} />
      <SystemAppTopBarActionButton disabled={uploadDisabled} onClick={onOpenLocalSync}>
        本地同步
      </SystemAppTopBarActionButton>
      <DriveUploadActions
        disabled={uploadDisabled}
        onUploadFiles={onUploadFiles}
        onUploadFolder={onUploadFolder}
      />
      <SystemAppTopBarActionButton disabled={createDisabled} onClick={onCreateFolder}>
        新建文件夹
      </SystemAppTopBarActionButton>
      <SystemAppTopBarActionButton disabled={publicLinksDisabled} onClick={onOpenPublicLinks}>
        我的分享
      </SystemAppTopBarActionButton>
      <SystemAppTopBarActionButton disabled={publicLinksDisabled} onClick={onOpenSites}>
        站点
      </SystemAppTopBarActionButton>
      <SystemAppTopBarActionButton disabled={refreshDisabled} onClick={onRefresh}>
        刷新
      </SystemAppTopBarActionButton>
    </div>
  )
}

function DrivePublicAssetToolbarActions({
  uploadDisabled,
  refreshDisabled,
  onUpload,
  onRefresh,
}: {
  readonly uploadDisabled: boolean
  readonly refreshDisabled: boolean
  readonly onUpload: () => void
  readonly onRefresh: () => void
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-0">
      <SystemAppTopBarActionButton type="button" disabled={uploadDisabled} onClick={onUpload}>
        上传公开素材
      </SystemAppTopBarActionButton>
      <SystemAppTopBarActionButton type="button" disabled={refreshDisabled} onClick={onRefresh}>
        刷新
      </SystemAppTopBarActionButton>
    </div>
  )
}

function DriveTrashToolbarActions({
  refreshDisabled,
  onRefresh,
}: {
  readonly refreshDisabled: boolean
  readonly onRefresh: () => void
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-0">
      <SystemAppTopBarActionButton type="button" disabled={refreshDisabled} onClick={onRefresh}>
        刷新
      </SystemAppTopBarActionButton>
    </div>
  )
}

function DriveViewNavigation({
  path,
  statusBadge,
  onJumpToPath,
}: {
  readonly path: readonly DrivePathEntry[]
  readonly statusBadge: DriveStatusBadge | null
  readonly onJumpToPath: (index: number) => void
}) {
  return (
    <div className="flex min-h-8 items-center gap-2 px-1">
      <DriveBreadcrumbs path={path} onJumpToPath={onJumpToPath} />
      <div className="flex shrink-0 items-center justify-end">
        {statusBadge ? <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge> : null}
      </div>
    </div>
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
      className="min-w-0 flex-1 overflow-x-auto"
      aria-label="当前位置"
    >
      <ol className="flex min-w-max items-center gap-0.5 text-sm text-muted-foreground">
        {path.map((entry, index) => {
          const isCurrent = index === path.length - 1
          return (
            <li key={`${entry.id ?? "root"}-${index}`} className="flex items-center gap-0.5">
              {index > 0 ? <ChevronRight className="size-4 shrink-0" aria-hidden="true" /> : null}
              {isCurrent ? (
                <span
                  className="flex h-8 max-w-56 items-center truncate px-1.5 font-medium text-foreground"
                  aria-current="page"
                >
                  {entry.name}
                </span>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 max-w-56 px-1.5 text-sm text-muted-foreground hover:text-foreground"
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

function DriveInlineBadges({
  badges,
}: {
  readonly badges: readonly DriveStatusBadge[]
}) {
  if (badges.length === 0) return null
  return (
    <div className="flex shrink-0 items-center gap-1">
      {badges.map((badge) => (
        <Badge key={badge.key} variant={badge.variant}>
          {badge.label}
        </Badge>
      ))}
    </div>
  )
}

function DriveShareInlineSummary({
  item,
  onOpenShareDetails,
}: {
  readonly item: DriveItemDto
  readonly onOpenShareDetails: (item: DriveItemDto) => void
}) {
  const summary = formatDriveItemShareSummary(item)
  if (!summary) return null
  if (!item.activeShareId) {
    return <span className="min-w-0 truncate text-xs text-muted-foreground">{summary}</span>
  }
  return (
    <button
      type="button"
      className="min-w-0 truncate text-left text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      title={summary}
      onClick={(event) => {
        event.stopPropagation()
        onOpenShareDetails(item)
      }}
    >
      {summary}
    </button>
  )
}

function DriveSystemEntryRow({
  entry,
  onOpen,
}: {
  readonly entry: DriveSystemEntry
  readonly onOpen: (entry: DriveSystemEntry) => void
}) {
  return (
    <TableRow className="cursor-pointer" onClick={() => onOpen(entry)}>
      <TableCell className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <DriveItemIcon kind={entry.kind === "public_assets" ? "public-assets" : "trash"} />
          <span
            className="block min-w-0 truncate whitespace-nowrap font-medium select-text"
            data-drive-item-name="true"
            title={entry.name}
            onContextMenu={(event) => event.stopPropagation()}
          >
            {entry.name}
          </span>
        </div>
      </TableCell>
      <TableCell className="text-right tabular-nums text-muted-foreground">-</TableCell>
      <TableCell className="truncate text-right tabular-nums text-muted-foreground">-</TableCell>
      <TableCell aria-label={`${entry.name} 操作`} />
    </TableRow>
  )
}

function DriveFileListRow({
  drivePath,
  item,
  opening,
  onOpenFolder,
  onRename,
  onMove,
  onDelete,
  onOpenItem,
  onShare,
  onPublishSite,
  onOpenSyncBinding,
  onOpenShareDetails,
  onDisableShare,
  disablingShare,
}: {
  readonly drivePath: string
  readonly item: DriveItemDto
  readonly opening: boolean
  readonly onOpenFolder: (item: DriveItemDto) => void
  readonly onRename: (item: DriveItemDto) => void
  readonly onMove: (item: DriveItemDto) => void
  readonly onDelete: (item: DriveItemDto) => void
  readonly onOpenItem: (item: DriveItemDto) => void
  readonly onShare: (item: DriveItemDto) => void
  readonly onPublishSite: (item: DriveItemDto) => void
  readonly onOpenSyncBinding: (item: DriveItemDto, drivePathHint: string) => void
  readonly onOpenShareDetails: (item: DriveItemDto) => void
  readonly onDisableShare: (item: DriveItemDto) => void
  readonly disablingShare: boolean
}) {
  const isFolder = item.type === "folder"
  const statusBadges = getDriveStatusBadges(item)
  const canOpen = canOpenDriveItem(item)
  const canShare = canShareDriveItem(item)
  const hasActiveShare = Boolean(item.activeShareId)
  const pointerDownStartedOnNameRef = useRef(false)
  const canOpenFileName = !isFolder && canOpen

  const handleFileNameClick = (event: MouseEvent<HTMLElement>) => {
    if (!canOpenFileName) return
    event.stopPropagation()
    const shouldIgnoreSelectionClick = pointerDownStartedOnNameRef.current && hasSelectedTextInside(event.currentTarget)
    pointerDownStartedOnNameRef.current = false
    if (shouldIgnoreSelectionClick) return
    onOpenItem(item)
  }

  const handleFileNameKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!canOpenFileName || (event.key !== "Enter" && event.key !== " ")) return
    event.preventDefault()
    event.stopPropagation()
    onOpenItem(item)
  }

  return (
    <TableRow
      className={cn(isFolder && canOpen && !opening ? "cursor-pointer" : undefined)}
      aria-busy={opening || undefined}
      onPointerDownCapture={(event) => {
        pointerDownStartedOnNameRef.current = isDriveItemNameTarget(event.target)
      }}
      onClick={isFolder && canOpen && !opening ? (event) => {
        const shouldIgnoreSelectionClick = pointerDownStartedOnNameRef.current && hasSelectedTextInside(event.currentTarget)
        pointerDownStartedOnNameRef.current = false
        if (shouldIgnoreSelectionClick) return
        onOpenFolder(item)
      } : undefined}
    >
      <TableCell className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          {opening ? (
            <LoaderCircle className="size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />
          ) : isFolder ? (
            <DriveItemIcon kind="folder" />
          ) : (
            <DriveItemIcon kind="file" />
          )}
          <div className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <DriveItemNameContextMenu
                drivePath={drivePath}
                item={item}
                onRename={onRename}
              >
                {isFolder ? (
                  <span
                    className="block min-w-0 truncate whitespace-nowrap font-medium select-text"
                    data-drive-item-name="true"
                    title={item.name}
                    onContextMenu={(event) => {
                      event.stopPropagation()
                    }}
                  >
                    {item.name}
                  </span>
                ) : (
                  <span
                    className={cn(
                      "block min-w-0 truncate whitespace-nowrap font-medium select-text",
                      canOpenFileName && "cursor-pointer underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                    )}
                    data-drive-item-name="true"
                    role={canOpenFileName ? "button" : undefined}
                    tabIndex={canOpenFileName ? 0 : undefined}
                    title={item.name}
                    onClick={handleFileNameClick}
                    onKeyDown={handleFileNameKeyDown}
                    onContextMenu={(event) => {
                      event.stopPropagation()
                    }}
                  >
                    <span className="sr-only">文件 </span>
                    {item.name}
                  </span>
                )}
              </DriveItemNameContextMenu>
              <DriveInlineBadges badges={statusBadges} />
            </div>
            <DriveShareInlineSummary item={item} onOpenShareDetails={onOpenShareDetails} />
          </div>
        </div>
      </TableCell>
      <TableCell className="text-right tabular-nums text-muted-foreground">
        {isFolder ? "-" : formatBytes(item.size)}
      </TableCell>
      <TableCell className="truncate text-right tabular-nums text-muted-foreground">
        <RelativeTime value={item.updatedAt} />
      </TableCell>
      <TableCell className="text-right">
        <div
          className="flex items-center justify-end"
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {hasActiveShare ? (
            <Button type="button" variant="ghost" size="xs" disabled={!canShare || disablingShare} onClick={() => onDisableShare(item)}>
              {disablingShare ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : null}
              取消分享
            </Button>
          ) : (
            <Button type="button" variant="ghost" size="xs" disabled={!canShare} onClick={() => onShare(item)}>
              分享
            </Button>
          )}
          <Button type="button" variant="ghost" size="xs" disabled={!canOpen} onClick={() => onOpenItem(item)}>
            预览
          </Button>
          <Button type="button" variant="ghost" size="xs" onClick={() => onDelete(item)}>
            删除
          </Button>
          <DriveItemMenu
            item={item}
            onRename={onRename}
            onMove={onMove}
            onPublishSite={onPublishSite}
            onOpenSyncBinding={() => onOpenSyncBinding(item, drivePath)}
          />
        </div>
      </TableCell>
    </TableRow>
  )
}

function isDriveItemNameTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Node)) return false
  const element = target instanceof Element ? target : target.parentElement
  return Boolean(element?.closest("[data-drive-item-name='true']"))
}

function hasSelectedTextInside(element: HTMLElement): boolean {
  const selection = element.ownerDocument.defaultView?.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return false
  if (selection.toString().trim().length === 0) return false

  for (let index = 0; index < selection.rangeCount; index += 1) {
    if (selection.getRangeAt(index).intersectsNode(element)) return true
  }
  return false
}

function DriveItemNameContextMenu({
  children,
  drivePath,
  item,
  onRename,
}: {
  readonly children: ReactNode
  readonly drivePath: string
  readonly item: DriveItemDto
  readonly onRename: (item: DriveItemDto) => void
}) {
  return (
    <ContextMenu data-track="drive-item-name-menu">
      <ContextMenuTrigger asChild className="select-text">
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => { void copyDriveText(item.name, "名称已复制") }}>
          复制名称
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => { void copyDriveText(drivePath, "路径已复制") }}>
          复制路径
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => onRename(item)}>
          重命名
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

function DriveItemMenu({
  item,
  onRename,
  onMove,
  onPublishSite,
  onOpenSyncBinding,
}: {
  readonly item: DriveItemDto
  readonly onRename: (item: DriveItemDto) => void
  readonly onMove: (item: DriveItemDto) => void
  readonly onPublishSite: (item: DriveItemDto) => void
  readonly onOpenSyncBinding: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="xs" aria-label={`更多 ${item.name}`}>
          更多
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          {item.type === "folder" ? <DropdownMenuItem onClick={() => onPublishSite(item)}>发布站点</DropdownMenuItem> : null}
          <DropdownMenuItem onClick={onOpenSyncBinding}>同步</DropdownMenuItem>
          <DropdownMenuItem onClick={() => onRename(item)}>重命名</DropdownMenuItem>
          <DropdownMenuItem onClick={() => onMove(item)}>移动</DropdownMenuItem>
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
  const [settings, setSettings] = useState<DriveAccessSettingsInput>(() => createDefaultDriveAccessSettings())
  const [editorEmailInput, setEditorEmailInput] = useState("")
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!target) return
    setSettings(createDefaultDriveAccessSettings())
    setEditorEmailInput("")
    setError(null)
  }, [target])

  const title = "分享设置"
  const accessMode = settings.accessMode ?? "link_read"
  const editorEmails = settings.editorEmails ?? []
  const addEditorEmail = () => {
    const email = normalizeDriveEditorEmailForUi(editorEmailInput)
    if (!email) {
      setError("邮箱无效")
      return
    }
    if (editorEmails.includes(email)) {
      setEditorEmailInput("")
      setError(null)
      return
    }
    setSettings((current) => ({
      ...current,
      editorEmails: [...(current.editorEmails ?? []), email],
    }))
    setEditorEmailInput("")
    setError(null)
  }

  return (
    <Dialog open={target !== null} onOpenChange={(open) => {
      if (!open && !submitting) onCancel()
    }}>
      {target ? (
        <FormDialog
          title={title}
          contentClassName="sm:max-w-lg"
          onSubmit={(event) => {
            event.preventDefault()
            const nextSettings = {
              ...settings,
              accessMode,
              editorEmails: accessMode === "specified_users_edit" ? editorEmails : [],
            }
            if (nextSettings.accessMode === "specified_users_edit" && nextSettings.editorEmails.length === 0) {
              setError("请添加可编辑用户")
              return
            }
            void onConfirm(nextSettings)
          }}
          footer={(
            <>
              <Button type="button" variant="outline" disabled={submitting} onClick={onCancel}>取消</Button>
              <Button type="submit" disabled={submitting}>确定</Button>
            </>
          )}
        >
          <div className="grid gap-5">
            <div className="grid gap-2.5">
              <Label>权限</Label>
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                className="w-full"
                value={accessMode}
                onValueChange={(value) => {
                  if (!value) return
                  setSettings((current) => ({
                    ...current,
                    accessMode: value as DriveShareAccessModeOption,
                    editorEmails: value === "specified_users_edit" ? current.editorEmails ?? [] : [],
                  }))
                  setError(null)
                }}
              >
                {DRIVE_SHARE_ACCESS_MODE_OPTIONS.map((option) => (
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
            {accessMode === "specified_users_edit" ? (
              <div className="grid gap-2.5">
                <Label htmlFor="drive-share-editor-email">可编辑用户</Label>
                <div className="flex gap-2">
                  <Input
                    id="drive-share-editor-email"
                    value={editorEmailInput}
                    onChange={(event) => setEditorEmailInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter") return
                      event.preventDefault()
                      addEditorEmail()
                    }}
                  />
                  <Button type="button" variant="outline" onClick={addEditorEmail}>添加</Button>
                </div>
                {editorEmails.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {editorEmails.map((email) => (
                      <Badge key={email} variant="secondary" className="gap-1">
                        <span>{email}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          className="h-5 px-1"
                          aria-label={`移除 ${email}`}
                          onClick={() => {
                            setSettings((current) => ({
                              ...current,
                              editorEmails: (current.editorEmails ?? []).filter((item) => item !== email),
                            }))
                          }}
                        >
                          <X className="size-3" />
                        </Button>
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
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
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
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
  const [shareFilter, setShareFilter] = useState<DrivePublicLinkFilter>("file")
  const {
    busyIds: disablingShareIds,
    busyIdsRef: disablingShareIdsRef,
    setBusyId: setDisablingShareId,
  } = useBusyIdSet()
  const shareLoadGenerationRef = useRef(0)
  const visibleShares = shareState.items.filter((item) => item.itemType === shareFilter)

  const loadShares = useCallback(async (input: { readonly offset?: number; readonly append?: boolean; readonly generation?: number } = {}) => {
    const append = input.append ?? false
    const generation = input.generation ?? shareLoadGenerationRef.current
    setShareState((current) => ({ ...current, loading: !append, loadingMore: append, error: null }))
    try {
      const result = await requireSynapseBridge().account.listDriveShares({
        offset: input.offset ?? 0,
        limit: DRIVE_PUBLIC_LINKS_PAGE_SIZE,
      })
      if (shareLoadGenerationRef.current !== generation) return
      setShareState((current) => ({
        items: append ? [...current.items, ...result.items] : [...result.items],
        page: result.page,
        loading: false,
        loadingMore: false,
        error: null,
        loaded: true,
      }))
    } catch (rawError) {
      if (shareLoadGenerationRef.current !== generation) return
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
    const generation = shareLoadGenerationRef.current + 1
    shareLoadGenerationRef.current = generation
    if (!open) {
      return
    }
    setShareFilter("file")
    setShareState(createEmptyDrivePublicLinksPageState<DriveShareListItemDto>())
    void loadShares({ generation })
  }, [loadShares, open])

  const reloadAfterPublicLinkChange = useCallback(async () => {
    await loadShares()
    await onDriveItemsChanged()
  }, [loadShares, onDriveItemsChanged])

  const handleDisableShare = useCallback(async (shareId: string) => {
    if (disablingShareIdsRef.current.has(shareId)) return
    setDisablingShareId(shareId, true)
    try {
      await requireSynapseBridge().account.disableDriveShare({ shareId })
      toast("已取消分享")
      await reloadAfterPublicLinkChange()
    } catch (rawError) {
      toast(errorMessage(rawError, "取消分享失败"))
    } finally {
      setDisablingShareId(shareId, false)
    }
  }, [disablingShareIdsRef, reloadAfterPublicLinkChange, setDisablingShareId])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="h-[36rem] max-h-[calc(100vh-2rem)] overflow-hidden p-0 sm:max-w-4xl"
        showCloseButton={false}
      >
        <form
          className="h-full min-h-0"
          onSubmit={(event) => event.preventDefault()}
        >
          <DialogFrame className="max-h-[calc(100vh-2rem)]">
            <DialogFrameHeader
              title="公开链接"
              data-testid="drive-public-links-dialog-header"
              center={(
                <Tabs value={shareFilter} onValueChange={(value) => setShareFilter(value as DrivePublicLinkFilter)} className="min-w-0">
                  <TabsList>
                    {DRIVE_PUBLIC_LINK_FILTERS.map((filter) => (
                      <TabsTrigger key={filter.value} value={filter.value} onClick={() => setShareFilter(filter.value)}>{filter.label}</TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
              )}
            />
            <DialogFrameBody>
              <ScrollArea className="h-full min-h-0">
                <div className="px-5 py-4">
                  <DrivePublicLinkList
                    emptyTitle="暂无分享"
                    error={shareState.error}
                    loading={shareState.loading}
                    loadingMore={shareState.loadingMore}
                    page={shareState.page}
                    shares={visibleShares}
                    onLoadMore={async () => {
                      if (shareState.page?.nextOffset === null || shareState.page?.nextOffset === undefined) return
                      await loadShares({ offset: shareState.page.nextOffset, append: true, generation: shareLoadGenerationRef.current })
                    }}
                    onRetry={loadShares}
                    onDisableShare={handleDisableShare}
                    disablingShareIds={disablingShareIds}
                  />
                </div>
              </ScrollArea>
            </DialogFrameBody>
            <DialogFrameFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>关闭</Button>
            </DialogFrameFooter>
          </DialogFrame>
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
  onDisableShare,
  disablingShareIds,
}: {
  readonly emptyTitle: string
  readonly error: string | null
  readonly loading: boolean
  readonly loadingMore: boolean
  readonly page: DriveBrowserChildrenPageDto | null
  readonly shares: readonly DriveShareListItemDto[]
  readonly onLoadMore: () => Promise<void>
  readonly onRetry: () => Promise<void>
  readonly onDisableShare: (shareId: string) => void
  readonly disablingShareIds: ReadonlySet<string>
}) {
  if (loading) return <DrivePublicLinkTableSkeleton />
  if (error) return <DriveDialogErrorState message={error} onRetry={onRetry} />
  if (shares.length === 0) return <DriveDialogEmptyState title={emptyTitle} />

  return (
    <div className="grid gap-3">
      <DriveShareList
        error={null}
        items={shares}
        loading={false}
        onReload={onRetry}
        onDisableShare={onDisableShare}
        disablingShareIds={disablingShareIds}
      />
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
        <TableHead>名称</TableHead>
        <TableHead>链接信息</TableHead>
        <TableHead className="text-right">操作</TableHead>
      </TableRow>
    </TableHeader>
  )
}

function DriveShareActions({
  disablingShare,
  item,
  onDisableShare,
}: {
  readonly disablingShare: boolean
  readonly item: DriveShareListItemDto
  readonly onDisableShare: (shareId: string) => void
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
        disabled={disablingShare}
        onClick={() => onDisableShare(item.id)}
      >
        {disablingShare ? <LoaderCircle className="animate-spin" /> : <X />}
      </DriveIconAction>
    </div>
  )
}

function DriveIconAction({
  children,
  disabled = false,
  label,
  onClick,
  tooltip,
}: {
  readonly children: ReactNode
  readonly disabled?: boolean
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
          disabled={disabled}
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
    <Table className="table-fixed">
      <DriveTableColumns columns={DRIVE_SHARE_TABLE_COLUMNS} />
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
        contentClassName="sm:max-w-lg"
        onSubmit={(event) => event.preventDefault()}
        footer={(
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>关闭</Button>
        )}
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="drive-share-success-url">访问链接</Label>
            <InputGroup>
              <InputGroupInput id="drive-share-success-url" className="font-mono text-sm" value={accessUrl} readOnly />
            </InputGroup>
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <Button type="button" size="sm" variant="outline" className="w-full sm:w-auto" onClick={() => { void copyDriveUrl(accessUrl) }}>
                复制链接
              </Button>
              <Button type="button" size="sm" variant="outline" className="w-full sm:w-auto" onClick={() => { void openDriveUrl(accessUrl) }}>
                {isFolder ? "打开文件夹" : "打开文件"}
              </Button>
            </div>
          </div>
          <dl className="grid overflow-hidden rounded-lg border text-sm sm:grid-cols-3">
            <div className="min-w-0 border-b p-3 sm:border-r sm:border-b-0">
              <dt className="font-medium">密码</dt>
              <dd className="mt-1 flex min-h-7 items-center justify-between gap-2 text-muted-foreground" title={formatDriveAccessPassword(share)}>
                <span className="min-w-0 truncate font-mono tabular-nums">{formatDriveAccessPassword(share)}</span>
                {password ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label="复制密码"
                    className="-mr-2"
                    onClick={() => { void copyDrivePassword(password) }}
                  >
                    复制
                  </Button>
                ) : null}
              </dd>
            </div>
            <div className="min-w-0 border-b p-3 sm:border-r sm:border-b-0">
              <dt className="font-medium">到期</dt>
              <dd className="mt-1 flex min-h-7 items-center truncate text-muted-foreground tabular-nums">
                <RelativeTime value={share.expiresAt} fallback="永久" className="truncate" />
              </dd>
            </div>
            <div className="min-w-0 p-3">
              <dt className="font-medium">权限</dt>
              <dd className="mt-1 flex min-h-7 items-center truncate text-muted-foreground" title={formatDriveShareAccessSummary(share)}>
                <span className="truncate">{formatDriveShareAccessSummary(share)}</span>
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
  disablingShareIds,
  onDisableShare,
  onReload,
}: {
  readonly error: string | null
  readonly items: readonly DriveShareListItemDto[]
  readonly loading: boolean
  readonly disablingShareIds: ReadonlySet<string>
  readonly onDisableShare: (shareId: string) => void
  readonly onReload: () => Promise<void>
}) {
  if (loading) return <DriveShareTableSkeleton />
  if (error) return <DriveDialogErrorState message={error} onRetry={onReload} />
  if (items.length === 0) return <DriveDialogEmptyState title="暂无分享" />

  return (
    <Table className="table-fixed">
      <DriveTableColumns columns={DRIVE_SHARE_TABLE_COLUMNS} />
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
                  <Badge variant="outline">{formatDriveShareAccessSummary(item)}</Badge>
                  <DriveSourceBadge sourceDeleted={item.sourceDeleted} />
                </div>
                <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs tabular-nums text-muted-foreground">
                  <span className="truncate">
                    到期 <RelativeTime value={item.expiresAt} fallback="永久" />
                  </span>
                  <span className="truncate">
                    时间 <RelativeTime value={item.createdAt} />
                  </span>
                </div>
              </div>
            </TableCell>
            <TableCell className="align-top">
              <DriveShareActions
                disablingShare={disablingShareIds.has(item.id)}
                item={item}
                onDisableShare={onDisableShare}
              />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
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
  const folders = new Map<string, { readonly files: DriveLocalUploadFolderItem["files"]; readonly directories: Set<string> }>()
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
    const folder = folders.get(folderName) ?? { files: [], directories: new Set<string>() }
    for (const directory of parentDirectoryPaths(fileRelativePath)) {
      folder.directories.add(directory)
    }
    folder.files.push({
      path,
      relativePath: fileRelativePath,
      mimeType: file.type || null,
    })
    folders.set(folderName, folder)
  }

  return {
    items: Array.from(folders.entries()).map(([folderName, folder]) => ({
      kind: "folder",
      folderName,
      directories: Array.from(folder.directories).map((relativePath) => ({ relativePath })),
      files: folder.files,
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
  const folder = await folderSnapshotFromDirectoryEntry(entry, maxFiles)
  const uploadFiles: DriveLocalUploadFolderItem["files"] = []
  const uploadDirectories: NonNullable<DriveLocalUploadFolderItem["directories"]> = []
  let skipped = 0

  for (const directory of folder.directories) {
    const relativePath = normalizeSlashRelativePath(directory)
    if (!relativePath) {
      skipped += 1
      continue
    }
    uploadDirectories.push({ relativePath })
  }

  for (const file of folder.files) {
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

  return {
    item: {
      kind: "folder",
      folderName: entry.name,
      directories: uploadDirectories,
      files: uploadFiles,
    },
    skipped,
  }
}

async function folderSnapshotFromDirectoryEntry(entry: DriveFileSystemDirectoryEntry, maxFiles = DRIVE_LOCAL_UPLOAD_MAX_FILES): Promise<{ readonly files: DriveDirectoryFile[]; readonly directories: string[] }> {
  const files: DriveDirectoryFile[] = []
  const directories: string[] = []
  await collectFilesFromDirectoryEntry({
    directories,
    entry,
    files,
    maxFiles,
    prefix: "",
    depth: 0,
  })
  return { files, directories }
}

async function collectFilesFromDirectoryEntry({
  directories,
  entry,
  files,
  maxFiles,
  prefix,
  depth,
}: {
  readonly directories: string[]
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
        const relativePath = `${prefix}${child.name}`
        directories.push(relativePath)
        await collectFilesFromDirectoryEntry({
          directories,
          entry: child,
          files,
          maxFiles,
          prefix: `${relativePath}/`,
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

function parentDirectoryPaths(relativePath: string): string[] {
  const parts = relativePath.split("/").filter(Boolean)
  return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join("/"))
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

async function copyDriveText(value: string, successMessage: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value)
    toast(successMessage)
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
  } catch {
    toast("分享成功，复制失败")
  }
}

function buildDriveItemPath(path: readonly DrivePathEntry[], itemName: string): string {
  const parts = [...path.slice(1).map((entry) => entry.name), itemName]
  return `/${parts.join("/")}`
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

function normalizeDriveEditorEmailForUi(value: string): string | null {
  const email = value.trim().toLowerCase()
  if (!email || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) return null
  return email
}

function driveShareSuccessFromListItem(item: DriveItemDto, share: DriveShareListItemDto): DriveShareSuccessState {
  return {
    name: item.name,
    type: item.type,
    url: share.url,
    urlWithPassword: share.urlWithPassword,
    passwordEnabled: share.passwordEnabled,
    password: share.password,
    expiresAt: share.expiresAt,
    accessMode: share.accessMode,
    editorEmails: share.editorEmails,
  }
}

async function openDriveUrl(url: string): Promise<void> {
  try {
    await requireSynapseBridge().shell.openExternal(url)
  } catch (rawError) {
    toast(errorMessage(rawError, "打开失败"))
  }
}

function readRelativeFilePath(file: File): string {
  const withDirectory = file as File & { webkitRelativePath?: string }
  return withDirectory.webkitRelativePath || file.name
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

function canOpenDriveItem(item: DriveItemDto): boolean {
  return item.storageStatus === "active"
}

function formatDriveItemShareSummary(item: DriveItemDto): string | null {
  if (!item.shared && !item.activeShareId) return null
  const activeShare = item.activeShare
  if (!activeShare) return "已分享"
  return [
    `分享：${formatDriveShareExpiresInline(activeShare.expiresAt)}`,
    activeShare.passwordEnabled ? "密码" : "无密码",
    formatDriveShareAccessModeLabel(activeShare.accessMode, activeShare.editorCount),
  ].join(" · ")
}

function formatDriveShareExpiresInline(value: string | null): string {
  if (!value) return "永久"
  const expiresAt = new Date(value)
  if (Number.isNaN(expiresAt.getTime())) return "到期时间未知"
  const remainingMs = expiresAt.getTime() - Date.now()
  if (remainingMs <= 0) return "已过期"
  if (remainingMs < 86_400_000) return "今天到期"
  const remainingDays = Math.ceil(remainingMs / 86_400_000)
  if (remainingDays >= 365) return "1年"
  return `${remainingDays}天`
}

function formatDriveAccessPassword(item: { readonly passwordEnabled?: boolean; readonly password?: string | null }): string {
  if (!item.passwordEnabled) return "无"
  return item.password || "无"
}

function formatDriveShareAccessModeLabel(accessMode: DriveShareAccessMode | undefined, editorCount = 0): string {
  if (accessMode === "link_edit") return "登录可编辑"
  if (accessMode === "specified_users_edit") return `${editorCount}人可编辑`
  return "可阅读"
}

function formatDriveShareAccessSummary(item: {
  readonly accessMode?: DriveShareAccessMode
  readonly editorEmails?: readonly string[]
}): string {
  return formatDriveShareAccessModeLabel(item.accessMode, item.editorEmails?.length ?? 0)
}

function uploadResultMessage(result: DriveLocalUploadResult): string {
  const completedLabel = formatUploadCompleted(result)
  if (result.failed === 0) {
    return result.skipped > 0
      ? `已上传 ${completedLabel}，跳过 ${result.skipped} 个`
      : `已上传 ${completedLabel}`
  }
  return result.message
    ? `上传完成 ${completedLabel}，失败 ${result.failed} 个：${result.message}`
    : `上传完成 ${completedLabel}，失败 ${result.failed} 个`
}

function withSkipped(result: DriveLocalUploadResult, skipped: number): DriveLocalUploadResult {
  if (skipped === 0) return result
  return { ...result, skipped: result.skipped + skipped }
}

function formatUploadCompleted(result: DriveLocalUploadResult): string {
  const parts: string[] = []
  if (result.completed > 0) parts.push(`${result.completed} 个文件`)
  if ((result.completedDirectories ?? 0) > 0) parts.push(`${result.completedDirectories} 个文件夹`)
  return parts.length > 0 ? parts.join("、") : "0 个文件"
}

function countDriveLocalUploadItems(items: readonly DriveLocalUploadItem[]): number {
  return items.reduce((count, item) => {
    if (item.kind !== "folder") return count + 1
    const childCount = item.files.length + (item.directories?.length ?? 0)
    return count + Math.max(1, childCount)
  }, 0)
}

function driveLoadError(error: unknown): DriveLoadError {
  const message = errorMessage(error, "加载失败")
  if (message.includes("账号未登录")) return { type: "auth" }
  return { type: "load", message }
}

export { DriveModule }
