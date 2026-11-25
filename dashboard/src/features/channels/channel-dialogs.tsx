import { useState } from 'react'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { CloudInput, CloudModal } from '@/features/cloud-tables/cloud-table-controls'
import type { ChannelsModel } from './use-channels'

export function ChannelDialogs({ model }: { model: ChannelsModel }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  if (model.dialog?.kind === 'create') {
    return (
      <CloudModal
        title='创建频道'
        saveLabel='创建'
        pending={model.createChannel.isPending}
        onClose={() => model.setDialog(null)}
        onSave={() => {
          const trimmed = name.trim()
          if (!trimmed) return
          model.createChannel.mutate({ name: trimmed, description: description.trim() })
        }}
      >
        <CloudInput label='频道名称' value={name} onChange={setName} required />
        <CloudInput label='用途说明（可选）' value={description} onChange={setDescription} multiline />
      </CloudModal>
    )
  }

  return (
    <ConfirmDialog
      open={model.dialog?.kind === 'deleteChannel'}
      onOpenChange={(open) => !open && model.setDialog(null)}
      title='删除频道'
      desc='删除后将立即断开该频道的全部在线连接，并永久作废其凭证与 Retain 状态快照，无法恢复。'
      confirmText='删除'
      destructive
      isLoading={model.deleteChannel.isPending}
      handleConfirm={() => {
        if (model.selectedId) model.deleteChannel.mutate(model.selectedId)
      }}
    />
  )
}
