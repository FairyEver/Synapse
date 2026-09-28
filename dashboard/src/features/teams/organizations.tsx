import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type ColumnDef } from '@tanstack/react-table'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { adminApi, type AdminOrganizationRow, type AdminTeamMemberRow } from '@/lib/api'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { DEFAULT_DASHBOARD_PAGE_SIZE, ServerDataTable } from '@/components/data-table'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { AddMembersDialog } from './add-members-dialog'

type Editor = { id: string | null; name: string; parentId: string | null }

function pathOf(item: AdminOrganizationRow, byId: Map<string, AdminOrganizationRow>): string {
  const parts = [item.name]
  const seen = new Set([item.id])
  let parentId = item.parentId
  while (parentId && !seen.has(parentId)) {
    const parent = byId.get(parentId)
    if (!parent) break
    parts.unshift(parent.name)
    seen.add(parentId)
    parentId = parent.parentId
  }
  return parts.join(' / ')
}

function isDescendant(id: string, ancestorId: string, byId: Map<string, AdminOrganizationRow>): boolean {
  let current: string | null = id
  const seen = new Set<string>()
  while (current && !seen.has(current)) {
    if (current === ancestorId) return true
    seen.add(current)
    current = byId.get(current)?.parentId ?? null
  }
  return false
}

export function Organizations({ teamId }: { teamId: string }) {
  const queryClient = useQueryClient()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AdminOrganizationRow | null>(null)
  const [removeTarget, setRemoveTarget] = useState<AdminTeamMemberRow | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_DASHBOARD_PAGE_SIZE)
  const organizationsQuery = useQuery({ queryKey: ['admin-organizations', teamId], queryFn: () => adminApi.listOrganizations(teamId) })
  const organizations = organizationsQuery.data ?? []
  const byId = useMemo(() => new Map(organizations.map((item) => [item.id, item])), [organizations])
  const ordered = useMemo(() => [...organizations].sort((a, b) => pathOf(a, byId).localeCompare(pathOf(b, byId))), [organizations, byId])
  const selected = selectedId ? byId.get(selectedId) : undefined
  const membersQuery = useQuery({ queryKey: ['admin-organization-members', teamId, selectedId, page, pageSize], queryFn: () => adminApi.listOrganizationMembers(teamId, selectedId!, { page, pageSize }), enabled: Boolean(selected) })

  const save = useMutation({
    mutationFn: (input: Editor) => input.id ? adminApi.updateOrganization(teamId, input.id, input.name, input.parentId) : adminApi.createOrganization(teamId, input.name, input.parentId),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['admin-organizations', teamId] })
      setSelectedId(result.id)
      setEditor(null)
      toast.success('已保存组织')
    },
  })
  const remove = useMutation({
    mutationFn: (id: string) => adminApi.deleteOrganization(teamId, id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-organizations', teamId] })
      setSelectedId(null)
      setDeleteTarget(null)
      toast.success('已删除组织')
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const removeMember = useMutation({
    mutationFn: (userId: string) => adminApi.removeOrganizationMember(teamId, selectedId!, userId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-organizations', teamId] })
      void queryClient.invalidateQueries({ queryKey: ['admin-organization-members', teamId, selectedId] })
      setRemoveTarget(null)
      toast.success('已移出组织')
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const columns = useMemo<ColumnDef<AdminTeamMemberRow>[]>(() => [
    { accessorKey: 'email', header: '邮箱', cell: ({ row }) => row.original.email },
    { accessorKey: 'handle', header: '用户名', cell: ({ row }) => row.original.handle || '-' },
    { accessorKey: 'status', header: '状态', cell: ({ row }) => row.original.status === 'active' ? '正常' : '已禁用' },
    { id: 'actions', header: () => <span className='sr-only'>操作</span>, cell: ({ row }) => <div className='flex justify-end'><Button size='sm' variant='ghost' onClick={() => setRemoveTarget(row.original)}>移除</Button></div>, meta: { className: 'w-20', thClassName: 'text-right', tdClassName: 'text-right' } },
  ], [])

  return <section className='mt-8 space-y-4' aria-label='组织'>
    <div className='flex items-center justify-between'>
      <h2 className='font-medium'>组织</h2>
      <Button size='sm' variant='outline' onClick={() => setEditor({ id: null, name: '', parentId: null })}><Plus />新建组织</Button>
    </div>
    {organizationsQuery.isError && <p role='alert' className='text-sm text-destructive'>组织加载失败。<Button variant='ghost' size='sm' onClick={() => void organizationsQuery.refetch()}>重试</Button></p>}
    {!organizationsQuery.isLoading && !organizationsQuery.isError && !ordered.length && <p className='text-sm text-muted-foreground'>还没有组织</p>}
    {!!ordered.length && <div className='flex flex-col gap-1' aria-label='组织列表'>{ordered.map((item) => <Button key={item.id} variant={selectedId === item.id ? 'secondary' : 'ghost'} className='justify-start' onClick={() => { setSelectedId(item.id); setPage(1) }}><span className='min-w-0 flex-1 truncate text-left'>{pathOf(item, byId)}</span><span className='tabular-nums text-muted-foreground'>{item.memberCount} 人</span></Button>)}</div>}
    {selected && <div className='space-y-3'>
      <div className='flex flex-wrap items-center gap-2'>
        <h3 className='mr-auto font-medium'>{selected.name} · 直属成员 {selected.directCount}</h3>
        <Button size='sm' variant='outline' onClick={() => setEditor({ id: null, name: '', parentId: selected.id })}>新建下级</Button>
        <Button size='sm' variant='outline' onClick={() => setEditor({ id: selected.id, name: selected.name, parentId: selected.parentId })}>编辑</Button>
        <Button size='sm' variant='destructive' onClick={() => setDeleteTarget(selected)}>删除</Button>
        <Button size='sm' onClick={() => setAddOpen(true)}><Plus />添加成员</Button>
      </div>
      <ServerDataTable columns={columns} data={membersQuery.data?.data ?? []} page={page} pageSize={pageSize} total={membersQuery.data?.total ?? 0} error={membersQuery.isError ? membersQuery.error : null} isLoading={membersQuery.isLoading} onRetry={() => void membersQuery.refetch()} onPageChange={setPage} onPageSizeChange={setPageSize} sorting={[]} emptyMessage='没有直属成员' />
      <AddMembersDialog open={addOpen} teamId={teamId} organizationId={selected.id} onOpenChange={setAddOpen} />
    </div>}
    <Dialog open={editor !== null} onOpenChange={(open) => { if (!open) { setEditor(null); save.reset() } }}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader><DialogTitle>{editor?.id ? '编辑组织' : '新建组织'}</DialogTitle></DialogHeader>
        <div className='grid gap-2'><Label htmlFor='organization-name'>组织名称</Label><Input id='organization-name' value={editor?.name ?? ''} maxLength={30} onChange={(event) => setEditor((current) => current && { ...current, name: event.target.value })} /></div>
        <div className='grid gap-2'><Label>上级组织</Label><Select value={editor?.parentId ?? 'root'} onValueChange={(value) => setEditor((current) => current && { ...current, parentId: value === 'root' ? null : value })}><SelectTrigger className='w-full'><SelectValue /></SelectTrigger><SelectContent><SelectItem value='root'>无</SelectItem>{ordered.filter((item) => !editor?.id || !isDescendant(item.id, editor.id, byId)).map((item) => <SelectItem key={item.id} value={item.id}>{pathOf(item, byId)}</SelectItem>)}</SelectContent></Select></div>
        {save.error && <p role='alert' className='text-sm text-destructive'>{save.error.message}</p>}
        <DialogFooter><Button variant='outline' onClick={() => setEditor(null)}>取消</Button><Button disabled={save.isPending || !editor?.name.trim()} onClick={() => editor && save.mutate({ ...editor, name: editor.name.trim() })}>保存</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <ConfirmDialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }} title={deleteTarget ? `删除组织「${deleteTarget.name}」？` : ''} desc='下级组织和成员关系将一并删除，用户账号与已发信件不受影响。' destructive confirmText='删除' isLoading={remove.isPending} handleConfirm={() => deleteTarget && remove.mutate(deleteTarget.id)} />
    <ConfirmDialog open={removeTarget !== null} onOpenChange={(open) => { if (!open) setRemoveTarget(null) }} title={removeTarget ? `把 ${removeTarget.email} 移出组织？` : ''} desc='成员仍属于团队及其他组织。' confirmText='移除' isLoading={removeMember.isPending} handleConfirm={() => removeTarget && removeMember.mutate(removeTarget.userId)} />
  </section>
}
