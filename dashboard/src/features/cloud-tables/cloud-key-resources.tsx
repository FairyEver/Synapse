import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, toast } from '@heroui/react'
import type { DashboardApiKey } from '@/lib/api'
import type { CloudKeyResources } from '@synapse/shared'
import { cloudTableApi } from './cloud-table-api'
import { CloudCheck, CloudModal, CloudSelect } from './cloud-table-controls'
import { useAuthStore } from '@/stores/auth-store'
export function CloudKeyResourcesDialog({ apiKey, onClose }: { apiKey: DashboardApiKey; onClose: () => void }) {
  const session = useAuthStore(s => s.auth.user?.sessionId ?? 'anonymous')
  const cache = useQueryClient(), [mode, setMode] = useState<CloudKeyResources['mode']>(apiKey.tableResources?.mode ?? 'selected'), [selected, setSelected] = useState(apiKey.tableResources?.tableIds ?? []), [cursor, setCursor] = useState<string | undefined>(), [history, setHistory] = useState<(string | undefined)[]>([])
  const tables = useQuery({ queryKey: ['cloud-tables', session, 'key-resources', cursor], queryFn: ({ signal }) => cloudTableApi.list(false, cursor, signal) })
  const mutation = useMutation({ mutationFn: () => cloudTableApi.resources(apiKey.id, { mode, tableIds: mode === 'all_owned' ? [] : selected }), onSuccess: () => { void cache.invalidateQueries({ queryKey: ['dashboard-api-keys'] }); onClose() }, onError: (e: Error) => toast.danger(e.message) })
  return <CloudModal title='密钥的表资源' onClose={onClose} onSave={() => mutation.mutate()} pending={mutation.isPending}>
    <CloudSelect label='资源范围' value={mode} onChange={v => setMode(v as CloudKeyResources['mode'])} items={[{ key: 'selected', name: '指定表' }, { key: 'all_owned', name: '自己的全部表（包括以后创建的表）' }]} />
    {mode === 'selected' && <><p className='text-sm text-muted'>已选择 {selected.length} 张表</p>{tables.isLoading ? <p>加载中…</p> : tables.error ? <div role='alert'><p>{tables.error.message}</p><Button variant='secondary' onPress={() => void tables.refetch()}>重试</Button></div> : <div className='space-y-3'>{tables.data?.data.map(t => <CloudCheck key={t.id} label={t.name} selected={selected.includes(t.id)} onChange={checked => setSelected(v => checked ? [...v, t.id] : v.filter(id => id !== t.id))} />)}</div>}<div className='flex justify-end gap-3'><Button variant='secondary' isDisabled={!history.length} onPress={() => setHistory(h => { setCursor(h.at(-1)); return h.slice(0, -1) })}>上一页</Button><Button variant='secondary' isDisabled={!tables.data?.nextCursor} onPress={() => { setHistory(h => [...h, cursor]); setCursor(tables.data!.nextCursor!) }}>下一页</Button></div></>}
  </CloudModal>
}
