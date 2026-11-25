import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Checkbox, Input, Radio, RadioGroup, toast } from '@heroui/react'
import type { StateSyncKeyResources } from '@synapse/shared/state-sync-contracts'
import type { DashboardApiKey } from '@/lib/api'
import { CloudModal } from '@/features/cloud-tables/cloud-table-controls'
import { useAuthStore } from '@/stores/auth-store'
import { stateSyncApi } from './state-sync-api'

export function StateSyncKeyResourcesField({
  value,
  onChange,
  disabled = false,
  headerLabel,
  onLoadingChange,
  onSpacesLoaded,
}: {
  value: StateSyncKeyResources
  onChange: (next: StateSyncKeyResources) => void
  disabled?: boolean
  headerLabel?: string
  onLoadingChange?: (loading: boolean) => void
  onSpacesLoaded?: (existingIds: Set<string>) => void
}) {
  const session = useAuthStore((s) => s.auth.user?.sessionId ?? 'anonymous')
  const [query, setQuery] = useState('')

  const spaces = useQuery({
    queryKey: ['state-sync', session, 'key-resources'],
    queryFn: ({ signal }) => stateSyncApi.listSpaces(signal),
  })

  useEffect(() => {
    onLoadingChange?.(spaces.isLoading)
  }, [spaces.isLoading, onLoadingChange])

  const existingIds = useMemo(
    () => new Set((spaces.data?.data ?? []).map((item) => item.id)),
    [spaces.data?.data],
  )

  useEffect(() => {
    if (spaces.data) onSpacesLoaded?.(existingIds)
  }, [spaces.data, existingIds, onSpacesLoaded])

  const visibleSpaces = useMemo(() => {
    const items = spaces.data?.data ?? []
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter((item) => `${item.name} ${item.id}`.toLowerCase().includes(q))
  }, [spaces.data?.data, query])

  const staleCount = spaces.data
    ? value.spaceIds.filter((id) => !existingIds.has(id)).length
    : 0

  function toggleSpace(id: string, checked: boolean) {
    const nextIds = checked
      ? (value.spaceIds.includes(id) ? value.spaceIds : [...value.spaceIds, id])
      : value.spaceIds.filter((v) => v !== id)
    onChange({ mode: value.mode, spaceIds: nextIds })
  }

  return (
    <div className='space-y-4'>
      <section className='space-y-3' aria-labelledby='state-sync-resource-scope-heading'>
        <div className='flex flex-wrap items-baseline justify-between gap-2'>
          <h2 id='state-sync-resource-scope-heading' className='text-sm font-medium'>同步空间资源范围</h2>
          {headerLabel && <span className='text-sm text-muted'>{headerLabel}</span>}
        </div>
        <RadioGroup
          variant='secondary'
          aria-label='同步空间资源范围'
          value={value.mode}
          onChange={(nextMode) => {
            const mode = nextMode as StateSyncKeyResources['mode']
            onChange({
              mode,
              spaceIds: mode === 'all_owned' ? [] : value.spaceIds,
            })
          }}
          isDisabled={disabled}
          className='grid gap-3 sm:grid-cols-2'
        >
          <Radio value='selected' className='rounded-xl border border-border bg-surface p-3 data-[selected=true]:border-accent data-[selected=true]:bg-accent-soft'>
            <Radio.Content className='items-start gap-3'>
              <Radio.Control><Radio.Indicator /></Radio.Control>
              <span className='min-w-0'>
                <span className='block font-medium'>仅限选中的空间</span>
                <span className='mt-1 block text-sm text-muted'>按同步空间隔离访问边界</span>
              </span>
            </Radio.Content>
          </Radio>
          <Radio value='all_owned' className='rounded-xl border border-border bg-surface p-3 data-[selected=true]:border-accent data-[selected=true]:bg-accent-soft'>
            <Radio.Content className='items-start gap-3'>
              <Radio.Control><Radio.Indicator /></Radio.Control>
              <span className='min-w-0'>
                <span className='block font-medium'>自己的全部空间</span>
                <span className='mt-1 block text-sm text-muted'>含后续新建空间，支持通过 API 建空间</span>
              </span>
            </Radio.Content>
          </Radio>
        </RadioGroup>
      </section>

      {value.mode === 'all_owned' ? (
        <section className='rounded-xl border border-border bg-surface-secondary p-4'>
          <h3 className='font-medium'>全部自有同步空间</h3>
          <p className='mt-1 text-sm text-muted'>新建的同步空间也会自动纳入此密钥的资源范围。</p>
        </section>
      ) : (
        <section className='space-y-3 rounded-xl border border-border bg-surface p-4'>
          <Input
            variant='secondary'
            aria-label='搜索空间名称或 ID'
            placeholder='搜索空间名称或 ID'
            value={query}
            disabled={disabled}
            onChange={(e) => setQuery(e.target.value)}
          />
          {staleCount > 0 && (
            <p className='text-xs text-muted'>
              已自动排除 {staleCount} 个已删除的失效空间 ID，保存后生效。
            </p>
          )}
          {spaces.isLoading ? (
            <p className='text-sm text-muted'>加载中...</p>
          ) : spaces.error ? (
            <div className='flex items-center justify-between gap-2 text-sm text-danger'>
              <span>{spaces.error instanceof Error ? spaces.error.message : '加载失败'}</span>
              <Button variant='secondary' onPress={() => void spaces.refetch()}>重试</Button>
            </div>
          ) : visibleSpaces.length === 0 ? (
            <p className='text-sm text-muted'>暂无可选同步空间</p>
          ) : (
            <div className='max-h-60 space-y-2 overflow-y-auto'>
              {visibleSpaces.map((sp) => (
                <Checkbox
                  key={sp.id}
                  variant='secondary'
                  isSelected={value.spaceIds.includes(sp.id)}
                  onChange={(checked) => toggleSpace(sp.id, checked)}
                  isDisabled={disabled}
                >
                  <Checkbox.Content>
                    <Checkbox.Control><Checkbox.Indicator /></Checkbox.Control>
                    <span className='min-w-0'>
                      <span className='block truncate font-medium'>{sp.name}</span>
                      <span className='block truncate font-mono text-xs text-muted'>{sp.id}</span>
                    </span>
                  </Checkbox.Content>
                </Checkbox>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  )
}

export function StateSyncKeyResourcesDialog({ apiKey, onClose }: { apiKey: DashboardApiKey; onClose: () => void }) {
  const cache = useQueryClient()
  const [value, setValue] = useState<StateSyncKeyResources>({
    mode: apiKey.stateSyncResources?.mode ?? 'selected',
    spaceIds: apiKey.stateSyncResources?.spaceIds ?? [],
  })
  const [spacesLoading, setSpacesLoading] = useState(true)
  const [existingIds, setExistingIds] = useState<Set<string> | null>(null)

  const effectiveSelected = useMemo(
    () => (existingIds ? value.spaceIds.filter((id) => existingIds.has(id)) : value.spaceIds),
    [existingIds, value.spaceIds],
  )

  const mutation = useMutation({
    mutationFn: () => stateSyncApi.updateKeyResources(apiKey.id, {
      mode: value.mode,
      spaceIds: value.mode === 'all_owned' ? [] : effectiveSelected,
    }),
    onSuccess: () => {
      void cache.invalidateQueries({ queryKey: ['dashboard-api-keys'] })
      toast.success('同步空间资源范围已更新')
      onClose()
    },
    onError: (e: Error) => toast.danger(e.message),
  })

  return (
    <CloudModal
      title='密钥的同步空间资源'
      saveLabel='保存更改'
      onClose={onClose}
      onSave={() => {
        if (value.mode === 'selected' && spacesLoading) return
        mutation.mutate()
      }}
      pending={mutation.isPending}
    >
      <StateSyncKeyResourcesField
        value={value}
        onChange={setValue}
        disabled={mutation.isPending}
        headerLabel={`当前密钥：${apiKey.name}`}
        onLoadingChange={setSpacesLoading}
        onSpacesLoaded={setExistingIds}
      />
    </CloudModal>
  )
}
