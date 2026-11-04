import { Button, Chip, Label, ListBox, Select, toast } from '@heroui/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { useMemo, useState } from 'react'
import type { SkillHubAdminRow } from '@synapse/shared/skill-hub-contracts'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { DEFAULT_DASHBOARD_PAGE_SIZE, ServerDataTable } from '@/components/data-table'
import { LongText } from '@/components/long-text'
import { adminApi } from '@/lib/api'
import { useAdminAuthStore } from '@/stores/admin-auth-store'
import { TeamSkillMaintainerDialog } from './team-skill-maintainer-dialog'
import { useTeamSkillWrite } from './use-team-skill-write'

type Filter = 'all' | 'active' | 'deleted'
type Action = { mode: 'assign' | 'restore'; row: SkillHubAdminRow }
const size = DEFAULT_DASHBOARD_PAGE_SIZE
const filters = [{ id: 'all', label: '全部状态' }, { id: 'active', label: '正常' }, { id: 'deleted', label: '已删除' }]

export function TeamSkills({ teamId }: { teamId: string }) {
  const session = useAdminAuthStore((state) => state.auth.session?.sessionId ?? '')
  return <TeamSkillsSection key={`${session}:${teamId}`} session={session} teamId={teamId} />
}

function TeamSkillsSection({ teamId, session }: { teamId: string; session: string }) {
  const [filter, setFilter] = useState<Filter>('all')
  const [trail, setTrail] = useState<string[]>([])
  const [action, setAction] = useState<Action | null>(null)
  const cache = useQueryClient()
  const key = ['admin-team-skills', session, teamId] as const
  const assets = useQuery({
    queryKey: [...key, filter, trail.at(-1)], retry: false,
    queryFn: ({ signal }) => adminApi.listTeamSkills(teamId, { limit: size, cursor: trail.at(-1),
      deleted: filter === 'all' ? undefined : filter === 'deleted' }, signal),
  })
  const columns = useMemo<ColumnDef<SkillHubAdminRow>[]>(() => [
    { accessorKey: 'displayName', header: '商店名称', cell: ({ row }) => <LongText className="font-medium">{row.original.displayName}</LongText>, meta: { className: 'max-w-56' } },
    { accessorKey: 'packageName', header: '包内名称', cell: ({ row }) => <LongText>{row.original.packageName}</LongText>, meta: { className: 'max-w-40' } },
    { id: 'createdBy', header: '贡献者', cell: ({ row }) => <LongText>{row.original.createdBy.displayName}</LongText>, meta: { className: 'max-w-40' } },
    { id: 'maintainer', header: '维护者', cell: ({ row }) => <LongText>{row.original.maintainer.displayName}{row.original.maintainer.isActiveMember ? '' : '（待指派）'}</LongText>, meta: { className: 'max-w-48' } },
    { accessorKey: 'currentVersionNumber', header: '当前版本', cell: ({ row }) => <span className="tabular-nums">v{row.original.currentVersionNumber}</span>,
      meta: { thClassName: 'text-end', tdClassName: 'text-end' } },
    { accessorKey: 'deletedAt', header: '状态', cell: ({ row }) => <Chip color={row.original.deletedAt ? 'default' : 'accent'}>{row.original.deletedAt ? '已删除' : '正常'}</Chip> },
    { id: 'actions', header: '操作', enableHiding: false, cell: ({ row }) => <div className="flex justify-end gap-2">
      <Button variant="ghost" size="sm" onPress={() => setAction({ mode: 'assign', row: row.original })}>指派维护者</Button>
      {row.original.deletedAt ? <Button variant="secondary" size="sm" onPress={() => setAction({ mode: 'restore', row: row.original })}>恢复</Button> : null}
    </div> },
  ], [])
  function onSuccess() {
    if (action?.mode === 'restore') setTrail([])
    setAction(null)
    void cache.invalidateQueries({ queryKey: key })
    toast.success(action?.mode === 'restore' ? 'Skill 已恢复' : '已指派维护者')
  }

  return <section className="flex min-w-0 flex-col gap-3" aria-labelledby="team-skills-heading">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 id="team-skills-heading" className="font-medium">Skill Hub 资产</h2>
      <Select selectedKey={filter} onSelectionChange={(value) => {
        if (value === 'all' || value === 'active' || value === 'deleted') { setFilter(value); setTrail([]) }
      }} className="min-w-36" aria-label="资产状态">
        <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
        <Select.Popover><ListBox items={filters}>{(item) => <ListBox.Item id={item.id} textValue={item.label}>
          <Label>{item.label}</Label><ListBox.ItemIndicator />
        </ListBox.Item>}</ListBox></Select.Popover>
      </Select>
    </div>
    <ServerDataTable columns={columns} data={assets.data?.items ?? []} page={1} pageSize={size} total={0}
      showPagination={false} clampPage={false} onPageChange={() => undefined} onPageSizeChange={() => undefined}
      isLoading={assets.isPending} loadingRowCount={3} className="flex-none" error={assets.error}
      onRetry={() => { if (trail.length) setTrail([]); else void assets.refetch() }}
      emptyMessage="没有符合条件的团队 Skill。" />
    {trail.length || assets.data?.nextCursor ? <div className="flex flex-wrap justify-end gap-2">
      <Button variant="secondary" isDisabled={!trail.length || assets.isFetching} onPress={() => setTrail((value) => value.slice(0, -1))}>上一页</Button>
      <Button variant="secondary" isDisabled={!assets.data?.nextCursor || assets.isFetching}
        onPress={() => { const next = assets.data?.nextCursor; if (next) setTrail((value) => [...value, next]) }}>下一页</Button>
    </div> : null}
    {action?.mode === 'assign' ? <TeamSkillMaintainerDialog row={action.row} onClose={() => setAction(null)} onSuccess={onSuccess} /> : null}
    {action?.mode === 'restore' ? <TeamSkillRestoreDialog row={action.row} onClose={() => setAction(null)} onSuccess={onSuccess} /> : null}
  </section>
}

export function TeamSkillRestoreDialog({ row, onClose, onSuccess }: {
  row: SkillHubAdminRow; onClose: () => void; onSuccess: (row: SkillHubAdminRow) => void
}) {
  const action = useTeamSkillWrite(row, onSuccess)
  return <ConfirmDialog open onOpenChange={(open) => { if (!open && !action.unknown) onClose() }}
    title="恢复 Skill？" desc={<p className="wrap-anywhere">「{row.displayName}」将重新在所属团队中可见。</p>}
    confirmText={action.unknown ? '重试原请求' : '恢复'} isLoading={action.busy}
    disabled={action.conflict || !action.baseline.deletedAt}
    handleConfirm={() => void action.run((input) => adminApi.restoreSkill(row.id, input))}>
    {action.error ? <p className="mt-2 wrap-anywhere text-sm text-danger" role="alert">{action.error}</p> : null}
    {action.conflict ? <Button variant="secondary" onPress={() => void action.reload()}>读取当前资料</Button> : null}
  </ConfirmDialog>
}
