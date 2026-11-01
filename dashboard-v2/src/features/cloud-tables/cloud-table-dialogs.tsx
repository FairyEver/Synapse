import { useState } from 'react'
import { Button, toast } from '@heroui/react'
import type { CloudField, CloudFieldType, CloudMember, CloudRange } from '@synapse/shared'
import type { CloudTablesModel } from './use-cloud-tables'
import { CloudCheck, CloudInput, CloudModal, CloudSelect } from './cloud-table-controls'
import { fieldInput, fieldTypes, parseFieldInput, parseOptions } from './cloud-table-forms'
import { cloudTableApi } from './cloud-table-api'

const actions = [{ key: 'read', name: '查询' }, { key: 'create', name: '新增' }, { key: 'update', name: '修改' }, { key: 'delete', name: '删除' }] as const
export function CloudTableDialogs({ model: m }: { model: CloudTablesModel }) {
  const d = m.dialog
  if (!d) return null
  if (d.kind === 'permissions' && m.table) return <PermissionDialog model={m} />
  if (d.kind === 'field') return <FieldDialog model={m} field={d.field} />
  if (d.kind === 'record') return <RecordDialog model={m} record={d.record} />
  return <NameDialog key={d.kind} model={m} />
}
function NameDialog({ model: m }: { model: CloudTablesModel }) {
  const [name, setName] = useState(m.dialog?.kind === 'rename' ? m.table?.name ?? '' : '')
  const deleting = m.dialog?.kind === 'deleteTable'
  async function save() {
    if (deleting && m.table) { await m.mutation.mutateAsync({ path: `/${m.table.id}`, method: 'DELETE', body: { version: m.table.schemaVersion } }); m.select(null); return }
    if (!name.trim()) { toast.danger('请输入表名称'); return }
    if (m.dialog?.kind === 'create') { const created = await m.mutation.mutateAsync({ path: '', method: 'POST', body: { name: name.trim(), fields: [] } }); m.select(created.id) }
    else if (m.table) await m.mutation.mutateAsync({ path: `/${m.table.id}`, method: 'PATCH', body: { version: m.table.schemaVersion, name: name.trim() } })
  }
  return <CloudModal title={deleting ? '删除数据表' : m.dialog?.kind === 'create' ? '创建数据表' : '重命名'} saveLabel={deleting ? '删除' : '保存'} danger={deleting} onClose={() => m.setDialog(null)} pending={m.mutation.isPending} onSave={() => void save().catch(() => undefined)}>{deleting ? <p>删除后保留30天，仅表主可恢复。</p> : <CloudInput label='表名称' value={name} onChange={setName} required />}</CloudModal>
}
function FieldDialog({ model: m, field }: { model: CloudTablesModel; field?: CloudField }) {
  const [key, setKey] = useState(field?.key ?? ''), [name, setName] = useState(field?.name ?? ''), [type, setType] = useState<CloudFieldType>(field?.type ?? 'text')
  const [required, setRequired] = useState(field?.required ?? false), [value, setValue] = useState(fieldInput(field?.defaultValue, field?.type)), [options, setOptions] = useState(field?.options?.map(o => `${o.key}:${o.name}`).join('\n') ?? '')
  async function save() {
    try {
      const next: CloudField = { key, name, type, required, ...(value ? { defaultValue: parseFieldInput(type, value) } : {}), ...(type.endsWith('Select') ? { options: parseOptions(options) } : {}) }
      await m.saveField(next)
    } catch (e) { if (!m.mutation.isError) toast.danger(e instanceof Error ? e.message : '字段无效') }
  }
  return <CloudModal title={field ? '编辑字段' : '添加字段'} onClose={() => m.setDialog(null)} onSave={() => void save()} pending={m.mutation.isPending}>
    <CloudInput label='字段名称' value={name} onChange={setName} required />
    <CloudInput label='API 标识' value={key} onChange={setKey} required disabled={Boolean(field)} />
    <CloudSelect label='字段类型' value={type} onChange={v => setType(v as CloudFieldType)} items={fieldTypes} />
    <CloudCheck label='必填' selected={required} onChange={setRequired} />
    <CloudInput label='默认值' value={value} onChange={setValue} multiline={type === 'json' || type === 'multiSelect'} />
    {type.endsWith('Select') && <CloudInput label='选项（每行 标识:名称）' value={options} onChange={setOptions} multiline />}
  </CloudModal>
}
function RecordDialog({ model: m, record }: { model: CloudTablesModel; record?: import('@synapse/shared').CloudRecordDto }) {
  const fields = m.table!.fields.filter(f => !f.archivedAt)
  const [draft, setDraft] = useState<Record<string, string>>(() => Object.fromEntries(fields.map(f => [f.key, fieldInput(record ? record.values[f.key] : f.defaultValue, f.type)])))
  const set = (key: string, value: string) => setDraft(d => ({ ...d, [key]: value }))
  async function save() { try { await m.saveRecord(draft, record) } catch (e) { if (!m.mutation.isError) toast.danger(e instanceof Error ? e.message : '记录无效') } }
  return <CloudModal title={record ? '编辑记录' : '新增记录'} onClose={() => m.setDialog(null)} onSave={() => void save()} pending={m.mutation.isPending}>
    {fields.map(f => f.type === 'boolean' || f.type === 'singleSelect' ? <CloudSelect key={f.key} label={f.name} value={draft[f.key] || '_null'} onChange={v => set(f.key, v === '_null' ? '' : v)} items={[{ key: '_null', name: '空' }, ...(f.type === 'boolean' ? [{ key: 'true', name: '是' }, { key: 'false', name: '否' }] : f.options ?? [])]} /> : <CloudInput key={f.key} label={f.name} value={draft[f.key] ?? ''} onChange={v => set(f.key, v)} required={f.required} multiline={f.type === 'json' || f.type === 'multiSelect'} />)}
  </CloudModal>
}
function PermissionDialog({ model: m }: { model: CloudTablesModel }) {
  const table = m.table!, [anonymous, setAnonymous] = useState(table.anonymous), [members, setMembers] = useState<CloudMember[]>(table.members ?? [])
  const [handle, setHandle] = useState(''), [acknowledged, setAcknowledged] = useState(false), [resolving, setResolving] = useState(false)
  const danger = Boolean((anonymous.update && !table.anonymous.update) || (anonymous.delete && !table.anonymous.delete))
  async function add() {
    setResolving(true)
    try {
      const user = await cloudTableApi.send<{ id: string; handle: string }>(`/${table.id}/collaborators/resolve`, 'POST', { handle })
      if (members.some(m => m.userId === user.id) || user.id === table.ownerId) throw new Error('该用户已在列表中')
      setMembers(m => [...m, { userId: user.id, handle: user.handle, permissions: { read: 'all', create: 'none', update: 'none', delete: 'none' } }]); setHandle('')
    } catch (e) { toast.danger(e instanceof Error ? e.message : '查找失败') } finally { setResolving(false) }
  }
  async function save() {
    if (danger && !acknowledged) { toast.danger('请确认匿名修改或删除权限'); return }
    await m.mutation.mutateAsync({ path: `/${table.id}/permissions`, method: 'PATCH', body: { version: table.schemaVersion, anonymous, members: members.map(({ userId, permissions }) => ({ userId, permissions })) } })
  }
  function memberPermission(index: number, action: typeof actions[number]['key'], range: string) { setMembers(current => current.map((member, i) => i === index ? { ...member, permissions: { ...member.permissions, [action]: range as CloudRange } } : member)) }
  return <CloudModal title='访问权限' onClose={() => m.setDialog(null)} onSave={() => void save().catch(() => undefined)} pending={m.mutation.isPending}>
    <div className='flex flex-wrap gap-4'>{actions.map(a => <CloudCheck key={a.key} label={`匿名${a.name}`} selected={Boolean(anonymous[a.key])} onChange={checked => setAnonymous(v => ({ ...v, [a.key]: checked }))} />)}</div>
    {danger && <CloudCheck label='确认允许任何人修改或删除全部记录' selected={acknowledged} onChange={setAcknowledged} />}
    <div className='flex flex-wrap items-end gap-3'><div className='min-w-0 flex-1'><CloudInput label='协作者 SY 用户名' value={handle} onChange={setHandle} /></div><Button variant='secondary' isPending={resolving} onPress={() => void add()}>添加</Button></div>
    {members.map((member, index) => <div key={member.userId} className='space-y-3 border-t border-separator pt-3'><div className='flex items-center justify-between gap-3'><span className='break-all'>{member.handle ?? member.userId}</span><Button variant='danger-soft' onPress={() => setMembers(v => v.filter(m => m.userId !== member.userId))}>移除</Button></div><div className='grid gap-3 sm:grid-cols-2'>{actions.map(a => <CloudSelect key={a.key} label={a.name} value={member.permissions[a.key] ?? 'none'} onChange={v => memberPermission(index, a.key, v)} items={[{ key: 'none', name: '禁止' }, ...(a.key !== 'create' ? [{ key: 'own', name: '本人记录' }] : []), { key: 'all', name: '全部记录' }]} />)}</div></div>)}
  </CloudModal>
}
