import { useState } from 'react'
import { Button, ComboBox, Description, Input, Label, ListBox } from '@heroui/react'
import type { CloudMember, CloudRange } from '@synapse/shared'
import { ConfirmDialog } from '@/components/confirm-dialog'
import type { CloudTablesModel } from './use-cloud-tables'
import { CloudCheck, CloudModal, CloudSelect } from './cloud-table-controls'
import { collaboratorName, useCloudCollaborators } from './use-cloud-collaborators'

const actions = [{ key: 'read', name: '查看' }, { key: 'create', name: '新增' }, { key: 'update', name: '修改' }, { key: 'delete', name: '删除' }] as const
const publicLabels = { read: '查看全部记录', create: '新增记录', update: '修改全部记录', delete: '删除全部记录' }

export function PermissionDialog({ model: m }: { model: CloudTablesModel }) {
  const [table] = useState(m.table!)
  const [anonymous, setAnonymous] = useState(table.anonymous)
  const [members, setMembers] = useState<CloudMember[]>(table.members ?? [])
  const [confirming, setConfirming] = useState(false)
  const picker = useCloudCollaborators(table.id)
  const disabledIds = [table.ownerId, ...members.map(member => member.userId)]
  const canAdd = picker.selected && !disabledIds.includes(picker.selected.id) && !m.mutation.isPending
  const danger = Boolean((anonymous.update && !table.anonymous.update) || (anonymous.delete && !table.anonymous.delete))
  const destructiveActions = [anonymous.update && '修改', anonymous.delete && '删除'].filter(Boolean).join('和')
  function add() {
    if (!canAdd || !picker.selected) return
    const user = picker.selected
    setMembers(current => [...current, { userId: user.id, handle: user.handle, nickname: user.nickname, permissions: { read: 'all', create: 'none', update: 'none', delete: 'none' } }])
    picker.clear()
  }
  async function save() {
    await m.mutation.mutateAsync({ path: `/${table.id}/permissions`, method: 'PATCH', body: { version: table.schemaVersion, anonymous, members: members.map(({ userId, permissions }) => ({ userId, permissions })) } })
    setConfirming(false)
  }
  function requestSave() { if (danger) setConfirming(true); else void save().catch(() => undefined) }
  function memberPermission(index: number, action: typeof actions[number]['key'], range: string) { setMembers(current => current.map((member, i) => i === index ? { ...member, permissions: { ...member.permissions, [action]: range as CloudRange } } : member)) }
  return <>
    <CloudModal title='访问权限' onClose={() => m.setDialog(null)} onSave={requestSave} pending={m.mutation.isPending}>
      <section aria-label='无需登录的访问权限' className='space-y-3'>
        <h3 className='font-medium'>无需登录的访问权限</h3>
        <div className='grid gap-3 sm:grid-cols-2'>{actions.map(a => <CloudCheck key={a.key} label={publicLabels[a.key]} selected={Boolean(anonymous[a.key])} onChange={checked => setAnonymous(v => ({ ...v, [a.key]: checked }))} />)}</div>
      </section>
      <section aria-label='协作者' className='space-y-3 border-t border-separator pt-4'>
        <h3 className='font-medium'>协作者</h3>
        <div className='grid gap-3 sm:flex sm:items-end'>
          <ComboBox fullWidth className='min-w-0 sm:flex-1' variant='secondary' allowsCustomValue allowsEmptyCollection inputValue={picker.input} onInputChange={picker.changeInput} selectedKey={picker.selected?.id ?? null} onSelectionChange={key => picker.select(key === null ? null : String(key))} items={picker.users} disabledKeys={disabledIds} isDisabled={m.mutation.isPending}>
            <Label>搜索用户</Label>
            <ComboBox.InputGroup><Input placeholder='邮箱、用户名或昵称' maxLength={320} /><ComboBox.Trigger /></ComboBox.InputGroup>
            <ComboBox.Popover className='w-(--trigger-width)'><ListBox items={picker.users} renderEmptyState={() => picker.busy ? '搜索中…' : picker.failed ? '搜索失败，请重试' : picker.input.trim() ? '未找到用户' : '输入邮箱、用户名或昵称'}>{user => <ListBox.Item id={user.id} textValue={collaboratorName(user)}><div className='min-w-0 flex-1'><Label className='block break-all'>{user.nickname || user.handle}</Label><Description className='block break-all'>{user.handle}{disabledIds.includes(user.id) ? ' · 已添加' : ''}</Description></div><ListBox.ItemIndicator /></ListBox.Item>}</ListBox></ComboBox.Popover>
          </ComboBox>
          <Button type='button' className='justify-self-end' variant='secondary' isDisabled={!canAdd} onPress={add}>添加</Button>
        </div>
        {picker.failed && <div role='alert' className='flex flex-wrap items-center gap-3'><p className='text-sm text-danger'>{picker.search.error?.message || '用户搜索失败'}</p><Button type='button' variant='secondary' isDisabled={picker.search.isFetching} onPress={() => void picker.search.refetch()}>重试</Button></div>}
        {picker.hasMore && <p role='status' className='text-sm text-muted'>匹配用户较多，请输入更完整的邮箱、用户名或昵称。</p>}
        {members.map((member, index) => <div key={member.userId} className='space-y-3 border-t border-separator pt-3'><div className='flex items-center justify-between gap-3'><div className='min-w-0'><p className='break-all'>{member.nickname || member.handle || member.userId}</p>{member.nickname && member.handle && <p className='break-all text-sm text-muted'>{member.handle}</p>}</div><Button type='button' variant='danger-soft' onPress={() => setMembers(v => v.filter(m => m.userId !== member.userId))}>移除</Button></div><div className='grid gap-3 sm:grid-cols-2'>{actions.map(a => <CloudSelect key={a.key} label={a.name} value={member.permissions[a.key] ?? 'none'} onChange={v => memberPermission(index, a.key, v)} items={[{ key: 'none', name: '不允许' }, ...(a.key !== 'create' ? [{ key: 'own', name: '仅本人创建的记录' }] : []), { key: 'all', name: a.key === 'create' ? '允许新增' : '全部记录' }]} />)}</div></div>)}
      </section>
    </CloudModal>
    <ConfirmDialog open={confirming} onOpenChange={setConfirming} title='允许任何人操作全部记录？' desc={`保存后，任何人无需登录即可${destructiveActions}全部记录。`} cancelBtnText='返回修改' confirmText='允许并保存' destructive isLoading={m.mutation.isPending} handleConfirm={() => void save().catch(() => undefined)} />
  </>
}
