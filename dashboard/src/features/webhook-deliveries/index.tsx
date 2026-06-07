import { useMemo, useState } from 'react'
import {
  WEBHOOK_DELIVERY_STATUS,
  type WebhookDeliveryHistoryDto,
  type WebhookDeliveryStatus,
} from '@synapse/shared'
import { useQuery } from '@tanstack/react-query'
import { useSearch } from '@tanstack/react-router'
import { type SortingState } from '@tanstack/react-table'
import { adminApi, dashboardApi } from '@/lib/api'
import {
  DEFAULT_DASHBOARD_PAGE_SIZE,
  ServerDataTable,
} from '@/components/data-table'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useAuthStore } from '@/stores/auth-store'
import { getWebhookDeliveryStatusLabel } from '@/features/webhooks/webhook-display'
import { buildWebhookDeliveryHistoryColumns } from './webhook-delivery-history-columns'
import { WebhookDeliveryHistoryDetailSheet } from './webhook-delivery-history-detail-sheet'
import { buildWebhookDeliveryHistoryQuery } from './webhook-delivery-history-display'

const allStatusesValue = 'all'

const webhookDeliveryStatusOptions: WebhookDeliveryStatus[] = [
  WEBHOOK_DELIVERY_STATUS.received,
  WEBHOOK_DELIVERY_STATUS.noOnlineClients,
  WEBHOOK_DELIVERY_STATUS.sent,
  WEBHOOK_DELIVERY_STATUS.delivered,
  WEBHOOK_DELIVERY_STATUS.broadcastFailed,
  WEBHOOK_DELIVERY_STATUS.rejected,
]

export default function WebhookDeliveriesPage() {
  const search = useSearch({ from: '/_authenticated/webhook-deliveries/' })
  const role = useAuthStore((state) => state.auth.user?.role)
  const mode = role === 'admin' ? 'admin' : 'user'
  const [page, setPage] = useState(search.page ?? 1)
  const [pageSize, setPageSize] = useState(
    search.pageSize ?? DEFAULT_DASHBOARD_PAGE_SIZE
  )
  const [sorting, setSorting] = useState<SortingState>([
    { id: search.sortBy ?? 'receivedAt', desc: search.sortOrder !== 'asc' },
  ])
  const [webhookId, setWebhookId] = useState(search.webhookId ?? '')
  const [status, setStatus] = useState(search.status ?? '')
  const [from, setFrom] = useState(search.from ?? '')
  const [to, setTo] = useState(search.to ?? '')
  const [user, setUser] = useState(search.user ?? '')
  const [detail, setDetail] = useState<WebhookDeliveryHistoryDto | null>(null)
  const activeSort = sorting[0]
  const query = buildWebhookDeliveryHistoryQuery({
    page,
    pageSize,
    sortBy: activeSort?.id ?? 'receivedAt',
    sortOrder: activeSort?.desc === false ? 'asc' : 'desc',
    webhookId,
    status,
    from,
    to,
    user: mode === 'admin' ? user : undefined,
  })

  const historyQuery = useQuery({
    queryKey: ['webhook-delivery-history', mode, query],
    queryFn: () =>
      mode === 'admin'
        ? adminApi.listWebhookDeliveryHistory(query)
        : dashboardApi.listWebhookDeliveryHistory(query),
  })

  const columns = useMemo(
    () => buildWebhookDeliveryHistoryColumns({ mode, onOpenDetail: setDetail }),
    [mode]
  )

  return (
    <>
      <Header fixed>
        <h1 className='text-lg font-semibold'>Webhook 历史</h1>
      </Header>
      <Main>
        {historyQuery.isLoading ? (
          <div className='text-muted-foreground'>加载中...</div>
        ) : (
          <ServerDataTable
            columns={columns}
            data={historyQuery.data?.data ?? []}
            page={page}
            pageSize={pageSize}
            total={historyQuery.data?.total ?? 0}
            error={historyQuery.isError ? historyQuery.error : null}
            onRetry={() => void historyQuery.refetch()}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            sorting={sorting}
            onSortingChange={setSorting}
            toolbar={
              <div className='flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between'>
                <div className='flex flex-wrap items-center gap-2'>
                  {mode === 'admin' ? (
                    <Input
                      placeholder='用户'
                      value={user}
                      onChange={(event) => {
                        setUser(event.target.value)
                        setPage(1)
                      }}
                      className='h-8 w-37.5 lg:w-62.5'
                    />
                  ) : null}
                  <Input
                    placeholder='Webhook ID'
                    value={webhookId}
                    onChange={(event) => {
                      setWebhookId(event.target.value)
                      setPage(1)
                    }}
                    className='h-8 w-37.5 lg:w-62.5'
                  />
                  <Select
                    value={status || allStatusesValue}
                    onValueChange={(value) => {
                      setStatus(value === allStatusesValue ? '' : value)
                      setPage(1)
                    }}
                  >
                    <SelectTrigger size='sm' className='w-36'>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value={allStatusesValue}>全部状态</SelectItem>
                        {webhookDeliveryStatusOptions.map((option) => (
                          <SelectItem key={option} value={option}>
                            {getWebhookDeliveryStatusLabel(option)}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <Input
                    type='date'
                    value={from}
                    onChange={(event) => {
                      setFrom(event.target.value)
                      setPage(1)
                    }}
                    className='h-8 w-36'
                  />
                  <Input
                    type='date'
                    value={to}
                    onChange={(event) => {
                      setTo(event.target.value)
                      setPage(1)
                    }}
                    className='h-8 w-36'
                  />
                </div>
              </div>
            }
          />
        )}
        <WebhookDeliveryHistoryDetailSheet
          open={Boolean(detail)}
          delivery={detail}
          onOpenChange={(open) => {
            if (!open) setDetail(null)
          }}
        />
      </Main>
    </>
  )
}
