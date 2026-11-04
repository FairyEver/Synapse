import { Button, Label, ListBox, Modal, Select, Spinner } from '@heroui/react'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import type { SkillHubAdminRow } from '@synapse/shared/skill-hub-contracts'
import { adminApi, type AdminTeamMemberRow } from '@/lib/api'
import { useTeamSkillWrite } from './use-team-skill-write'

const pageSize = 100

export async function loadActiveTeamSkillCandidates(teamId: string, currentId: string | null, signal?: AbortSignal) {
  const candidates = new Map<string, AdminTeamMemberRow>()
  let pages = 1
  for (let page = 1; page <= pages; page++) {
    signal?.throwIfAborted()
    const result = await adminApi.listTeamMembers(teamId, { page, pageSize }, signal)
    if (page === 1) pages = Math.max(1, Math.ceil(result.total / pageSize))
    for (const member of result.data) {
      if (member.status === 'active' && member.userId !== currentId) candidates.set(member.userId, member)
    }
  }
  return [...candidates.values()]
}

export function TeamSkillMaintainerDialog({ row, onClose, onSuccess }: {
  row: SkillHubAdminRow; onClose: () => void; onSuccess: (row: SkillHubAdminRow) => void
}) {
  const [selected, setSelected] = useState<string>()
  const action = useTeamSkillWrite(row, onSuccess)
  const current = action.baseline.maintainer.id
  const members = useQuery({
    queryKey: ['admin-team-skill-candidates', row.team.id, current], retry: false,
    queryFn: ({ signal }) => loadActiveTeamSkillCandidates(row.team.id, current, signal),
  })
  const candidate = members.data?.find((member) => member.userId === selected)
  function confirm() {
    if (action.unknown) { void action.run(); return }
    if (!candidate) return
    void action.run((input) => adminApi.assignSkillMaintainer(row.id, { ...input, maintainerUserId: candidate.userId }))
  }
  return <Modal.Backdrop isOpen isDismissable={!action.busy && !action.unknown} isKeyboardDismissDisabled={action.busy || action.unknown}
    onOpenChange={(open) => { if (!open && !action.busy && !action.unknown) onClose() }}>
    <Modal.Container>
      <Modal.Dialog>
        <Modal.CloseTrigger isDisabled={action.busy || action.unknown} />
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={(event) => { event.preventDefault(); confirm() }}>
          <Modal.Header className="pe-8"><Modal.Heading>指派维护者</Modal.Heading></Modal.Header>
          <Modal.Body className="space-y-3">
            <p className="wrap-anywhere font-medium">{row.displayName}</p>
            <p className="wrap-anywhere text-sm text-muted">当前维护者：{action.baseline.maintainer.displayName}</p>
            {members.isLoading ? <p role="status"><Spinner size="sm" /> 正在读取成员</p>
              : members.isError ? <div className="flex flex-wrap items-center gap-2"><p role="alert" className="text-danger">无法读取团队成员。</p>
                <Button type="button" variant="secondary" onPress={() => void members.refetch()}>重试</Button></div>
                : members.data?.length ? <Select variant="secondary" selectedKey={selected ?? null}
                  isDisabled={action.busy || action.unknown} placeholder="选择有效成员"
                  onSelectionChange={(key) => setSelected(typeof key === 'string' ? key : undefined)}>
                  <Label>新维护者</Label><Select.Trigger><Select.Value className="min-w-0 truncate" /><Select.Indicator /></Select.Trigger>
                  <Select.Popover className="w-(--trigger-width)"><ListBox items={members.data}>{(member) => {
                    const label = member.handle || member.email
                    return <ListBox.Item id={member.userId} textValue={label}><span className="min-w-0 truncate" title={label}>{label}</span><ListBox.ItemIndicator /></ListBox.Item>
                  }}</ListBox></Select.Popover>
                </Select> : <p className="text-sm text-muted">没有可指派的其他有效成员。</p>}
            {action.error ? <p className="wrap-anywhere text-sm text-danger" role="alert">{action.error}</p> : null}
            {action.conflict ? <Button type="button" variant="secondary" isPending={action.busy}
              onPress={() => void action.reload()}>读取当前资料</Button> : null}
          </Modal.Body>
          <Modal.Footer className="flex-wrap">
            <Button type="button" variant="tertiary" isDisabled={action.busy || action.unknown} onPress={onClose}>取消</Button>
            <Button type="submit" isDisabled={(!candidate && !action.unknown) || action.conflict} isPending={action.busy}>
              {action.unknown ? '重试原请求' : '指派'}
            </Button>
          </Modal.Footer>
        </form>
      </Modal.Dialog>
    </Modal.Container>
  </Modal.Backdrop>
}
