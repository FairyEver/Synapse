import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Checkbox, Input, Radio, RadioGroup, toast } from '@heroui/react'
import type { DashboardApiKey } from '@/lib/api'
import type { CloudKeyResources, CloudTableSummary } from '@synapse/shared'
import { cloudTableApi } from './cloud-table-api'
import { CloudModal } from './cloud-table-controls'
import { useAuthStore } from '@/stores/auth-store'

type TableSummary = Pick<CloudTableSummary, 'id' | 'name'>

export function CloudKeyResourcesDialog({ apiKey, onClose }: { apiKey: DashboardApiKey; onClose: () => void }) {
  const session = useAuthStore(s => s.auth.user?.sessionId ?? 'anonymous')
  const cache = useQueryClient()
  const [mode, setMode] = useState<CloudKeyResources['mode']>(apiKey.tableResources?.mode ?? 'selected')
  const [selected, setSelected] = useState(apiKey.tableResources?.tableIds ?? [])
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState<string | undefined>()
  const [history, setHistory] = useState<(string | undefined)[]>([])
  const [tableNames, setTableNames] = useState<Record<string, string>>({})

  const tables = useQuery({
    queryKey: ['cloud-tables', session, 'key-resources', cursor],
    queryFn: ({ signal }) => cloudTableApi.list(false, cursor, signal),
  })

  useEffect(() => {
    const current = tables.data?.data
    if (!current) return
    setTableNames(names => Object.fromEntries([
      ...Object.entries(names),
      ...current.map(table => [table.id, table.name] as const),
    ]))
  }, [tables.data?.data])

  const visibleTables = useMemo(() => {
    const current = tables.data?.data ?? []
    const normalized = query.trim().toLocaleLowerCase()
    if (!normalized) return current
    return current.filter(table => `${table.name} ${table.id}`.toLocaleLowerCase().includes(normalized))
  }, [query, tables.data?.data])
  const selectedTables = useMemo<TableSummary[]>(() => selected.map(id => ({ id, name: tableNames[id] ?? id })), [selected, tableNames])
  const visibleSelected = visibleTables.length > 0 && visibleTables.every(table => selected.includes(table.id))

  const mutation = useMutation({
    mutationFn: () => cloudTableApi.resources(apiKey.id, { mode, tableIds: mode === 'all_owned' ? [] : selected }),
    onSuccess: () => { void cache.invalidateQueries({ queryKey: ['dashboard-api-keys'] }); onClose() },
    onError: (e: Error) => toast.danger(e.message),
  })

  function toggleTable(id: string, checked: boolean) {
    setSelected(current => {
      if (checked) return current.includes(id) ? current : [...current, id]
      return current.filter(value => value !== id)
    })
  }

  function toggleVisibleTables() {
    if (visibleSelected) {
      const visibleIds = new Set(visibleTables.map(table => table.id))
      setSelected(current => current.filter(id => !visibleIds.has(id)))
      return
    }
    setSelected(current => [...current, ...visibleTables.map(table => table.id).filter(id => !current.includes(id))])
  }

  function removeSelected(id: string) {
    setSelected(current => current.filter(value => value !== id))
  }

  function goPrevious() {
    setHistory(current => {
      const previous = current.at(-1)
      setCursor(previous)
      return current.slice(0, -1)
    })
  }

  function goNext() {
    const nextCursor = tables.data?.nextCursor
    if (!nextCursor) return
    setHistory(current => [...current, cursor])
    setCursor(nextCursor)
  }

  return <CloudModal title='密钥的表资源' saveLabel='保存更改' onClose={onClose} onSave={() => mutation.mutate()} pending={mutation.isPending}>
    <div className='space-y-4'>
      <section className='space-y-3' aria-labelledby='resource-scope-heading'>
        <div className='flex flex-wrap items-baseline justify-between gap-2'>
          <h2 id='resource-scope-heading' className='font-medium'>资源范围</h2>
          <span className='text-sm text-muted'>当前密钥：{apiKey.name}</span>
        </div>
        <RadioGroup aria-label='资源范围' value={mode} onChange={value => setMode(value as CloudKeyResources['mode'])} isDisabled={mutation.isPending} className='grid gap-3 sm:grid-cols-2'>
          <Radio value='selected' className='rounded-xl border border-border bg-surface p-3 data-[selected=true]:border-accent data-[selected=true]:bg-accent-soft'>
            <Radio.Content className='items-start gap-3'>
              <Radio.Control><Radio.Indicator /></Radio.Control>
              <span className='min-w-0'>
                <span className='block font-medium'>仅限选中的表</span>
                <span className='mt-1 block text-sm text-muted'>权限边界清晰，适合固定的自动化任务</span>
              </span>
            </Radio.Content>
          </Radio>
          <Radio value='all_owned' className='rounded-xl border border-border bg-surface p-3 data-[selected=true]:border-accent data-[selected=true]:bg-accent-soft'>
            <Radio.Content className='items-start gap-3'>
              <Radio.Control><Radio.Indicator /></Radio.Control>
              <span className='min-w-0'>
                <span className='block font-medium'>自己的全部表</span>
                <span className='mt-1 block text-sm text-muted'>包含以后创建的表，适合内部脚本</span>
              </span>
            </Radio.Content>
          </Radio>
        </RadioGroup>
      </section>

      {mode === 'all_owned' ? <section className='rounded-xl border border-border bg-surface-secondary p-4' aria-label='全部自有表'>
        <div className='flex items-start justify-between gap-3'>
          <div className='space-y-1'>
            <h2 className='font-medium'>全部自有表</h2>
            <p className='text-sm text-muted'>新建的表也会自动包含在这把密钥的资源范围内。</p>
          </div>
          <span className='rounded-full bg-accent-soft px-2 py-1 text-xs font-medium text-accent-soft-foreground'>全部</span>
        </div>
      </section> : <div className='grid min-h-0 gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(220px,.78fr)]'>
        <section className='min-w-0 rounded-xl border border-border bg-surface' aria-labelledby='table-directory-heading'>
          <div className='flex items-start justify-between gap-3 p-4 pb-3'>
            <div className='space-y-1'>
              <h2 id='table-directory-heading' className='font-medium'>表目录</h2>
              <p className='text-sm text-muted'>选择这把密钥需要访问的表</p>
            </div>
            <span className='shrink-0 text-sm text-muted'>{tables.data?.data.length ?? 0} 张表</span>
          </div>
          <div className='px-4 pb-3'>
            <Input variant='secondary' aria-label='搜索表名称或标识' placeholder='搜索表名称或标识' value={query} disabled={mutation.isPending} onChange={event => setQuery(event.target.value)} />
          </div>
          <div className='flex items-center justify-between gap-3 px-4 pb-3 text-sm text-muted'>
            <span>显示 {visibleTables.length} 张</span>
            <Button type='button' variant='ghost' size='sm' isDisabled={visibleTables.length === 0 || mutation.isPending} onPress={toggleVisibleTables}>
              {visibleSelected ? '取消当前选择' : '选择当前显示'}
            </Button>
          </div>
          <div className='max-h-72 overflow-y-auto px-2 pb-2'>
            {tables.isLoading ? <p className='px-2 py-6 text-center text-sm text-muted'>加载中…</p> : null}
            {tables.error ? <div role='alert' className='grid gap-2 px-2 py-4'><p className='text-sm text-danger'>{tables.error.message}</p><Button variant='outline' isDisabled={tables.isFetching} onPress={() => void tables.refetch()}>重试</Button></div> : null}
            {!tables.isLoading && !tables.error && visibleTables.length === 0 ? <p className='px-2 py-6 text-center text-sm text-muted'>没有匹配的表</p> : null}
            {!tables.isLoading && !tables.error ? visibleTables.map(table => <Checkbox key={table.id} variant='secondary' className='min-w-0 w-full rounded-lg px-2 py-2 hover:bg-surface-secondary' isSelected={selected.includes(table.id)} isDisabled={mutation.isPending} onChange={checked => toggleTable(table.id, checked)}>
              <Checkbox.Content className='w-full min-w-0 gap-3'>
                <Checkbox.Control><Checkbox.Indicator /></Checkbox.Control>
                <span className='min-w-0 flex-1'>
                  <span className='block truncate font-medium'>{table.name}</span>
                  <span className='block truncate text-xs text-muted'>{table.id}</span>
                </span>
              </Checkbox.Content>
            </Checkbox>) : null}
          </div>
          <div className='flex justify-end gap-2 border-t border-separator px-4 py-3'>
            <Button type='button' variant='secondary' size='sm' isDisabled={!history.length || mutation.isPending} onPress={goPrevious}>上一页</Button>
            <Button type='button' variant='secondary' size='sm' isDisabled={!tables.data?.nextCursor || mutation.isPending} onPress={goNext}>下一页</Button>
          </div>
        </section>

        <section className='flex min-h-0 min-w-0 flex-col rounded-xl border border-border bg-surface' aria-labelledby='selected-resources-heading'>
          <div className='flex items-start justify-between gap-3 p-4 pb-3'>
            <div className='space-y-1'>
              <h2 id='selected-resources-heading' className='font-medium'>已选资源</h2>
              <p className='text-sm text-muted'>跨页选择会保留在这里</p>
            </div>
            <span className='rounded-full bg-accent-soft px-2 py-1 text-xs font-medium text-accent-soft-foreground'>{selected.length}</span>
          </div>
          <div className='max-h-72 min-h-0 flex-1 overflow-y-auto px-4'>
            {selectedTables.length === 0 ? <p className='py-8 text-center text-sm text-muted'>尚未选择表</p> : selectedTables.map(table => <div key={table.id} className='flex items-center justify-between gap-3 border-b border-separator py-3 last:border-0'>
              <span className='min-w-0'>
                <span className='block truncate text-sm font-medium'>{table.name}</span>
                <span className='block truncate text-xs text-muted'>{table.id}</span>
              </span>
              <Button type='button' variant='ghost' size='sm' isDisabled={mutation.isPending} aria-label={`移除表 ${table.id}`} onPress={() => removeSelected(table.id)}>移除</Button>
            </div>)}
          </div>
          <div className='flex items-center justify-between gap-3 border-t border-separator px-4 py-3'>
            <span className='text-sm text-muted'>{selected.length} 张表将获得访问权限</span>
            <Button type='button' variant='ghost' size='sm' isDisabled={selected.length === 0 || mutation.isPending} onPress={() => setSelected([])}>全部移除</Button>
          </div>
        </section>
      </div>}
    </div>
  </CloudModal>
}
