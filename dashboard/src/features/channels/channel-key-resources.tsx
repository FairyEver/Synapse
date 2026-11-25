import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Checkbox, Input, Radio, RadioGroup, toast } from '@heroui/react'
import type { ChannelKeyResources } from '@synapse/shared/channel-contracts'
import type { DashboardApiKey } from '@/lib/api'
import { CloudModal } from '@/features/cloud-tables/cloud-table-controls'
import { useAuthStore } from '@/stores/auth-store'
import { channelApi } from './channel-api'

export function ChannelKeyResourcesDialog({ apiKey, onClose }: { apiKey: DashboardApiKey; onClose: () => void }) {
  const session = useAuthStore((s) => s.auth.user?.sessionId ?? 'anonymous')
  const cache = useQueryClient()
  const [mode, setMode] = useState<ChannelKeyResources['mode']>(apiKey.channelResources?.mode ?? 'selected')
  const [selected, setSelected] = useState<string[]>(apiKey.channelResources?.channelIds ?? [])
  const [query, setQuery] = useState('')

  const channels = useQuery({
    queryKey: ['channels', session, 'key-resources'],
    queryFn: ({ signal }) => channelApi.list(signal),
  })

  const visibleChannels = useMemo(() => {
    const items = channels.data?.data ?? []
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter((item) => `${item.name} ${item.id}`.toLowerCase().includes(q))
  }, [channels.data?.data, query])

  const mutation = useMutation({
    mutationFn: () => channelApi.updateKeyResources(apiKey.id, {
      mode,
      channelIds: mode === 'all_owned' ? [] : selected,
    }),
    onSuccess: () => {
      void cache.invalidateQueries({ queryKey: ['dashboard-api-keys'] })
      toast.success('频道资源范围已更新')
      onClose()
    },
    onError: (e: Error) => toast.danger(e.message),
  })

  function toggleChannel(id: string, checked: boolean) {
    setSelected((current) => {
      if (checked) return current.includes(id) ? current : [...current, id]
      return current.filter((v) => v !== id)
    })
  }

  return (
    <CloudModal
      title='密钥的频道资源'
      saveLabel='保存更改'
      onClose={onClose}
      onSave={() => mutation.mutate()}
      pending={mutation.isPending}
    >
      <div className='space-y-4'>
        <section className='space-y-3' aria-labelledby='channel-resource-scope-heading'>
          <div className='flex flex-wrap items-baseline justify-between gap-2'>
            <h2 id='channel-resource-scope-heading' className='font-medium'>资源范围</h2>
            <span className='text-sm text-muted'>当前密钥：{apiKey.name}</span>
          </div>
          <RadioGroup
            aria-label='频道资源范围'
            value={mode}
            onChange={(value) => setMode(value as ChannelKeyResources['mode'])}
            isDisabled={mutation.isPending}
            className='grid gap-3 sm:grid-cols-2'
          >
            <Radio value='selected' className='rounded-xl border border-border bg-surface p-3 data-[selected=true]:border-accent data-[selected=true]:bg-accent-soft'>
              <Radio.Content className='items-start gap-3'>
                <Radio.Control><Radio.Indicator /></Radio.Control>
                <span className='min-w-0'>
                  <span className='block font-medium'>仅限选中的频道</span>
                  <span className='mt-1 block text-sm text-muted'>按频道隔离访问边界</span>
                </span>
              </Radio.Content>
            </Radio>
            <Radio value='all_owned' className='rounded-xl border border-border bg-surface p-3 data-[selected=true]:border-accent data-[selected=true]:bg-accent-soft'>
              <Radio.Content className='items-start gap-3'>
                <Radio.Control><Radio.Indicator /></Radio.Control>
                <span className='min-w-0'>
                  <span className='block font-medium'>自己的全部频道</span>
                  <span className='mt-1 block text-sm text-muted'>含后续新建频道，支持通过 API 建频道</span>
                </span>
              </Radio.Content>
            </Radio>
          </RadioGroup>
        </section>

        {mode === 'all_owned' ? (
          <section className='rounded-xl border border-border bg-surface-secondary p-4'>
            <h2 className='font-medium'>全部自有频道</h2>
            <p className='mt-1 text-sm text-muted'>新建的频道也会自动纳入此密钥的资源范围。</p>
          </section>
        ) : (
          <section className='space-y-3 rounded-xl border border-border bg-surface p-4'>
            <Input
              variant='secondary'
              aria-label='搜索频道名称或 ID'
              placeholder='搜索频道名称或 ID'
              value={query}
              disabled={mutation.isPending}
              onChange={(e) => setQuery(e.target.value)}
            />
            {channels.isLoading ? (
              <p className='text-sm text-muted'>加载中...</p>
            ) : channels.error ? (
              <div className='flex items-center justify-between gap-2 text-sm text-danger'>
                <span>{channels.error instanceof Error ? channels.error.message : '加载失败'}</span>
                <Button size='sm' variant='secondary' onPress={() => void channels.refetch()}>重试</Button>
              </div>
            ) : visibleChannels.length === 0 ? (
              <p className='text-sm text-muted'>暂无可选频道</p>
            ) : (
              <div className='max-h-60 space-y-2 overflow-y-auto'>
                {visibleChannels.map((ch) => (
                  <Checkbox
                    key={ch.id}
                    variant='secondary'
                    isSelected={selected.includes(ch.id)}
                    onChange={(checked) => toggleChannel(ch.id, checked)}
                    isDisabled={mutation.isPending}
                  >
                    <Checkbox.Content>
                      <Checkbox.Control><Checkbox.Indicator /></Checkbox.Control>
                      <span className='min-w-0'>
                        <span className='block truncate font-medium'>{ch.name}</span>
                        <span className='block truncate font-mono text-xs text-muted'>{ch.id}</span>
                      </span>
                    </Checkbox.Content>
                  </Checkbox>
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </CloudModal>
  )
}
