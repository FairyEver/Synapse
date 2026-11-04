import { Button, Dropdown, Header, Label, toast } from '@heroui/react'
import { Copy, Ellipsis, Pencil, Trash2, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import type { SkillHubDetail } from '@synapse/shared/skill-hub-contracts'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { skillHubApi } from './skill-hub-api'
import { buildHubUpdateInstruction, SkillMetadataDialog } from './skill-metadata-dialog'
import { SkillUploadDialog } from './skill-upload-dialog'
import { useSkillPublish } from './use-skill-publish'

type Mode = 'edit' | 'publish' | 'delete'

export function SkillMaintenance({ skill, session, onDeleted }: { skill: SkillHubDetail; session: string; onDeleted: () => void }) {
  const [mode, setMode] = useState<Mode | null>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  function close() {
    setMode(null)
    requestAnimationFrame(() => trigger.current?.focus())
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(buildHubUpdateInstruction(window.location.origin, skill))
      toast.success('已复制 AI 更新指令')
    } catch { toast.danger('复制失败，请重试。') }
  }
  const permissions = skill.permissions
  const canMaintain = permissions.canEditMetadata || permissions.canPublishVersion || permissions.canDelete
  if (!canMaintain && !mode) return null
  return <>
    {canMaintain ? <Dropdown>
      <Button variant="ghost" ref={trigger} isIconOnly aria-label="维护 Skill"><Ellipsis aria-hidden="true" /></Button>
      <Dropdown.Popover placement="bottom end">
        <Dropdown.Menu aria-label="维护 Skill">
          {permissions.canEditMetadata ? <Dropdown.Item id="edit" textValue="编辑资料" onAction={() => setMode('edit')}>
            <Pencil aria-hidden="true" className="size-4 shrink-0 text-muted" /><Label>编辑资料</Label>
          </Dropdown.Item> : null}
          {permissions.canPublishVersion ? <Dropdown.Section>
            {permissions.canEditMetadata ? <Header>更新 Skill</Header> : null}
            <Dropdown.Item id="publish" textValue="上传新版本" onAction={() => setMode('publish')}>
              <Upload aria-hidden="true" className="size-4 shrink-0 text-muted" /><Label>上传新版本</Label>
            </Dropdown.Item>
            <Dropdown.Item id="copy" textValue="复制 AI 更新指令" onAction={() => void copy()}>
              <Copy aria-hidden="true" className="size-4 shrink-0 text-muted" /><Label>复制 AI 更新指令</Label>
            </Dropdown.Item>
          </Dropdown.Section> : null}
          {permissions.canDelete ? <Dropdown.Item id="delete" variant="danger" textValue="删除 Skill" onAction={() => setMode('delete')}>
            <Trash2 aria-hidden="true" className="size-4 shrink-0 text-danger" /><Label>删除 Skill</Label>
          </Dropdown.Item> : null}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown> : null}
    {mode === 'edit' ? <SkillMetadataDialog skill={skill} session={session} onClose={close} /> : null}
    {mode === 'publish' ? <SkillUploadDialog skill={skill} session={session} onClose={close} /> : null}
    {mode === 'delete' ? <SkillDeleteDialog skill={skill} session={session} onClose={close} onDeleted={onDeleted} /> : null}
  </>
}

export function SkillDeleteDialog({ skill, session, onClose, onDeleted }: {
  skill: SkillHubDetail; session: string; onClose: () => void; onDeleted: () => void
}) {
  const [baseline, setBaseline] = useState(skill)
  const [reloading, setReloading] = useState(false)
  const model = useSkillPublish({ session, action: 'app.skill_hub.skill.delete', target: skill.id,
    onCommitted: () => { toast.success('Skill 已删除'); onDeleted() } })

  async function refresh() {
    if (reloading) return
    setReloading(true)
    try {
      const fresh = await skillHubApi.get(session, skill.id)
      setBaseline(fresh)
      model.setError(fresh.permissions.canDelete ? '' : '当前账号已无法删除此 Skill。')
      model.setConflict(false)
    } catch { model.setError('无法读取当前资料，请重试。') }
    finally { setReloading(false) }
  }

  return <ConfirmDialog open onOpenChange={(open) => { if (!open) onClose() }}
    title="删除 Skill？" desc={<p className="wrap-anywhere">团队将无法再访问「{baseline.displayName}」。平台管理员可以恢复。</p>}
    destructive={!model.pendingId} confirmText={model.pendingId ? '查询回执' : '删除 Skill'}
    isLoading={model.busy || reloading} disabled={model.conflict || (!baseline.permissions.canDelete && !model.pendingId)}
    handleConfirm={() => {
      if (model.pendingId) { void model.check(); return }
      void model.submit(async () => (requestId) => skillHubApi.delete(session, baseline.id, { expectedRevision: baseline.revision, requestId }))
    }}>
    {model.error ? <p role="alert" className="mt-2 text-sm text-danger">{model.error}</p> : null}
    {model.conflict ? <Button variant="secondary" onPress={() => void refresh()}>读取当前资料</Button> : null}
    {model.pendingId && model.canRetry ? <Button variant="secondary" isDisabled={model.busy} onPress={() => void model.retryOriginal()}>重试原请求</Button> : null}
  </ConfirmDialog>
}
