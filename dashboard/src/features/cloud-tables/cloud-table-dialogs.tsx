import { useState } from 'react'
import { toast } from '@heroui/react'
import type { CloudField, CloudFieldType } from '@synapse/shared'
import type { CloudTablesModel } from './use-cloud-tables'
import { CloudCheck, CloudInput, CloudModal, CloudSelect } from './cloud-table-controls'
import { fieldInput, fieldTypes, parseFieldInput, parseOptions } from './cloud-table-forms'
import { PermissionDialog } from './cloud-table-permissions'

export function CloudTableDialogs({ model: m }: { model: CloudTablesModel }) {
  const d = m.dialog
  if (!d) return null
  if (d.kind === 'permissions' && m.table) return <PermissionDialog model={m} />
  if (d.kind === 'field') return <FieldDialog model={m} field={d.field} />
  if (d.kind === 'record') return <RecordDialog model={m} record={d.record} />
  return <NameDialog key={d.kind} model={m} />
}
function NameDialog({ model: m }: { model: CloudTablesModel }) {
  const [table] = useState(m.table)
  const [name, setName] = useState(m.dialog?.kind === 'rename' ? table?.name ?? '' : '')
  const deleting = m.dialog?.kind === 'deleteTable'
  async function save() {
    if (deleting && table) { await m.mutation.mutateAsync({ path: `/${table.id}`, method: 'DELETE', body: { version: table.schemaVersion } }); m.select(null); return }
    if (!name.trim()) { toast.danger('请输入表名称'); return }
    if (m.dialog?.kind === 'create') { const created = await m.mutation.mutateAsync({ path: '', method: 'POST', body: { name: name.trim(), fields: [] } }); m.select(created.id) }
    else if (table) await m.mutation.mutateAsync({ path: `/${table.id}`, method: 'PATCH', body: { version: table.schemaVersion, name: name.trim() } })
  }
  return <CloudModal title={deleting ? '删除数据表' : m.dialog?.kind === 'create' ? '创建数据表' : '重命名'} saveLabel={deleting ? '删除' : '保存'} danger={deleting} onClose={() => m.setDialog(null)} pending={m.mutation.isPending} onSave={() => void save().catch(() => undefined)}>{deleting ? <p>删除后保留30天，仅表主可恢复。</p> : <CloudInput label='表名称' value={name} onChange={setName} required />}</CloudModal>
}
function FieldDialog({ model: m, field }: { model: CloudTablesModel; field?: CloudField }) {
  const [table] = useState(m.table!)
  const [key, setKey] = useState(field?.key ?? ''), [name, setName] = useState(field?.name ?? ''), [type, setType] = useState<CloudFieldType>(field?.type ?? 'text')
  const [required, setRequired] = useState(field?.required ?? false), [value, setValue] = useState(fieldInput(field?.defaultValue, field?.type)), [options, setOptions] = useState(JSON.stringify(field?.options ?? [], null, 2))
  async function save() {
    try {
      const defaultValue = value ? parseFieldInput(type, value) : field?.type === type && fieldInput(field.defaultValue, type) === value ? field.defaultValue : undefined
      const next: CloudField = { key, name, type, required, ...(defaultValue !== undefined ? { defaultValue } : {}), ...(type.endsWith('Select') ? { options: parseOptions(options) } : {}) }
      await m.saveField(next, table)
    } catch (e) { if (!m.mutation.isError) toast.danger(e instanceof Error ? e.message : '字段无效') }
  }
  return <CloudModal title={field ? '编辑字段' : '添加字段'} onClose={() => m.setDialog(null)} onSave={() => void save()} pending={m.mutation.isPending}>
    <CloudInput label='字段名称' value={name} onChange={setName} required />
    <CloudInput label='API 标识' value={key} onChange={setKey} required disabled={Boolean(field)} />
    <CloudSelect label='字段类型' value={type} onChange={v => setType(v as CloudFieldType)} items={fieldTypes} />
    <CloudCheck label='必填' selected={required} onChange={setRequired} />
    <CloudInput label='默认值' value={value} onChange={setValue} multiline={type === 'json' || type === 'multiSelect'} />
    {type.endsWith('Select') && <CloudInput label='选项（JSON）' value={options} onChange={setOptions} multiline />}
  </CloudModal>
}
function RecordDialog({ model: m, record }: { model: CloudTablesModel; record?: import('@synapse/shared').CloudRecordDto }) {
  const [table] = useState(m.table!)
  const fields = table.fields.filter(f => !f.archivedAt)
  const [draft, setDraft] = useState<Record<string, string>>(() => Object.fromEntries(fields.map(f => [f.key, fieldInput(record ? record.values[f.key] : f.defaultValue, f.type)])))
  const set = (key: string, value: string) => setDraft(d => ({ ...d, [key]: value }))
  async function save() { try { await m.saveRecord(draft, record, table) } catch (e) { if (!m.mutation.isError) toast.danger(e instanceof Error ? e.message : '记录无效') } }
  return <CloudModal title={record ? '编辑记录' : '新增记录'} onClose={() => m.setDialog(null)} onSave={() => void save()} pending={m.mutation.isPending}>
    {fields.map(f => f.type === 'boolean' || f.type === 'singleSelect' ? <CloudSelect key={f.key} label={f.name} value={draft[f.key] ? `value:${draft[f.key]}` : 'null'} onChange={v => set(f.key, v === 'null' ? '' : v.slice(6))} items={[{ key: 'null', name: '空' }, ...(f.type === 'boolean' ? [{ key: 'true', name: '是' }, { key: 'false', name: '否' }] : f.options ?? []).map(o => ({ ...o, key: `value:${o.key}` }))]} /> : <CloudInput key={f.key} label={f.name} value={draft[f.key] ?? ''} onChange={v => set(f.key, v)} required={f.required && f.type !== 'text'} multiline={f.type === 'json' || f.type === 'multiSelect'} />)}
  </CloudModal>
}
