import { Button, Input, Label, TextArea, TextField, toast } from '@heroui/react'
import { useId, useRef, useState } from 'react'
import { SKILL_HUB_LIMITS as limits, type SkillHubDetail } from '@synapse/shared/skill-hub-contracts'
import { HubTeamSelect } from './hub-team-select'
import { skillHubApi, type HubTeams } from './skill-hub-api'
import { SkillIconInput } from './skill-icon-input'
import { SkillMutationDialog } from './skill-mutation-dialog'
import { resolveHubUploadTeam, useHubUploadStage, useSkillPublish } from './use-skill-publish'

type StoreFields = { displayName: string; displayDescription: string }
export const hubStoreFieldsValid = (fields: StoreFields) =>
  Boolean(fields.displayName.trim() && fields.displayDescription.trim()
    && [...fields.displayName.trim()].length <= 100 && [...fields.displayDescription.trim()].length <= 2000)

export function StoreMetadataFields({ fields, disabled, onChange }: { fields: StoreFields; disabled: boolean; onChange: (fields: StoreFields) => void }) {
  return <>
    <TextField isDisabled={disabled} isRequired value={fields.displayName} onChange={(displayName) => onChange({ ...fields, displayName })}>
      <Label>商店名称</Label><Input variant="secondary" maxLength={200} />
    </TextField>
    <TextField isDisabled={disabled} isRequired value={fields.displayDescription} onChange={(displayDescription) => onChange({ ...fields, displayDescription })}>
      <Label>商店介绍</Label><TextArea variant="secondary" rows={4} maxLength={4000} />
    </TextField>
  </>
}

function fileFormat(file: File) {
  if (/\.zip$/iu.test(file.name)) return 'zip'
  if (/\.(?:md|markdown)$/iu.test(file.name)) return 'markdown'
  return null
}

export function SkillUploadDialog({ session, teams, skill, onClose }: {
  session: string; teams?: HubTeams; skill?: SkillHubDetail; onClose: () => void
}) {
  const [baseline, setBaseline] = useState(skill)
  const [selected, setSelected] = useState<string>()
  const [packageFile, setPackageFile] = useState<File>()
  const [store, setStore] = useState({ displayName: '', displayDescription: '' })
  const [icon, setIcon] = useState<Blob | null>()
  const [imageBusy, setImageBusy] = useState(false)
  const [reloading, setReloading] = useState(false)
  const [fileError, setFileError] = useState('')
  const picker = useRef<HTMLInputElement>(null)
  const fileLabel = useId()
  const teamId = baseline?.team.id ?? resolveHubUploadTeam(teams, selected)
  const stage = useHubUploadStage(session)
  const model = useSkillPublish({
    session, action: skill ? 'app.skill_hub.version.create' : 'app.skill_hub.skill.create', target: skill?.id ?? 'new',
    onCommitted: (outcome) => {
      toast.success(outcome === 'unchanged' ? '包内容一致，仍为当前版本。' : outcome ? '已发布 Skill' : '操作已提交')
      onClose()
    },
  })
  const blocked = model.busy || Boolean(model.pendingId) || reloading
  const format = packageFile && fileFormat(packageFile)
  const canPublish = Boolean(teamId && packageFile && format && !fileError && !imageBusy
    && (baseline ? baseline.permissions.canPublishVersion : hubStoreFieldsValid(store)))
  const fixedTeam = baseline?.team ?? (teams?.selectionState === 'single' ? teams.items.find((team) => team.id === teamId) : undefined)

  function selectFile(file: File) {
    if (!fileFormat(file)) { setFileError('请选择 Markdown 或 ZIP 文件。'); return }
    if (!file.size || file.size > limits.uploadBytes) { setFileError('请选择不超过 50 MiB 的非空文件。'); return }
    setFileError('')
    setPackageFile(file)
  }

  function submit() {
    if (!canPublish || !teamId || !packageFile || !format) return
    void model.submit(async () => {
      const pkg = await stage(packageFile, teamId, 'package', format)
      if (baseline) return (requestId) => skillHubApi.publish(session, baseline.id, {
        packageUploadId: pkg.uploadId, expectedVersionId: baseline.currentVersion.id, requestId,
      })
      const iconUploadId = icon ? (await stage(icon, teamId, 'icon')).uploadId : undefined
      return (requestId) => skillHubApi.create(session, {
        teamId, requestId, packageUploadId: pkg.uploadId, iconUploadId,
        displayName: store.displayName.trim(), displayDescription: store.displayDescription.trim(),
      })
    })
  }

  async function reload() {
    if (!baseline || reloading) return
    setReloading(true)
    try {
      const fresh = await skillHubApi.get(session, baseline.id)
      setBaseline(fresh)
      model.setConflict(false)
      model.setError(fresh.permissions.canPublishVersion ? '' : '当前账号已无法发布新版。')
    } catch { model.setError('无法读取当前版本，请重试。') }
    finally { setReloading(false) }
  }

  return <SkillMutationDialog title={baseline ? '上传新版本' : '上传 Skill'} onClose={onClose} onSubmit={submit}
    label="发布" model={model} disabled={!canPublish || reloading} onReload={baseline ? () => void reload() : undefined}>
    {fixedTeam ? <div><p className="text-sm font-medium">团队</p><p className="wrap-anywhere">{fixedTeam.name}</p></div>
      : teams?.selectionState === 'none' ? <p>加入团队后才能上传 Skill。</p>
        : <HubTeamSelect variant="secondary" teams={teams?.items ?? []} value={selected} onChange={setSelected}
          disabled={blocked || !teams} />}
    {baseline ? <p className="text-sm text-muted">当前版本 v{baseline.currentVersion.number}</p> : null}
    <div className="grid gap-2">
      <Label id={fileLabel}>Skill 文件</Label>
      <input ref={picker} type="file" hidden accept=".md,.markdown,.zip"
        onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) selectFile(file) }} />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" aria-describedby={fileLabel} isDisabled={!teamId || blocked}
          onPress={() => picker.current?.click()}>选择 Markdown 或 ZIP</Button>
        {packageFile ? <p className="min-w-0 wrap-anywhere text-sm">{packageFile.name}</p> : null}
      </div>
      {fileError ? <p role="alert" className="text-sm text-danger">{fileError}</p> : null}
    </div>
    {!baseline ? <>
      <StoreMetadataFields fields={store} disabled={blocked || !teamId} onChange={setStore} />
      <SkillIconInput value={icon} onChange={setIcon} onBusyChange={setImageBusy} disabled={blocked || !teamId} />
    </> : null}
  </SkillMutationDialog>
}
