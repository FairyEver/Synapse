import {
  Alert,
  Button,
  buttonVariants,
  Chip,
  Input,
  ListBox,
  Select,
  Skeleton,
  Tabs,
  toast,
} from '@heroui/react'
import {
  useInfiniteQuery,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import {
  isDriveTextDiffPreviewKind,
  type DriveFileVersionContentDto,
  type DriveFileVersionDto,
} from '@synapse/shared'
import {
  Download,
  FileText,
  GitCompareArrows,
  Loader2,
  RotateCcw,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { RelativeTime } from '@/components/relative-time'
import { useDocumentTitle } from '@/hooks/use-document-title'
import { cn } from '@/lib/utils'
import { formatDriveBrowserBytes } from '../shared/drive-format'
import {
  trackedDriveBrowserApi as driveBrowserApi,
  trackedDriveFileVersionsApi as driveFileVersionsApi,
} from '../shared/drive-telemetry-api'
import { DriveTelemetryBoundary } from '../shared/drive-telemetry-boundary'
import {
  computeLineDiff,
  getDiffStats,
  type DiffLineOp,
} from './change-history-diff'
import {
  driveChangeSourceLabel,
  EMPTY_BASE_VERSION_ID,
  filterChangeHistoryVersions,
  findPreviousComparableVersion,
  resolveRangeCumulativeBounds,
  toLocalCalendarDate,
  type ChangeHistoryDiffStyle,
  type ChangeHistoryFeedOrder,
  type ChangeHistoryFilterState,
  type ChangeHistorySourceFilter,
  type ChangeHistoryTimePreset,
  type ChangeHistoryViewMode,
} from './change-history-model'
import { DriveChangeHistoryDiffView } from './drive-change-history-diff-view'

const VERSION_PAGE_SIZE = 100
const FEED_BATCH_SIZE = 10

const TIME_PRESETS: ReadonlyArray<{
  readonly id: ChangeHistoryTimePreset
  readonly label: string
}> = [
  { id: 'all', label: '创建至今' },
  { id: '7d', label: '近 7 天' },
  { id: '14d', label: '近 14 天' },
  { id: '30d', label: '近 30 天' },
  { id: 'custom', label: '自定义时间段' },
]

const SOURCE_OPTIONS: ReadonlyArray<{
  readonly id: ChangeHistorySourceFilter
  readonly label: string
}> = [
  { id: 'all', label: '全部来源' },
  { id: 'online_edit', label: '编辑' },
  { id: 'collaboration', label: '协同编辑' },
  { id: 'upload', label: '上传' },
  { id: 'restore', label: '恢复' },
]

export function DriveChangeHistoryPage({
  itemId,
}: {
  readonly itemId: string
}) {
  return (
    <DriveTelemetryBoundary scope='owner'>
      <DriveChangeHistoryPageContent itemId={itemId} />
    </DriveTelemetryBoundary>
  )
}

function DriveChangeHistoryPageContent({
  itemId,
}: {
  readonly itemId: string
}) {
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<ChangeHistoryViewMode>('single')
  const [filter, setFilter] = useState<ChangeHistoryFilterState>(() => ({
    preset: 'all',
    dateFrom: '',
    dateTo: toLocalCalendarDate(new Date()),
    source: 'all',
  }))
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null)
  const [baseVersionId, setBaseVersionId] = useState<string>(EMPTY_BASE_VERSION_ID)
  const [targetVersionId, setTargetVersionId] = useState<string | null>(null)
  const [diffStyle, setDiffStyle] = useState<ChangeHistoryDiffStyle>('unified')
  const [showFull, setShowFull] = useState(false)
  const [feedOrder, setFeedOrder] = useState<ChangeHistoryFeedOrder>('desc')
  const [feedLimit, setFeedLimit] = useState(FEED_BATCH_SIZE)
  const [expandedGapKeys, setExpandedGapKeys] = useState<ReadonlySet<string>>(
    () => new Set()
  )
  const [restoreTarget, setRestoreTarget] = useState<DriveFileVersionDto | null>(
    null
  )

  const itemQuery = useQuery({
    queryKey: ['drive-change-history-item', itemId],
    queryFn: () => driveBrowserApi.getOwnerItem(itemId, 'standalone'),
  })

  const item = itemQuery.data?.current ?? null
  const supportsTextDiff =
    item !== null &&
    item.type === 'file' &&
    isDriveTextDiffPreviewKind(item.previewKind)

  useDocumentTitle(item ? `${item.name} · 变更历史` : '变更历史')

  const versionsQuery = useInfiniteQuery({
    queryKey: ['drive-file-versions', itemId],
    queryFn: ({ pageParam }) =>
      driveFileVersionsApi.list(itemId, {
        offset: pageParam,
        limit: VERSION_PAGE_SIZE,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.page.nextOffset ?? undefined,
    enabled: Boolean(item && item.type === 'file'),
  })

  const allVersionsDesc = useMemo(
    () => versionsQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [versionsQuery.data]
  )
  const totalVersionCount =
    versionsQuery.data?.pages[0]?.total ?? allVersionsDesc.length

  const versionById = useMemo(
    () => new Map(allVersionsDesc.map((version) => [version.id, version])),
    [allVersionsDesc]
  )

  const filteredVersionsDesc = useMemo(
    () => filterChangeHistoryVersions(allVersionsDesc, filter),
    [allVersionsDesc, filter]
  )

  const comparableAllDesc = useMemo(
    () => allVersionsDesc.filter((version) => !version.deletePending),
    [allVersionsDesc]
  )

  const comparableFilteredDesc = useMemo(
    () => filteredVersionsDesc.filter((version) => !version.deletePending),
    [filteredVersionsDesc]
  )

  // Keep selectedVersionId synchronized with available filtered versions.
  const activeSelectedId = useMemo(() => {
    if (
      selectedVersionId &&
      comparableFilteredDesc.some((version) => version.id === selectedVersionId)
    ) {
      return selectedVersionId
    }
    return comparableFilteredDesc[0]?.id ?? null
  }, [comparableFilteredDesc, selectedVersionId])

  // Keep range endpoints synchronized when versions load.
  useEffect(() => {
    if (comparableAllDesc.length === 0) return
    if (targetVersionId && versionById.has(targetVersionId)) return
    const latest = comparableAllDesc[0]!
    const prev = findPreviousComparableVersion(allVersionsDesc, latest.id)
    setTargetVersionId(latest.id)
    setBaseVersionId(prev ? prev.id : EMPTY_BASE_VERSION_ID)
  }, [allVersionsDesc, comparableAllDesc, targetVersionId, versionById])

  // Reset feed pagination when filter or ordering changes.
  useEffect(() => {
    setFeedLimit(FEED_BATCH_SIZE)
  }, [filter, feedOrder])

  const activeTargetId =
    targetVersionId && versionById.has(targetVersionId)
      ? targetVersionId
      : comparableAllDesc[0]?.id ?? null

  const activeBaseId =
    baseVersionId === EMPTY_BASE_VERSION_ID || versionById.has(baseVersionId)
      ? baseVersionId
      : EMPTY_BASE_VERSION_ID

  const visibleFeedVersions = useMemo(() => {
    const ordered =
      feedOrder === 'desc'
        ? comparableFilteredDesc
        : [...comparableFilteredDesc].reverse()
    return ordered.slice(0, feedLimit)
  }, [comparableFilteredDesc, feedLimit, feedOrder])

  // Collect exact immutable version IDs needed for the active view.
  const neededVersionIds = useMemo(() => {
    if (!supportsTextDiff) return [] as string[]
    const ids = new Set<string>()
    if (mode === 'single' && activeSelectedId) {
      ids.add(activeSelectedId)
      const prev = findPreviousComparableVersion(allVersionsDesc, activeSelectedId)
      if (prev) ids.add(prev.id)
    } else if (mode === 'range') {
      if (activeBaseId !== EMPTY_BASE_VERSION_ID) ids.add(activeBaseId)
      if (activeTargetId) ids.add(activeTargetId)
    } else if (mode === 'feed') {
      for (const version of visibleFeedVersions) {
        ids.add(version.id)
        const prev = findPreviousComparableVersion(allVersionsDesc, version.id)
        if (prev) ids.add(prev.id)
      }
    }
    return [...ids]
  }, [
    activeBaseId,
    activeSelectedId,
    activeTargetId,
    allVersionsDesc,
    mode,
    supportsTextDiff,
    visibleFeedVersions,
  ])

  const contentQueries = useQueries({
    queries: neededVersionIds.map((versionId) => ({
      queryKey: ['drive-file-version-content', itemId, versionId] as const,
      queryFn: () => driveFileVersionsApi.getContent(itemId, versionId),
      staleTime: Number.POSITIVE_INFINITY,
      gcTime: 1000 * 60 * 30,
      retry: false,
    })),
  })

  const contentStateById = useMemo(() => {
    const map = new Map<
      string,
      {
        readonly data: DriveFileVersionContentDto | undefined
        readonly isLoading: boolean
        readonly error: string | null
        readonly refetch: () => void
      }
    >()
    neededVersionIds.forEach((versionId, index) => {
      const query = contentQueries[index]
      map.set(versionId, {
        data: query?.data,
        isLoading: Boolean(query?.isLoading),
        error: query?.error instanceof Error ? query.error.message : null,
        refetch: () => {
          void query?.refetch()
        },
      })
    })
    return map
  }, [contentQueries, neededVersionIds])

  const restoreMutation = useMutation({
    mutationFn: (versionId: string) =>
      driveFileVersionsApi.restore(itemId, versionId),
    onSuccess: () => {
      setRestoreTarget(null)
      void queryClient.invalidateQueries({
        queryKey: ['drive-file-versions', itemId],
      })
      void queryClient.invalidateQueries({
        queryKey: ['drive-change-history-item', itemId],
      })
      toast.success('已恢复为当前版本')
    },
    onError: (error: Error) => toast.danger(error.message),
  })

  const handleExpandGap = (gapKey: string) => {
    setExpandedGapKeys((prev) => {
      const next = new Set(prev)
      next.add(gapKey)
      return next
    })
  }

  const handleApplyCumulativeRange = () => {
    const bounds = resolveRangeCumulativeBounds(
      allVersionsDesc,
      filteredVersionsDesc
    )
    if (!bounds) return
    setBaseVersionId(bounds.baseVersionId)
    setTargetVersionId(bounds.targetVersionId)
    setMode('range')
  }

  const handleSelectTimelineVersion = (version: DriveFileVersionDto) => {
    if (version.deletePending) return
    if (mode === 'single') {
      setSelectedVersionId(version.id)
      return
    }
    if (mode === 'range') {
      const baseNum =
        activeBaseId === EMPTY_BASE_VERSION_ID
          ? 0
          : (versionById.get(activeBaseId)?.versionNumber ?? 0)
      if (version.versionNumber <= baseNum) {
        setBaseVersionId(version.id)
      } else {
        setTargetVersionId(version.id)
      }
      return
    }
    const card = document.getElementById(`change-feed-${version.id}`)
    card?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  if (itemQuery.isLoading) {
    return (
      <div className='min-h-screen bg-background'>
        <div className='border-b border-separator bg-surface px-6 py-4'>
          <Skeleton className='h-6 w-64' />
        </div>
        <div className='mx-auto grid max-w-[1440px] gap-4 p-6 lg:grid-cols-[320px_minmax(0,1fr)]'>
          <Skeleton className='h-96 rounded-2xl' />
          <Skeleton className='h-96 rounded-2xl' />
        </div>
      </div>
    )
  }

  if (itemQuery.error instanceof Error || !item) {
    return (
      <div className='flex min-h-screen items-center justify-center bg-background p-6'>
        <div className='w-full max-w-md'>
          <Alert status='danger'>
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>无法加载变更历史</Alert.Title>
              <Alert.Description>
                <p>
                  {itemQuery.error instanceof Error
                    ? itemQuery.error.message
                    : '文档不存在或无权访问。'}
                </p>
                <div className='mt-3'>
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    onPress={() => void itemQuery.refetch()}
                  >
                    重试
                  </Button>
                </div>
              </Alert.Description>
            </Alert.Content>
          </Alert>
        </div>
      </div>
    )
  }

  if (!supportsTextDiff) {
    return (
      <div className='min-h-screen bg-background'>
        <header className='border-b border-separator bg-surface px-6 py-3'>
          <div className='mx-auto flex max-w-[1440px] items-center gap-3'>
            <div className='flex size-8 shrink-0 items-center justify-center rounded-xl bg-surface-secondary text-foreground'>
              <FileText className='size-4' aria-hidden />
            </div>
            <h1 className='truncate text-base font-semibold text-foreground'>
              {item.name}
            </h1>
            <Chip variant='secondary'>变更历史</Chip>
          </div>
        </header>
        <main className='mx-auto max-w-2xl p-6'>
          <Alert>
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>该文件类型不支持文本变更对比</Alert.Title>
              <Alert.Description>
                当前仅支持 Markdown、纯文本与 HTML 源码类文档查看逐行变更历史。
              </Alert.Description>
            </Alert.Content>
          </Alert>
        </main>
      </div>
    )
  }

  const baseNum =
    activeBaseId === EMPTY_BASE_VERSION_ID
      ? 0
      : (versionById.get(activeBaseId)?.versionNumber ?? 0)
  const targetNum =
    activeTargetId ? (versionById.get(activeTargetId)?.versionNumber ?? 0) : 0
  const rangeLow = Math.min(baseNum, targetNum)
  const rangeHigh = Math.max(baseNum, targetNum)

  return (
    <div className='flex min-h-screen flex-col bg-background text-foreground'>
      {/* Sticky Header (no back button; opens as dedicated page) */}
      <header className='sticky top-0 z-20 border-b border-separator bg-surface px-4 py-3 md:px-6'>
        <div className='mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3'>
          <div className='flex min-w-0 items-center gap-2.5'>
            <div className='flex size-8 shrink-0 items-center justify-center rounded-xl bg-surface-secondary text-foreground'>
              <FileText className='size-4' aria-hidden />
            </div>
            <h1 className='min-w-0 truncate text-base font-semibold text-foreground'>
              {item.name}
            </h1>
            <Chip variant='secondary'>变更历史</Chip>
          </div>

          <Tabs
            selectedKey={mode}
            onSelectionChange={(key) =>
              setMode(String(key) as ChangeHistoryViewMode)
            }
          >
            <Tabs.ListContainer>
              <Tabs.List aria-label='变更查看模式'>
                <Tabs.Tab id='single'>
                  单次修改
                  <Tabs.Indicator />
                </Tabs.Tab>
                <Tabs.Tab id='range'>
                  范围对比
                  <Tabs.Indicator />
                </Tabs.Tab>
                <Tabs.Tab id='feed'>
                  按次总览
                  <Tabs.Indicator />
                </Tabs.Tab>
              </Tabs.List>
            </Tabs.ListContainer>
          </Tabs>
        </div>
      </header>

      {/* Filter Bar (on bg-background -> form controls use default primary variant) */}
      <div className='border-b border-separator bg-background px-4 py-2.5 md:px-6'>
        <div className='mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3'>
          <div className='flex flex-wrap items-center gap-2.5'>
            <div
              role='group'
              aria-label='时间段筛选'
              className='flex flex-wrap items-center gap-1 rounded-full bg-surface-secondary p-1'
            >
              {TIME_PRESETS.map((preset) => {
                const active = filter.preset === preset.id
                return (
                  <Button
                    key={preset.id}
                    type='button'
                    size='sm'
                    variant={active ? 'outline' : 'ghost'}
                    aria-pressed={active}
                    className={cn(
                      'h-7 rounded-full px-3 text-xs',
                      active && 'bg-surface font-medium shadow-surface'
                    )}
                    onPress={() =>
                      setFilter((prev) => ({
                        ...prev,
                        preset: preset.id,
                      }))
                    }
                  >
                    {preset.label}
                  </Button>
                )
              })}
            </div>

            {filter.preset === 'custom' ? (
              <div className='flex flex-wrap items-center gap-1.5 text-xs text-muted'>
                <Input
                  type='date'
                  aria-label='开始日期'
                  value={filter.dateFrom}
                  onChange={(event) =>
                    setFilter((prev) => ({
                      ...prev,
                      dateFrom: event.target.value,
                    }))
                  }
                  className='h-8 w-36 tabular-nums'
                />
                <span>至</span>
                <Input
                  type='date'
                  aria-label='结束日期'
                  value={filter.dateTo}
                  onChange={(event) =>
                    setFilter((prev) => ({
                      ...prev,
                      dateTo: event.target.value,
                    }))
                  }
                  className='h-8 w-36 tabular-nums'
                />
              </div>
            ) : null}

            <Select
              aria-label='变更来源筛选'
              className='w-32'
              value={filter.source}
              onChange={(value) =>
                setFilter((prev) => ({
                  ...prev,
                  source: String(value ?? 'all') as ChangeHistorySourceFilter,
                }))
              }
            >
              <Select.Trigger className='h-8'>
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  {SOURCE_OPTIONS.map((option) => (
                    <ListBox.Item
                      key={option.id}
                      id={option.id}
                      textValue={option.label}
                    >
                      {option.label}
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>
          </div>

          <div className='flex flex-wrap items-center gap-3'>
            <span className='text-xs tabular-nums text-muted'>
              命中 {filteredVersionsDesc.length} / {totalVersionCount} 个版本
            </span>
            <Button
              type='button'
              variant='secondary'
              size='sm'
              isDisabled={comparableFilteredDesc.length === 0}
              onPress={handleApplyCumulativeRange}
            >
              <GitCompareArrows className='size-4' aria-hidden />
              查看该时段累计变更
            </Button>
          </div>
        </div>
      </div>

      {/* Main Workspace */}
      <main className='mx-auto grid w-full max-w-[1440px] flex-1 items-start gap-4 px-4 py-4 md:px-6 lg:grid-cols-[328px_minmax(0,1fr)]'>
        {/* Left Commit Timeline Rail */}
        <aside
          aria-label='版本时间线'
          className='flex flex-col overflow-hidden rounded-2xl border border-separator bg-surface shadow-surface lg:sticky lg:top-[76px] lg:max-h-[calc(100vh-96px)]'
        >
          <div className='flex items-center justify-between gap-2 border-b border-separator px-4 py-3'>
            <span className='text-sm font-semibold tabular-nums text-foreground'>
              变更时间线（{filteredVersionsDesc.length}）
            </span>
            {mode === 'feed' ? (
              <Button
                type='button'
                variant='ghost'
                size='sm'
                onPress={() =>
                  setFeedOrder((prev) => (prev === 'desc' ? 'asc' : 'desc'))
                }
              >
                {feedOrder === 'desc' ? '最新在前' : '从创建开始'}
              </Button>
            ) : null}
          </div>

          {mode === 'range' && comparableAllDesc.length > 0 ? (
            <div className='grid gap-2 border-b border-separator bg-surface-secondary p-3'>
              <div className='grid grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-2'>
                <span className='text-xs text-muted'>基准</span>
                <Select
                  aria-label='选择基准版本'
                  value={activeBaseId}
                  onChange={(value) =>
                    setBaseVersionId(String(value ?? EMPTY_BASE_VERSION_ID))
                  }
                >
                  <Select.Trigger className='h-8'>
                    <Select.Value />
                    <Select.Indicator />
                  </Select.Trigger>
                  <Select.Popover>
                    <ListBox>
                      <ListBox.Item
                        id={EMPTY_BASE_VERSION_ID}
                        textValue='空白（创建前）'
                      >
                        空白（创建前）
                        <ListBox.ItemIndicator />
                      </ListBox.Item>
                      {comparableAllDesc.map((version) => {
                        const label = `v${version.versionNumber} · ${toLocalCalendarDate(version.createdAt)}（${driveChangeSourceLabel(version.source)}）`
                        return (
                          <ListBox.Item
                            key={version.id}
                            id={version.id}
                            textValue={label}
                          >
                            {label}
                            <ListBox.ItemIndicator />
                          </ListBox.Item>
                        )
                      })}
                    </ListBox>
                  </Select.Popover>
                </Select>
              </div>
              <div className='grid grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-2'>
                <span className='text-xs text-muted'>目标</span>
                <Select
                  aria-label='选择目标版本'
                  value={activeTargetId ?? undefined}
                  onChange={(value) => {
                    if (value) setTargetVersionId(String(value))
                  }}
                >
                  <Select.Trigger className='h-8'>
                    <Select.Value />
                    <Select.Indicator />
                  </Select.Trigger>
                  <Select.Popover>
                    <ListBox>
                      {comparableAllDesc.map((version) => {
                        const label = `v${version.versionNumber} · ${toLocalCalendarDate(version.createdAt)}${version.isCurrent ? '（当前）' : ''}`
                        return (
                          <ListBox.Item
                            key={version.id}
                            id={version.id}
                            textValue={label}
                          >
                            {label}
                            <ListBox.ItemIndicator />
                          </ListBox.Item>
                        )
                      })}
                    </ListBox>
                  </Select.Popover>
                </Select>
              </div>
            </div>
          ) : null}

          {versionsQuery.isLoading ? (
            <div className='grid gap-2 p-3'>
              <Skeleton className='h-14 rounded-xl' />
              <Skeleton className='h-14 rounded-xl' />
              <Skeleton className='h-14 rounded-xl' />
            </div>
          ) : versionsQuery.error instanceof Error &&
            allVersionsDesc.length === 0 ? (
            <div className='grid gap-2 p-4 text-center text-sm'>
              <span className='text-danger'>{versionsQuery.error.message}</span>
              <div>
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  onPress={() => void versionsQuery.refetch()}
                >
                  重试
                </Button>
              </div>
            </div>
          ) : filteredVersionsDesc.length === 0 ? (
            <div className='px-4 py-8 text-center text-sm text-muted'>
              当前筛选条件下没有变更记录
            </div>
          ) : (
            <ul className='m-0 flex list-none flex-col gap-0.5 overflow-y-auto p-2'>
              {filteredVersionsDesc.map((version, index) => {
                const isSelected =
                  mode === 'single' && version.id === activeSelectedId
                const isEndpoint =
                  mode === 'range' &&
                  (version.id === activeBaseId || version.id === activeTargetId)
                const isInRange =
                  mode === 'range' &&
                  !isEndpoint &&
                  version.versionNumber > rangeLow &&
                  version.versionNumber < rangeHigh
                const restoredFrom = version.restoredFromVersionId
                  ? versionById.get(version.restoredFromVersionId)
                  : null
                const isFirst = index === 0
                const isLast = index === filteredVersionsDesc.length - 1
                return (
                  <li key={version.id} className='relative'>
                    <span
                      aria-hidden
                      className={cn(
                        'pointer-events-none absolute left-3.5 w-px bg-separator',
                        isFirst ? 'top-4' : 'top-0',
                        isLast ? 'bottom-[calc(100%-1rem)]' : 'bottom-0'
                      )}
                    />
                    <button
                      type='button'
                      disabled={version.deletePending}
                      aria-current={isSelected ? 'true' : undefined}
                      onClick={() => handleSelectTimelineVersion(version)}
                      className={cn(
                        'relative flex w-full flex-col gap-1 rounded-xl border border-transparent py-2.5 pr-3 pl-7 text-left transition-colors',
                        'hover:bg-surface-secondary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
                        'disabled:cursor-not-allowed disabled:opacity-50',
                        isSelected && 'border-accent/30 bg-accent-soft',
                        isEndpoint && 'border-accent/40 bg-accent-soft',
                        isInRange && 'bg-accent-soft/40'
                      )}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          'pointer-events-none absolute top-3.5 left-2.5 size-2 rounded-full border-2 bg-surface',
                          isSelected || isEndpoint
                            ? 'border-accent bg-accent'
                            : isInRange
                              ? 'border-accent'
                              : 'border-muted'
                        )}
                      />
                      <div className='flex items-center justify-between gap-2'>
                        <div className='flex min-w-0 flex-wrap items-center gap-1.5'>
                          <span className='text-sm font-semibold tabular-nums text-foreground'>
                            v{version.versionNumber}
                          </span>
                          {version.isCurrent ? (
                            <Chip size='sm'>当前</Chip>
                          ) : null}
                          <Chip variant='secondary' size='sm'>
                            {driveChangeSourceLabel(version.source)}
                          </Chip>
                          {version.deletePending ? (
                            <Chip variant='soft' size='sm'>
                              待清理
                            </Chip>
                          ) : null}
                        </div>
                        <span className='shrink-0 text-xs tabular-nums text-muted'>
                          {formatDriveBrowserBytes(version.size)}
                        </span>
                      </div>
                      <div className='flex flex-wrap items-center gap-1.5 text-xs tabular-nums text-muted'>
                        <RelativeTime value={version.createdAt} />
                        <span>·</span>
                        <span>{toLocalCalendarDate(version.createdAt)}</span>
                        {restoredFrom ? (
                          <>
                            <span>·</span>
                            <span>恢复自 v{restoredFrom.versionNumber}</span>
                          </>
                        ) : null}
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}

          {versionsQuery.hasNextPage ? (
            <div className='border-t border-separator p-2.5 text-center'>
              <Button
                type='button'
                variant='outline'
                size='sm'
                isDisabled={versionsQuery.isFetchingNextPage}
                onPress={() => void versionsQuery.fetchNextPage()}
              >
                {versionsQuery.isFetchingNextPage ? (
                  <Loader2 className='size-3.5 animate-spin' aria-hidden />
                ) : null}
                {versionsQuery.isFetchingNextPage ? '加载中' : '加载更早版本'}
              </Button>
            </div>
          ) : null}
        </aside>

        {/* Right Diff Inspector */}
        <section className='flex min-w-0 flex-col gap-4' aria-live='polite'>
          {versionsQuery.isLoading ? (
            <div className='rounded-2xl border border-separator bg-surface p-6 shadow-surface'>
              <Skeleton className='mb-4 h-6 w-48' />
              <Skeleton className='h-64 w-full rounded-xl' />
            </div>
          ) : comparableFilteredDesc.length === 0 ? (
            <div className='rounded-2xl border border-separator bg-surface px-6 py-16 text-center shadow-surface'>
              <p className='text-sm font-medium text-foreground'>
                该时间段内没有可对比的变更记录
              </p>
              <p className='mt-1 text-xs text-muted'>
                可切换至「创建至今」或清空来源筛选查看完整变更历史。
              </p>
            </div>
          ) : mode === 'single' && activeSelectedId ? (
            <SingleDiffCard
              itemId={itemId}
              current={versionById.get(activeSelectedId)!}
              previous={findPreviousComparableVersion(
                allVersionsDesc,
                activeSelectedId
              )}
              versionById={versionById}
              contentStateById={contentStateById}
              diffStyle={diffStyle}
              showFull={showFull}
              expandedGapKeys={expandedGapKeys}
              onDiffStyleChange={setDiffStyle}
              onToggleShowFull={() => setShowFull((prev) => !prev)}
              onExpandGap={handleExpandGap}
              onRestore={setRestoreTarget}
            />
          ) : mode === 'range' && activeTargetId ? (
            <RangeDiffCard
              itemId={itemId}
              base={
                activeBaseId === EMPTY_BASE_VERSION_ID
                  ? null
                  : (versionById.get(activeBaseId) ?? null)
              }
              target={versionById.get(activeTargetId)!}
              contentStateById={contentStateById}
              diffStyle={diffStyle}
              showFull={showFull}
              expandedGapKeys={expandedGapKeys}
              onDiffStyleChange={setDiffStyle}
              onToggleShowFull={() => setShowFull((prev) => !prev)}
              onExpandGap={handleExpandGap}
              onRestore={setRestoreTarget}
            />
          ) : (
            <>
              <div className='flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-separator bg-surface px-4 py-3 shadow-surface'>
                <div className='flex flex-col gap-0.5'>
                  <span className='text-sm font-semibold text-foreground'>
                    按次总览（{feedOrder === 'desc' ? '最新 → 最早' : '最早 → 最新'}）
                  </span>
                  <span className='text-xs tabular-nums text-muted'>
                    当前展示 {visibleFeedVersions.length} /{' '}
                    {comparableFilteredDesc.length} 次变更
                  </span>
                </div>
                <DiffControlsBar
                  diffStyle={diffStyle}
                  showFull={showFull}
                  onDiffStyleChange={setDiffStyle}
                  onToggleShowFull={() => setShowFull((prev) => !prev)}
                />
              </div>

              {visibleFeedVersions.map((version) => (
                <SingleDiffCard
                  key={version.id}
                  id={`change-feed-${version.id}`}
                  itemId={itemId}
                  current={version}
                  previous={findPreviousComparableVersion(
                    allVersionsDesc,
                    version.id
                  )}
                  versionById={versionById}
                  contentStateById={contentStateById}
                  diffStyle={diffStyle}
                  showFull={showFull}
                  showControls={false}
                  expandedGapKeys={expandedGapKeys}
                  onDiffStyleChange={setDiffStyle}
                  onToggleShowFull={() => setShowFull((prev) => !prev)}
                  onExpandGap={handleExpandGap}
                  onRestore={setRestoreTarget}
                />
              ))}

              {visibleFeedVersions.length < comparableFilteredDesc.length ? (
                <div className='flex justify-center pt-1'>
                  <Button
                    type='button'
                    variant='outline'
                    onPress={() =>
                      setFeedLimit((prev) => prev + FEED_BATCH_SIZE)
                    }
                  >
                    展开更多（剩余{' '}
                    {comparableFilteredDesc.length - visibleFeedVersions.length}{' '}
                    次）
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </section>
      </main>

      {restoreTarget ? (
        <ConfirmDialog
          contentProps={{ 'data-drive-telemetry-scope': 'portal' }}
          open
          onOpenChange={(nextOpen) => {
            if (!nextOpen) setRestoreTarget(null)
          }}
          title='恢复版本'
          desc={`将 v${restoreTarget.versionNumber} 恢复为当前版本（会生成新版本，原有历史均会保留）。`}
          cancelBtnText='取消'
          confirmText='恢复'
          isLoading={restoreMutation.isPending}
          handleConfirm={() => restoreMutation.mutate(restoreTarget.id)}
        />
      ) : null}
    </div>
  )
}

function DiffControlsBar({
  diffStyle,
  showFull,
  onDiffStyleChange,
  onToggleShowFull,
}: {
  readonly diffStyle: ChangeHistoryDiffStyle
  readonly showFull: boolean
  readonly onDiffStyleChange: (style: ChangeHistoryDiffStyle) => void
  readonly onToggleShowFull: () => void
}) {
  return (
    <div className='flex flex-wrap items-center gap-2'>
      <div
        role='group'
        aria-label='对比视图'
        className='inline-flex items-center gap-0.5 rounded-full bg-surface-secondary p-0.5'
      >
        <Button
          type='button'
          size='sm'
          variant={diffStyle === 'unified' ? 'outline' : 'ghost'}
          aria-pressed={diffStyle === 'unified'}
          className={cn(
            'h-7 rounded-full px-3 text-xs',
            diffStyle === 'unified' && 'bg-surface font-medium shadow-surface'
          )}
          onPress={() => onDiffStyleChange('unified')}
        >
          统一
        </Button>
        <Button
          type='button'
          size='sm'
          variant={diffStyle === 'split' ? 'outline' : 'ghost'}
          aria-pressed={diffStyle === 'split'}
          className={cn(
            'h-7 rounded-full px-3 text-xs',
            diffStyle === 'split' && 'bg-surface font-medium shadow-surface'
          )}
          onPress={() => onDiffStyleChange('split')}
        >
          分栏
        </Button>
      </div>
      <Button
        type='button'
        variant='outline'
        size='sm'
        onPress={onToggleShowFull}
      >
        {showFull ? '仅看改动' : '完整文档'}
      </Button>
    </div>
  )
}

type ContentStateMap = ReadonlyMap<
  string,
  {
    readonly data: DriveFileVersionContentDto | undefined
    readonly isLoading: boolean
    readonly error: string | null
    readonly refetch: () => void
  }
>

function VersionDiffBody({
  baseVersionId,
  targetVersionId,
  contentStateById,
  diffStyle,
  showFull,
  expandedGapKeys,
  keyPrefix,
  onExpandGap,
  onStatsReady,
}: {
  readonly baseVersionId: string | null
  readonly targetVersionId: string
  readonly contentStateById: ContentStateMap
  readonly diffStyle: ChangeHistoryDiffStyle
  readonly showFull: boolean
  readonly expandedGapKeys: ReadonlySet<string>
  readonly keyPrefix: string
  readonly onExpandGap: (gapKey: string) => void
  readonly onStatsReady?: (ops: readonly DiffLineOp[]) => void
}) {
  const baseState = baseVersionId ? contentStateById.get(baseVersionId) : null
  const targetState = contentStateById.get(targetVersionId)

  const loading = Boolean(baseState?.isLoading || targetState?.isLoading)
  const error = targetState?.error ?? baseState?.error ?? null

  const ops = useMemo(() => {
    if (!targetState?.data) return null
    if (baseVersionId && !baseState?.data) return null
    return computeLineDiff(baseState?.data?.text ?? '', targetState.data.text)
  }, [baseState?.data, baseVersionId, targetState?.data])

  useEffect(() => {
    if (ops && onStatsReady) onStatsReady(ops)
  }, [onStatsReady, ops])

  if (loading || (!ops && !error)) {
    return (
      <div className='grid gap-2 p-4'>
        <Skeleton className='h-5 w-3/4' />
        <Skeleton className='h-5 w-full' />
        <Skeleton className='h-5 w-5/6' />
      </div>
    )
  }

  if (error || !ops) {
    return (
      <div className='p-4'>
        <Alert status='danger'>
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>无法读取版本内容</Alert.Title>
            <Alert.Description>
              <p>{error ?? '内容读取失败。'}</p>
              <div className='mt-2'>
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  onPress={() => {
                    baseState?.refetch()
                    targetState?.refetch()
                  }}
                >
                  重试
                </Button>
              </div>
            </Alert.Description>
          </Alert.Content>
        </Alert>
      </div>
    )
  }

  const stats = getDiffStats(ops)
  if (stats.additions === 0 && stats.deletions === 0) {
    return (
      <div className='px-6 py-12 text-center text-sm text-muted'>
        两个版本的文本内容完全一致
      </div>
    )
  }

  return (
    <DriveChangeHistoryDiffView
      ops={ops}
      style={diffStyle}
      showFull={showFull}
      expandedGapKeys={expandedGapKeys}
      keyPrefix={keyPrefix}
      onExpandGap={onExpandGap}
    />
  )
}

function SingleDiffCard({
  id,
  itemId,
  current,
  previous,
  versionById,
  contentStateById,
  diffStyle,
  showFull,
  showControls = true,
  expandedGapKeys,
  onDiffStyleChange,
  onToggleShowFull,
  onExpandGap,
  onRestore,
}: {
  readonly id?: string
  readonly itemId: string
  readonly current: DriveFileVersionDto
  readonly previous: DriveFileVersionDto | null
  readonly versionById: ReadonlyMap<string, DriveFileVersionDto>
  readonly contentStateById: ContentStateMap
  readonly diffStyle: ChangeHistoryDiffStyle
  readonly showFull: boolean
  readonly showControls?: boolean
  readonly expandedGapKeys: ReadonlySet<string>
  readonly onDiffStyleChange: (style: ChangeHistoryDiffStyle) => void
  readonly onToggleShowFull: () => void
  readonly onExpandGap: (gapKey: string) => void
  readonly onRestore: (version: DriveFileVersionDto) => void
}) {
  const prevState = previous ? contentStateById.get(previous.id) : null
  const curState = contentStateById.get(current.id)
  const stats = useMemo(() => {
    if (!curState?.data) return null
    if (previous && !prevState?.data) return null
    return getDiffStats(
      computeLineDiff(prevState?.data?.text ?? '', curState.data.text)
    )
  }, [curState?.data, prevState?.data, previous])

  const restoredFrom = current.restoredFromVersionId
    ? versionById.get(current.restoredFromVersionId)
    : null
  const heading = previous
    ? `v${previous.versionNumber} → v${current.versionNumber}`
    : `初始创建 · v${current.versionNumber}`

  return (
    <article
      id={id}
      className='overflow-hidden rounded-2xl border border-separator bg-surface shadow-surface'
    >
      <div className='flex flex-wrap items-center justify-between gap-3 border-b border-separator px-4 py-3'>
        <div className='flex min-w-0 flex-col gap-1'>
          <div className='flex flex-wrap items-center gap-2'>
            <h2 className='text-sm font-semibold tabular-nums text-foreground'>
              {heading}
            </h2>
            {current.isCurrent ? <Chip size='sm'>当前版本</Chip> : null}
            <Chip variant='secondary' size='sm'>
              {driveChangeSourceLabel(current.source)}
            </Chip>
            {stats ? (
              <>
                <Chip
                  color='success'
                  variant='soft'
                  size='sm'
                  className='font-mono tabular-nums'
                >
                  +{stats.additions}
                </Chip>
                <Chip
                  color='danger'
                  variant='soft'
                  size='sm'
                  className='font-mono tabular-nums'
                >
                  −{stats.deletions}
                </Chip>
              </>
            ) : null}
          </div>
          <div className='flex flex-wrap items-center gap-1.5 text-xs tabular-nums text-muted'>
            <RelativeTime value={current.createdAt} />
            <span>·</span>
            <span>{toLocalCalendarDate(current.createdAt)}</span>
            <span>·</span>
            <span>{formatDriveBrowserBytes(current.size)}</span>
            {restoredFrom ? (
              <>
                <span>·</span>
                <span>恢复自 v{restoredFrom.versionNumber}</span>
              </>
            ) : null}
          </div>
        </div>

        <div className='flex flex-wrap items-center gap-2'>
          {showControls ? (
            <DiffControlsBar
              diffStyle={diffStyle}
              showFull={showFull}
              onDiffStyleChange={onDiffStyleChange}
              onToggleShowFull={onToggleShowFull}
            />
          ) : null}
          <a
            href={driveFileVersionsApi.downloadUrl(itemId, current.id)}
            className={buttonVariants({ variant: 'ghost', size: 'sm' })}
          >
            <Download className='size-4' aria-hidden />
            下载 v{current.versionNumber}
          </a>
          {!current.isCurrent ? (
            <Button
              type='button'
              variant='outline'
              size='sm'
              onPress={() => onRestore(current)}
            >
              <RotateCcw className='size-4' aria-hidden />
              恢复到此版本
            </Button>
          ) : null}
        </div>
      </div>

      <VersionDiffBody
        baseVersionId={previous?.id ?? null}
        targetVersionId={current.id}
        contentStateById={contentStateById}
        diffStyle={diffStyle}
        showFull={showFull}
        expandedGapKeys={expandedGapKeys}
        keyPrefix={`single:${current.id}`}
        onExpandGap={onExpandGap}
      />
    </article>
  )
}

function RangeDiffCard({
  itemId,
  base,
  target,
  contentStateById,
  diffStyle,
  showFull,
  expandedGapKeys,
  onDiffStyleChange,
  onToggleShowFull,
  onExpandGap,
  onRestore,
}: {
  readonly itemId: string
  readonly base: DriveFileVersionDto | null
  readonly target: DriveFileVersionDto
  readonly contentStateById: ContentStateMap
  readonly diffStyle: ChangeHistoryDiffStyle
  readonly showFull: boolean
  readonly expandedGapKeys: ReadonlySet<string>
  readonly onDiffStyleChange: (style: ChangeHistoryDiffStyle) => void
  readonly onToggleShowFull: () => void
  readonly onExpandGap: (gapKey: string) => void
  readonly onRestore: (version: DriveFileVersionDto) => void
}) {
  const baseState = base ? contentStateById.get(base.id) : null
  const targetState = contentStateById.get(target.id)
  const stats = useMemo(() => {
    if (!targetState?.data) return null
    if (base && !baseState?.data) return null
    return getDiffStats(
      computeLineDiff(baseState?.data?.text ?? '', targetState.data.text)
    )
  }, [base, baseState?.data, targetState?.data])

  const spanCount = Math.abs(target.versionNumber - (base?.versionNumber ?? 0))
  const heading = base
    ? `v${base.versionNumber} → v${target.versionNumber}`
    : `创建前 → v${target.versionNumber}`

  return (
    <article className='overflow-hidden rounded-2xl border border-separator bg-surface shadow-surface'>
      <div className='flex flex-wrap items-center justify-between gap-3 border-b border-separator px-4 py-3'>
        <div className='flex min-w-0 flex-col gap-1'>
          <div className='flex flex-wrap items-center gap-2'>
            <h2 className='text-sm font-semibold tabular-nums text-foreground'>
              {heading}
            </h2>
            <Chip variant='secondary' size='sm' className='tabular-nums'>
              累计跨 {spanCount} 次变更
            </Chip>
            {stats ? (
              <>
                <Chip
                  color='success'
                  variant='soft'
                  size='sm'
                  className='font-mono tabular-nums'
                >
                  +{stats.additions}
                </Chip>
                <Chip
                  color='danger'
                  variant='soft'
                  size='sm'
                  className='font-mono tabular-nums'
                >
                  −{stats.deletions}
                </Chip>
              </>
            ) : null}
          </div>
          <div className='flex flex-wrap items-center gap-1.5 text-xs tabular-nums text-muted'>
            <span>
              {base
                ? `${toLocalCalendarDate(base.createdAt)} v${base.versionNumber}`
                : '空白文档'}
            </span>
            <span>→</span>
            <span>
              {toLocalCalendarDate(target.createdAt)} v{target.versionNumber}
            </span>
          </div>
        </div>

        <div className='flex flex-wrap items-center gap-2'>
          <DiffControlsBar
            diffStyle={diffStyle}
            showFull={showFull}
            onDiffStyleChange={onDiffStyleChange}
            onToggleShowFull={onToggleShowFull}
          />
          <a
            href={driveFileVersionsApi.downloadUrl(itemId, target.id)}
            className={buttonVariants({ variant: 'ghost', size: 'sm' })}
          >
            <Download className='size-4' aria-hidden />
            下载 v{target.versionNumber}
          </a>
          {!target.isCurrent ? (
            <Button
              type='button'
              variant='outline'
              size='sm'
              onPress={() => onRestore(target)}
            >
              <RotateCcw className='size-4' aria-hidden />
              恢复到此版本
            </Button>
          ) : null}
        </div>
      </div>

      <VersionDiffBody
        baseVersionId={base?.id ?? null}
        targetVersionId={target.id}
        contentStateById={contentStateById}
        diffStyle={diffStyle}
        showFull={showFull}
        expandedGapKeys={expandedGapKeys}
        keyPrefix={`range:${base?.id ?? EMPTY_BASE_VERSION_ID}:${target.id}`}
        onExpandGap={onExpandGap}
      />
    </article>
  )
}
