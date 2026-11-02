import { Button, Collection, Label, ListBox, ListBoxLoadMoreItem, Select, Spinner } from '@heroui/react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { dashboardApi } from '@/lib/api'

type Props = { value: string; selectedName?: string; onChange: (value: string) => void }

/** Management lists exclude deleted hooks, so retain a historical selection as a fallback item. */
export function WebhookSelector({ value, selectedName, onChange }: Props) {
  const hooks = useInfiniteQuery({
    queryKey: ['dashboard-webhooks', 'options'],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => dashboardApi.listWebhooks({ page: pageParam, pageSize: 50 }),
    getNextPageParam: (lastPage) => lastPage.page * lastPage.pageSize < lastPage.total ? lastPage.page + 1 : undefined,
  })
  const options = hooks.data?.pages.flatMap((page) => page.data) ?? []
  const missingSelection = Boolean(value && !options.some((hook) => hook.id === value))
  const selected = useQuery({
    queryKey: ['dashboard-webhook', value],
    queryFn: () => dashboardApi.getWebhook(value),
    enabled: missingSelection && !selectedName,
    retry: false,
  })
  const selectionLabel = selectedName ?? selected.data?.name ?? `指定 Webhook（${value}）`
  return <div className='grid min-w-0 gap-2'>
    <Select fullWidth value={value || 'all'} onChange={(key) => onChange(key === 'all' ? '' : String(key ?? ''))}>
      <Label>Webhook</Label>
      <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
      <Select.Popover>
        <ListBox aria-label='选择 Webhook'>
          <ListBox.Item id='all' textValue='全部 Webhook'><Label>全部 Webhook</Label><ListBox.ItemIndicator /></ListBox.Item>
          {missingSelection && <ListBox.Item id={value} textValue={selectionLabel}><Label className='max-w-64 truncate' title={selectionLabel}>{selectionLabel}</Label><ListBox.ItemIndicator /></ListBox.Item>}
          <Collection items={options}>{(hook) => <ListBox.Item id={hook.id} textValue={hook.name}><Label className='max-w-64 truncate' title={hook.name}>{hook.name}</Label><ListBox.ItemIndicator /></ListBox.Item>}</Collection>
          {hooks.hasNextPage && <ListBoxLoadMoreItem isLoading={hooks.isFetchingNextPage} onLoadMore={() => void hooks.fetchNextPage()}><Spinner size='sm' /></ListBoxLoadMoreItem>}
        </ListBox>
      </Select.Popover>
    </Select>
    {hooks.isLoading && <span role='status' className='text-sm text-muted'>正在加载 Webhook…</span>}
    {hooks.isError && <div className='flex flex-wrap items-center gap-2 text-sm'><span role='alert' className='text-danger'>Webhook 选项加载失败</span><Button variant='ghost' size='sm' onPress={() => void hooks.refetch()}>重试</Button></div>}
  </div>
}
