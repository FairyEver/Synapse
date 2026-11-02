import { Button, Input, Label, Link, ListBox, Select, TextField } from '@heroui/react'
import { useEffect, useMemo, useState } from 'react'
import { WEBHOOK_DELIVERY_STATUS, type WebhookDeliveryHistoryDto } from '@synapse/shared'
import { useQuery } from '@tanstack/react-query'
import { type SortingState } from '@tanstack/react-table'
import { RefreshCw } from 'lucide-react'
import { adminApi, dashboardApi } from '@/lib/api'
import { consoleHref } from '@/lib/console-href'
import { DEFAULT_DASHBOARD_PAGE_SIZE, ServerDataTable } from '@/components/data-table'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { getWebhookDeliveryStatusLabel } from '@/features/webhooks/webhook-display'
import { buildWebhookDeliveryHistoryColumns } from './webhook-delivery-history-columns'
import { WebhookDeliveryHistoryDetailSheet } from './webhook-delivery-history-detail-sheet'
import { buildWebhookDeliveryHistoryQuery, getWebhookHistoryDateRangeError } from './webhook-delivery-history-display'
import { WebhookSelector } from './webhook-selector'

const statuses = Object.values(WEBHOOK_DELIVERY_STATUS)
export type WebhookDeliveryHistorySearch = {
  page?: number
  pageSize?: number
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
  webhookId?: string
  status?: string
  from?: string
  to?: string
  user?: string
  userId?: string
}

type Props = {
  mode: 'admin' | 'user'
  search: WebhookDeliveryHistorySearch
  onSearchChange: (update: (current: WebhookDeliveryHistorySearch) => WebhookDeliveryHistorySearch) => void
}

export default function WebhookDeliveriesPage(props: Props) {
  return <>
    <Header fixed><h1 className='text-lg font-semibold'>Webhook 触发记录</h1></Header>
    <Main>
      {props.mode === 'user' && <div><Link href={consoleHref('/webhooks/')}>Webhook 列表</Link></div>}
      <WebhookDeliveryHistory {...props} />
    </Main>
  </>
}

export function WebhookDeliveryHistory({ mode, search, onSearchChange, scopeWebhookId }: Props & { scopeWebhookId?: string }) {
  const [detail, setDetail] = useState<WebhookDeliveryHistoryDto | null>(null)
  const page = search.page ?? 1
  const pageSize = search.pageSize ?? DEFAULT_DASHBOARD_PAGE_SIZE
  const webhookId = scopeWebhookId ?? search.webhookId ?? ''
  const from = search.from ?? ''
  const to = search.to ?? ''
  const dateError = getWebhookHistoryDateRangeError(from, to)
  const query = buildWebhookDeliveryHistoryQuery({
    ...search, page, pageSize, webhookId,
    sortBy: search.sortBy ?? 'receivedAt', sortOrder: search.sortOrder ?? 'desc',
    user: mode === 'admin' ? search.user : undefined,
    userId: mode === 'admin' ? search.userId : undefined,
  })
  const history = useQuery({
    queryKey: ['webhook-delivery-history', mode, query],
    queryFn: () => mode === 'admin' ? adminApi.listWebhookDeliveryHistory(query) : dashboardApi.listWebhookDeliveryHistory(query),
    enabled: !dateError,
  })
  useEffect(() => setDetail(null), [mode, webhookId, search.status, from, to, search.user, search.userId, page, pageSize])
  const columns = useMemo(() => buildWebhookDeliveryHistoryColumns({ mode, onOpenDetail: setDetail, showWebhook: !scopeWebhookId }), [mode, scopeWebhookId])
  const sorting: SortingState = [{ id: query.sortBy, desc: query.sortOrder === 'desc' }]
  const hasFilters = Boolean((!scopeWebhookId && search.webhookId) || search.status || from || to || search.user || search.userId)
  const selectedName = history.data?.data.find((row) => row.webhook.id === webhookId)?.webhook.currentName
    ?? history.data?.data.find((row) => row.webhook.id === webhookId)?.webhook.name

  function changeFilters(patch: Partial<WebhookDeliveryHistorySearch>) {
    onSearchChange((current) => ({ ...current, ...patch, page: 1 }))
  }
  function clearFilters() {
    onSearchChange((current) => ({ ...current, page: 1, webhookId: undefined, status: undefined, from: undefined, to: undefined, user: undefined, userId: undefined }))
  }
  function changeSorting(next: SortingState) {
    const sort = next[0]
    changeFilters({ sortBy: sort?.id ?? 'receivedAt', sortOrder: sort?.desc === false ? 'asc' : 'desc' })
  }

  const filters = <div className='grid min-w-0 gap-4'>
    <div className='flex flex-wrap items-end gap-3'>
      {!scopeWebhookId && <div className='w-full min-w-0 sm:w-60'>
        {mode === 'user' ? <WebhookSelector value={webhookId} selectedName={selectedName} onChange={(value) => changeFilters({ webhookId: value || undefined })} />
          : <TextField><Label>Webhook ID</Label><Input value={webhookId} onChange={(event) => changeFilters({ webhookId: event.target.value })} /></TextField>}
      </div>}
      <Select className='w-full sm:w-56' value={search.status || 'all'} onChange={(key) => changeFilters({ status: key === 'all' ? undefined : String(key ?? '') })}>
        <Label>投递状态</Label>
        <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
        <Select.Popover><ListBox aria-label='投递状态'>
          <ListBox.Item id='all' textValue='全部状态'><Label>全部状态</Label><ListBox.ItemIndicator /></ListBox.Item>
          {statuses.map((status) => <ListBox.Item key={status} id={status} textValue={getWebhookDeliveryStatusLabel(status)}><Label>{getWebhookDeliveryStatusLabel(status)}</Label><ListBox.ItemIndicator /></ListBox.Item>)}
        </ListBox></Select.Popover>
      </Select>
      <div className='grid w-full grid-cols-2 gap-3 sm:w-auto'>
        <TextField className='min-w-0'><Label>开始日期</Label><Input className='w-full' type='date' value={from} onChange={(event) => changeFilters({ from: event.target.value || undefined })} /></TextField>
        <TextField className='min-w-0' isInvalid={Boolean(dateError)}><Label>结束日期</Label><Input className='w-full' type='date' value={to} onChange={(event) => changeFilters({ to: event.target.value || undefined })} /></TextField>
      </div>
      {mode === 'admin' && <TextField className='w-full sm:w-60'><Label>用户</Label><Input placeholder='邮箱或昵称' value={search.user ?? ''} onChange={(event) => changeFilters({ user: event.target.value || undefined })} /></TextField>}
      <div className='flex flex-wrap gap-2'>
        <Button variant='secondary' isPending={history.isFetching} isDisabled={Boolean(dateError)} onPress={() => void history.refetch()}><RefreshCw />刷新</Button>
        {hasFilters && <Button variant='ghost' onPress={clearFilters}>清除筛选</Button>}
      </div>
    </div>
    {dateError && <p role='alert' className='text-sm text-danger'>{dateError}</p>}
    {mode === 'admin' && search.userId && <p className='break-all text-sm text-muted'>用户 ID：{search.userId}</p>}
  </div>

  return <>
    <ServerDataTable columns={columns} data={dateError ? [] : history.data?.data ?? []} page={page} pageSize={pageSize}
      total={dateError ? 0 : history.data?.total ?? 0} error={!dateError && history.isError ? history.error : null}
      isLoading={!dateError && history.isLoading} loadingRowCount={Math.min(pageSize, DEFAULT_DASHBOARD_PAGE_SIZE)}
      onRetry={() => void history.refetch()} onPageChange={(next) => onSearchChange((current) => ({ ...current, page: next }))}
      onPageSizeChange={(next) => onSearchChange((current) => ({ ...current, page: 1, pageSize: next }))}
      clampPage={!dateError && !history.isLoading} showPagination={!dateError}
      sorting={sorting} onSortingChange={changeSorting} toolbar={filters}
      emptyMessage={dateError ? '请调整日期范围' : hasFilters ? '没有符合筛选条件的触发记录' : '暂无触发记录'} />
    <WebhookDeliveryHistoryDetailSheet open={Boolean(detail)} delivery={detail} onOpenChange={(open) => { if (!open) setDetail(null) }} />
  </>
}
