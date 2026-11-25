import { useState } from 'react'
import { Checkbox, Input, Label, TextField, toast } from '@heroui/react'
import {
  STATE_SYNC_MAX_DOCS_CAP,
  STATE_SYNC_MAX_DOCS_DEFAULT,
  STATE_SYNC_TTL_DEFAULT_SECONDS,
  STATE_SYNC_TTL_MAX_SECONDS,
  STATE_SYNC_TTL_MIN_SECONDS,
} from '@synapse/shared/state-sync-contracts'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { CloudInput, CloudModal } from '@/features/cloud-tables/cloud-table-controls'
import type { StateSyncModel } from './use-state-sync'

export function StateSyncDialogs({ model }: { model: StateSyncModel }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [neverExpire, setNeverExpire] = useState(false)
  const [ttlSecondsText, setTtlSecondsText] = useState(String(STATE_SYNC_TTL_DEFAULT_SECONDS))
  const [maxDocsText, setMaxDocsText] = useState(String(STATE_SYNC_MAX_DOCS_DEFAULT))

  if (model.dialog?.kind === 'createSpace') {
    return (
      <CloudModal
        title='创建同步空间'
        saveLabel='创建'
        pending={model.createSpace.isPending}
        onClose={() => model.setDialog(null)}
        onSave={() => {
          const trimmed = name.trim()
          if (!trimmed) {
            toast.danger('请输入空间名称')
            return
          }
          let defaultDocTtlSeconds: number | null = null
          if (!neverExpire) {
            const parsedTtl = Number(ttlSecondsText.trim())
            if (
              !Number.isInteger(parsedTtl)
              || parsedTtl < STATE_SYNC_TTL_MIN_SECONDS
              || parsedTtl > STATE_SYNC_TTL_MAX_SECONDS
            ) {
              toast.danger(`默认 TTL 须为 ${STATE_SYNC_TTL_MIN_SECONDS} 至 ${STATE_SYNC_TTL_MAX_SECONDS} 秒之间的整数`)
              return
            }
            defaultDocTtlSeconds = parsedTtl
          }
          const parsedMaxDocs = Number(maxDocsText.trim())
          if (!Number.isInteger(parsedMaxDocs) || parsedMaxDocs < 1 || parsedMaxDocs > STATE_SYNC_MAX_DOCS_CAP) {
            toast.danger(`最大房间数须为 1 至 ${STATE_SYNC_MAX_DOCS_CAP} 之间的整数`)
            return
          }
          model.createSpace.mutate({
            name: trimmed,
            description: description.trim(),
            defaultDocTtlSeconds,
            maxDocs: parsedMaxDocs,
          })
        }}
      >
        <CloudInput label='空间名称' value={name} onChange={setName} required />
        <CloudInput label='用途说明（可选）' value={description} onChange={setDescription} multiline />
        <div className='space-y-3'>
          <Checkbox variant='secondary' isSelected={neverExpire} onChange={setNeverExpire}>
            <Checkbox.Content>
              <Checkbox.Control><Checkbox.Indicator /></Checkbox.Control>
              <Label>默认房间永不过期</Label>
            </Checkbox.Content>
          </Checkbox>
          {!neverExpire && (
            <TextField value={ttlSecondsText} onChange={setTtlSecondsText}>
              <Label>默认房间 TTL（秒）</Label>
              <Input variant='secondary' inputMode='numeric' />
            </TextField>
          )}
          <TextField value={maxDocsText} onChange={setMaxDocsText}>
            <Label>最大房间数（1–500）</Label>
            <Input variant='secondary' inputMode='numeric' />
          </TextField>
        </div>
      </CloudModal>
    )
  }

  const deleteTargetId =
    model.dialog?.kind === 'deleteSpaceFromList'
      ? model.dialog.space.id
      : model.dialog?.kind === 'deleteSpace'
        ? model.selectedId
        : null
  const deleteTargetName =
    model.dialog?.kind === 'deleteSpaceFromList'
      ? model.dialog.space.name
      : model.detail.data?.name

  return (
    <ConfirmDialog
      open={Boolean(deleteTargetId)}
      onOpenChange={(open) => !open && model.setDialog(null)}
      title='删除同步空间'
      desc={`删除${deleteTargetName ? `「${deleteTargetName}」` : '该同步空间'}后将立即断开所有房间的在线连接，并永久销毁全部房间数据与空间凭证，无法恢复。`}
      confirmText='删除'
      destructive
      isLoading={model.deleteSpace.isPending}
      handleConfirm={() => {
        if (deleteTargetId) model.deleteSpace.mutate(deleteTargetId)
      }}
    />
  )
}
