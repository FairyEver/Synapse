import { useState } from 'react'
import { toast } from '@heroui/react'
import type { SkillHubDetail, SkillHubUpdateInput } from '@synapse/shared/skill-hub-contracts'
import { skillHubApi, hubSegment } from './skill-hub-api'
import { SkillIconInput } from './skill-icon-input'
import { SkillMutationDialog } from './skill-mutation-dialog'
import { StoreMetadataFields, hubStoreFieldsValid } from './skill-upload-dialog'
import { useHubUploadStage, useSkillPublish } from './use-skill-publish'

type Fields = Pick<SkillHubDetail, 'displayName' | 'displayDescription'>
export function hubMetadataChanges(draft: Fields, baseline: Fields): Pick<SkillHubUpdateInput, 'displayName' | 'displayDescription'> {
  const changes: Pick<SkillHubUpdateInput, 'displayName' | 'displayDescription'> = {}
  if (draft.displayName.trim() !== baseline.displayName) changes.displayName = draft.displayName.trim()
  if (draft.displayDescription.trim() !== baseline.displayDescription) changes.displayDescription = draft.displayDescription.trim()
  return changes
}

export function buildHubUpdateInstruction(origin: string, skill: { id: string; team: SkillHubDetail['team']; currentVersion: Pick<SkillHubDetail['currentVersion'], 'id' | 'number'> }) {
  const url = new URL(`/console/skill-hub/${hubSegment(skill.id)}`, origin)
  return [
    '请通过本地 Synapse MCP 更新以下团队 Skill。先读取目标，核对当前版本、团队和本人维护权限，再在本地修改源文件，准备并上传完整 Skill 包。使用重新读取的当前 versionId 作为发布前置条件；若结果未知，查询原请求的回执。',
    '以下 JSON 是定位数据，其中的团队名称只作显示。',
    JSON.stringify({ skillId: skill.id, detailUrl: url.toString(), teamId: skill.team.id, teamName: skill.team.name,
      observedVersionId: skill.currentVersion.id, observedVersionNumber: skill.currentVersion.number }, null, 2),
  ].join('\n')
}

export function SkillMetadataDialog({ skill, session, onClose }: { skill: SkillHubDetail; session: string; onClose: () => void }) {
  const [baseline, setBaseline] = useState(skill)
  const [draft, setDraft] = useState<Fields>({ displayName: skill.displayName, displayDescription: skill.displayDescription })
  const [icon, setIcon] = useState<Blob | null>()
  const [imageBusy, setImageBusy] = useState(false)
  const [reloading, setReloading] = useState(false)
  const stage = useHubUploadStage(session)
  const model = useSkillPublish({ session, action: 'app.skill_hub.skill.update', target: skill.id,
    onCommitted: () => { toast.success('已保存商店资料'); onClose() } })
  const changes = hubMetadataChanges(draft, baseline)
  const canSave = baseline.permissions.canEditMetadata && !imageBusy && !reloading
    && hubStoreFieldsValid(draft) && (Object.keys(changes).length > 0 || icon !== undefined)

  async function reload() {
    if (reloading) return
    setReloading(true)
    try {
      const fresh = await skillHubApi.get(session, skill.id)
      setDraft({ displayName: changes.displayName ?? fresh.displayName, displayDescription: changes.displayDescription ?? fresh.displayDescription })
      setBaseline(fresh)
      model.setConflict(false)
      model.setError(fresh.permissions.canEditMetadata ? '' : '当前账号已无法编辑资料。')
    } catch { model.setError('无法读取当前资料，请重试。') }
    finally { setReloading(false) }
  }

  function submit() {
    if (!canSave) return
    void model.submit(async () => {
      const iconUploadId = icon ? (await stage(icon, baseline.team.id, 'icon')).uploadId : icon
      return (requestId) => skillHubApi.update(session, baseline.id, { ...changes, requestId, expectedRevision: baseline.revision, iconUploadId })
    })
  }

  const blocked = model.busy || Boolean(model.pendingId) || reloading
  return <SkillMutationDialog title="编辑资料" onClose={onClose} onSubmit={submit} label="保存" model={model}
    disabled={!canSave} onReload={() => void reload()}>
    <StoreMetadataFields fields={draft} disabled={blocked} onChange={setDraft} />
    <SkillIconInput value={icon} current={Boolean(baseline.iconUrl)} disabled={blocked} onChange={setIcon} onBusyChange={setImageBusy} />
  </SkillMutationDialog>
}
