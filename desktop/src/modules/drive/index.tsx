import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react"
import { toast } from "sonner"
import { ChevronRight, CircleUserRound, FileText, Folder, FolderPlus, LoaderCircle, MoreHorizontal, RefreshCw, Search, Upload } from "lucide-react"
import type { DriveItemDto, DriveUploadPrepareResult } from "@synapse/shared"
import { useAccount } from "@/app-shell/account"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import { FormDialog } from "@/components/form-dialog"
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
import { Dialog } from "@/components/ui/dialog"
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
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
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

const DRIVE_ROOT_PARENT_VALUE = "root"
const DRIVE_SKELETON_ROWS = Array.from({ length: 8 }, (_, index) => index)

function driveMoveTreeKey(parentId: string | null): string {
  return parentId ?? DRIVE_ROOT_PARENT_VALUE
}

function DriveModule() {
  const { pendingAction, startLogin, state: accountState } = useAccount()
  const [items, setItems] = useState<DriveItemDto[]>([])
  const [path, setPath] = useState<DrivePathEntry[]>([{ id: null, name: "根目录" }])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<DriveLoadError | null>(null)
  const [query, setQuery] = useState("")
  const [nameDialog, setNameDialog] = useState<NameDialogState | null>(null)
  const [moveTarget, setMoveTarget] = useState<DriveItemDto | null>(null)
  const [moveParentId, setMoveParentId] = useState<string>("root")
  const [deleteTarget, setDeleteTarget] = useState<DriveItemDto | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)

  const accountAuthenticated = accountState.status === "authenticated"
  const parentId = path.at(-1)?.id ?? null
  const loadItems = useCallback(async () => {
    if (!accountAuthenticated) return
    setLoading(true)
    setError(null)
    try {
      const nextItems = await requireSynapseBridge().account.listDriveItems({ parentId })
      setItems(nextItems)
    } catch (rawError) {
      setError(driveLoadError(rawError))
    } finally {
      setLoading(false)
    }
  }, [accountAuthenticated, parentId])

  useEffect(() => {
    if (!accountAuthenticated) {
      setItems([])
      setLoading(false)
      setError(null)
      setPath([{ id: null, name: "根目录" }])
      return
    }
    void loadItems()
  }, [accountAuthenticated, loadItems])

  const actionsDisabled = !accountAuthenticated || loading || error !== null

  const visibleItems = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return items
    return items.filter((item) => item.name.toLowerCase().includes(keyword))
  }, [items, query])

  const openFolder = useCallback((item: DriveItemDto) => {
    if (item.type !== "folder") return
    setPath((current) => [...current, { id: item.id, name: item.name }])
  }, [])

  const jumpToPath = useCallback((index: number) => {
    setPath((current) => current.slice(0, index + 1))
  }, [])

  const handleFileSelected = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? [])
    event.currentTarget.value = ""
    if (actionsDisabled) return
    if (files.length === 0) return
    const results = await uploadFiles(files, parentId)
    toast(uploadResultMessage(results))
    await loadItems()
  }, [actionsDisabled, loadItems, parentId])

  const handleFolderSelected = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? [])
    event.currentTarget.value = ""
    if (actionsDisabled) return
    if (files.length === 0) return
    const results = await uploadFolder(files, parentId)
    toast(uploadResultMessage(results))
    await loadItems()
  }, [actionsDisabled, loadItems, parentId])

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
      await requireSynapseBridge().account.deleteDriveItem({ itemId: deleteTarget.id })
      toast("已删除")
      setDeleteTarget(null)
      await loadItems()
    } catch (rawError) {
      toast(errorMessage(rawError, "删除失败"))
    } finally {
      setSubmitting(false)
    }
  }, [deleteTarget, loadItems])

  const handleShare = useCallback(async (item: DriveItemDto) => {
    try {
      const share = await requireSynapseBridge().account.shareDriveItem({ itemId: item.id })
      await navigator.clipboard.writeText(share.url)
      toast("链接已复制")
      await loadItems()
    } catch (rawError) {
      toast(errorMessage(rawError, "分享失败"))
    }
  }, [loadItems])

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
        items={visibleItems}
        loading={loading}
        path={path}
        query={query}
        onQueryChange={setQuery}
        onJumpToPath={jumpToPath}
        onOpenFolder={openFolder}
        onRename={handleRename}
        onMove={handleMove}
        onDelete={handleDelete}
        onShare={handleShare}
        onDisableShare={handleDisableShare}
      />
    )
  })()

  return (
    <TooltipProvider>
      <section className="flex h-full min-h-0 flex-col bg-surface">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b bg-background px-3 py-2">
          <h2 className="text-sm font-semibold">云盘</h2>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileSelected} />
            <input ref={folderInputRef} type="file" multiple className="hidden" onChange={handleFolderSelected} {...{ webkitdirectory: "" }} />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-sm" disabled={!accountAuthenticated || loading} onClick={() => void loadItems()}>
                  <RefreshCw />
                  <span className="sr-only">刷新</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>刷新</TooltipContent>
            </Tooltip>
            <Button variant="outline" size="sm" disabled={actionsDisabled} onClick={() => fileInputRef.current?.click()}>
              <Upload data-icon="inline-start" />
              上传文件
            </Button>
            <Button variant="outline" size="sm" disabled={actionsDisabled} onClick={() => folderInputRef.current?.click()}>
              <Upload data-icon="inline-start" />
              上传文件夹
            </Button>
            <Button variant="outline" size="sm" disabled={actionsDisabled} onClick={handleCreateFolder}>
              <FolderPlus data-icon="inline-start" />
              新建文件夹
            </Button>
          </div>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <div className="min-h-full px-3 py-3">{content}</div>
        </ScrollArea>
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
        if (!open) setDeleteTarget(null)
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              删除后无法在云盘中继续访问「{deleteTarget?.name}」。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>取消</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={submitting} onClick={() => { void confirmDelete() }}>删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      </section>
    </TooltipProvider>
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
  path,
  query,
  onQueryChange,
  onJumpToPath,
  onOpenFolder,
  onRename,
  onMove,
  onDelete,
  onShare,
  onDisableShare,
}: {
  readonly items: readonly DriveItemDto[]
  readonly loading: boolean
  readonly path: readonly DrivePathEntry[]
  readonly query: string
  readonly onQueryChange: (value: string) => void
  readonly onJumpToPath: (index: number) => void
  readonly onOpenFolder: (item: DriveItemDto) => void
  readonly onRename: (item: DriveItemDto) => void
  readonly onMove: (item: DriveItemDto) => void
  readonly onDelete: (item: DriveItemDto) => void
  readonly onShare: (item: DriveItemDto) => void
  readonly onDisableShare: (item: DriveItemDto) => void
}) {
  const emptyTitle = query.trim() ? "没有匹配项" : "暂无文件"

  return (
    <div className="flex min-h-full flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <DriveBreadcrumbs path={path} onJumpToPath={onJumpToPath} />
        <InputGroup className="w-56">
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="搜索"
            aria-label="搜索"
          />
        </InputGroup>
      </div>

      {loading ? (
        <DriveFileTableSkeleton />
      ) : items.length === 0 ? (
        <Empty className="min-h-64 border-0">
          <EmptyHeader>
            <EmptyTitle>{emptyTitle}</EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : (
        <Table className="min-w-[760px] table-fixed">
          <DriveFileTableHeader />
          <TableBody>
            {items.map((item) => (
              <DriveFileListRow
                key={item.id}
                item={item}
                onOpenFolder={onOpenFolder}
                onRename={onRename}
                onMove={onMove}
                onDelete={onDelete}
                onShare={onShare}
                onDisableShare={onDisableShare}
              />
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}

function DriveFileTableHeader() {
  return (
    <TableHeader>
      <TableRow>
        <TableHead>名称</TableHead>
        <TableHead className="w-24">状态</TableHead>
        <TableHead className="w-28 text-right">大小</TableHead>
        <TableHead className="w-44 text-right">更新时间</TableHead>
        <TableHead className="w-48 text-right">操作</TableHead>
      </TableRow>
    </TableHeader>
  )
}

function DriveFileTableSkeleton() {
  return (
    <Table className="min-w-[760px] table-fixed">
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
              <Skeleton className="h-5 w-16" />
            </TableCell>
            <TableCell>
              <Skeleton className="ml-auto h-4 w-16" />
            </TableCell>
            <TableCell>
              <Skeleton className="ml-auto h-4 w-32" />
            </TableCell>
            <TableCell>
              <Skeleton className="ml-auto h-7 w-32" />
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
  onOpenFolder,
  onRename,
  onMove,
  onDelete,
  onShare,
  onDisableShare,
}: {
  readonly item: DriveItemDto
  readonly onOpenFolder: (item: DriveItemDto) => void
  readonly onRename: (item: DriveItemDto) => void
  readonly onMove: (item: DriveItemDto) => void
  readonly onDelete: (item: DriveItemDto) => void
  readonly onShare: (item: DriveItemDto) => void
  readonly onDisableShare: (item: DriveItemDto) => void
}) {
  const status = driveStatusLabel(item)
  const statusVariant = driveStatusBadgeVariant(item)
  const isFolder = item.type === "folder"

  return (
    <TableRow
      className={isFolder ? "cursor-pointer" : undefined}
      onClick={isFolder ? () => onOpenFolder(item) : undefined}
    >
      <TableCell className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          {isFolder ? (
            <Folder className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          ) : (
            <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          )}
          {isFolder ? (
            <Button
              type="button"
              variant="ghost"
              className="h-auto min-w-0 max-w-full justify-start px-0 py-0 font-medium hover:bg-transparent"
              aria-label={`打开文件夹 ${item.name}`}
              title={item.name}
              onClick={(event) => {
                event.stopPropagation()
                onOpenFolder(item)
              }}
            >
              <span className="truncate">{item.name}</span>
            </Button>
          ) : (
            <span className="block min-w-0 truncate font-medium" title={item.name}>
              <span className="sr-only">文件 </span>
              {item.name}
            </span>
          )}
        </div>
      </TableCell>
      <TableCell>
        {status ? <Badge variant={statusVariant}>{status}</Badge> : null}
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
          <Button type="button" variant="ghost" size="sm" onClick={() => onShare(item)}>
            分享
          </Button>
          <Button type="button" variant="destructive" size="sm" onClick={() => onDelete(item)}>
            删除
          </Button>
          <DriveItemMenu
            item={item}
            onRename={onRename}
            onMove={onMove}
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
  onDisableShare,
}: {
  readonly item: DriveItemDto
  readonly onRename: (item: DriveItemDto) => void
  readonly onMove: (item: DriveItemDto) => void
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
        <DropdownMenuGroup>
          {item.activeShareId ? (
            <DropdownMenuItem onClick={() => onDisableShare(item)}>取消分享</DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onClick={() => onRename(item)}>重命名</DropdownMenuItem>
          <DropdownMenuItem onClick={() => onMove(item)}>移动</DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

type UploadResult = {
  readonly completed: number
  readonly failed: number
  readonly error?: string
}

async function uploadFiles(files: readonly File[], parentId: string | null): Promise<UploadResult> {
  let completed = 0
  let failed = 0
  let error: string | undefined
  for (const file of files) {
    try {
      const prepared = await requireSynapseBridge().account.prepareDriveUpload({
        parentId,
        name: file.name,
        size: String(file.size),
        mimeType: file.type || null,
      })
      await uploadPreparedFile(prepared, file)
      await requireSynapseBridge().account.completeDriveUpload({ sessionId: prepared.sessionId })
      completed += 1
    } catch (rawError) {
      error ??= errorMessage(rawError, "上传失败")
      failed += 1
    }
  }
  return { completed, error, failed }
}

async function uploadFolder(files: readonly File[], parentId: string | null): Promise<UploadResult> {
  const withPaths = files.map((file) => ({ file, path: readRelativeFilePath(file) }))
  const firstPath = withPaths[0]?.path ?? "上传文件夹"
  const folderName = firstPath.split("/")[0] || "上传文件夹"
  const prepared = await requireSynapseBridge().account.prepareDriveFolderUpload({
    parentId,
    folderName,
    files: withPaths.map(({ file, path }) => ({
      relativePath: path.split("/").slice(1).join("/") || file.name,
      size: String(file.size),
      mimeType: file.type || null,
    })),
  })
  const entriesByPath = new Map(prepared.entries.map((entry) => [entry.relativePath, entry]))
  let completed = 0
  let failed = 0
  let error: string | undefined
  for (const { file, path } of withPaths) {
    const relativePath = path.split("/").slice(1).join("/") || file.name
    const entry = entriesByPath.get(relativePath)
    if (!entry) {
      error ??= "上传文件不存在"
      failed += 1
      continue
    }
    try {
      await uploadPreparedFile(entry, file)
      await requireSynapseBridge().account.completeDriveUpload({ sessionId: entry.sessionId })
      completed += 1
    } catch (rawError) {
      error ??= errorMessage(rawError, "上传失败")
      failed += 1
    }
  }
  return { completed, error, failed }
}

async function uploadPreparedFile(prepared: Pick<DriveUploadPrepareResult, "upload">, file: File): Promise<void> {
  await requireSynapseBridge().account.uploadDrivePreparedFile({
    body: await file.arrayBuffer(),
    method: prepared.upload.method,
    url: prepared.upload.url,
    headers: prepared.upload.headers,
  })
}

function readRelativeFilePath(file: File): string {
  const withDirectory = file as File & { webkitRelativePath?: string }
  return withDirectory.webkitRelativePath || file.name
}

function formatBytes(value: string): string {
  const bytes = Number(value)
  if (!Number.isFinite(bytes)) return "-"
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
}

function driveStatusLabel(item: DriveItemDto): string {
  if (item.shared) return "已分享"
  if (item.storageStatus === "pending") return "上传中"
  if (item.storageStatus === "failed") return "上传失败"
  if (item.storageStatus === "delete_pending") return "删除中"
  return ""
}

function driveStatusBadgeVariant(item: DriveItemDto): "secondary" | "destructive" | "outline" {
  if (item.storageStatus === "failed") return "destructive"
  if (item.shared) return "secondary"
  return "outline"
}

function formatDriveDateTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "-"
  return date.toLocaleString("zh-CN")
}

function uploadResultMessage(result: UploadResult): string {
  if (result.failed === 0) return `已上传 ${result.completed} 个文件`
  return result.error
    ? `上传完成 ${result.completed} 个，失败 ${result.failed} 个：${result.error}`
    : `上传完成 ${result.completed} 个，失败 ${result.failed} 个`
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
