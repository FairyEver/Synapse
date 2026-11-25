import { useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { Button, Chip, Modal, toast } from '@heroui/react'
import { Copy, Plus } from 'lucide-react'
import type { StateSyncRole } from '@synapse/shared/state-sync-contracts'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { ServerDataTable } from '@/components/data-table'
import { RelativeTime } from '@/components/relative-time'
import { CloudInput, CloudModal, CloudSelect } from '@/features/cloud-tables/cloud-table-controls'
import type { StateSyncTokenItem } from './state-sync-api'
import type { StateSyncModel } from './use-state-sync'

const noPageChange = () => undefined

const roleOptions = [
  { key: 'read', name: '仅读（观战 / 只读展示）' },
  { key: 'write', name: '读写（加入已有房间并写入）' },
  { key: 'create_write', name: '建房并读写（可创建房间并写入）' },
]

const roleLabels: Record<StateSyncRole, string> = {
  read: '仅读',
  write: '读写',
  create_write: '建房并读写',
}

export function StateSyncTokens({ model, spaceId }: { model: StateSyncModel; spaceId: string }) {
  const [createOpen, setCreateOpen] = useState(false)
  const [tokenName, setTokenName] = useState('')
  const [tokenRole, setTokenRole] = useState<StateSyncRole>('read')
  const [revealed, setRevealed] = useState<{ name: string; role: StateSyncRole; secret: string } | null>(null)
  const [revokeTarget, setRevokeTarget] = useState<StateSyncTokenItem | null>(null)

  function closeCreate() {
    setCreateOpen(false)
    setTokenName('')
    setTokenRole('read')
  }

  async function handleCreate() {
    const trimmed = tokenName.trim()
    if (!trimmed) return
    try {
      const result = await model.createToken.mutateAsync({ id: spaceId, body: { name: trimmed, role: tokenRole } })
      closeCreate()
      setRevealed({ name: result.token.name, role: result.token.role, secret: result.secret })
    } catch {
      // Error toast is already surfaced by useStateSync mutation onError.
    }
  }

  async function handleRevoke() {
    if (!revokeTarget) return
    try {
      await model.revokeToken.mutateAsync({ id: spaceId, tokenId: revokeTarget.id })
      setRevokeTarget(null)
    } catch {
      // Error toast is already surfaced by useStateSync mutation onError.
    }
  }

  async function copySecret() {
    if (!revealed) return
    try {
      await navigator.clipboard.writeText(revealed.secret)
      toast.success('凭证已复制')
    } catch {
      toast.danger('复制失败，请手动复制凭证')
    }
  }

  const columns: ColumnDef<StateSyncTokenItem>[] = [
    { id: 'name', header: '名称', enableSorting: false, cell: ({ row }) => <span className='font-medium'>{row.original.name}</span> },
    { id: 'role', header: '角色', enableSorting: false, cell: ({ row }) => <Chip variant='soft'>{roleLabels[row.original.role]}</Chip> },
    { id: 'prefix', header: '前缀', enableSorting: false, cell: ({ row }) => <span className='font-mono text-sm text-muted'>{row.original.prefix}...</span> },
    {
      id: 'lastUsedAt',
      header: '最近使用',
      enableSorting: false,
      cell: ({ row }) => row.original.lastUsedAt
        ? <RelativeTime value={row.original.lastUsedAt} />
        : <span className='text-muted'>尚未使用</span>,
    },
    { id: 'createdAt', header: '创建时间', enableSorting: false, cell: ({ row }) => <RelativeTime value={row.original.createdAt} /> },
    {
      id: 'actions',
      header: '操作',
      enableSorting: false,
      enableHiding: false,
      cell: ({ row }) => (
        <Button size='sm' variant='danger-soft' onPress={() => setRevokeTarget(row.original)}>撤销</Button>
      ),
    },
  ]

  return (
    <div className='space-y-4'>
      <ServerDataTable
        columns={columns}
        data={model.tokens.data?.data ?? []}
        isLoading={model.tokens.isLoading}
        error={model.tokens.error}
        onRetry={() => void model.tokens.refetch()}
        emptyMessage='暂无空间凭证'
        page={1}
        pageSize={50}
        total={model.tokens.data?.data.length ?? 0}
        onPageChange={noPageChange}
        onPageSizeChange={noPageChange}
        showPagination={false}
        clampPage={false}
        toolbar={
          <div className='flex justify-end'>
            <Button onPress={() => setCreateOpen(true)}><Plus />签发凭证</Button>
          </div>
        }
      />

      {createOpen && (
        <CloudModal
          title='签发空间凭证'
          saveLabel='签发'
          pending={model.createToken.isPending}
          onClose={closeCreate}
          onSave={() => void handleCreate()}
        >
          <CloudInput label='凭证名称' value={tokenName} onChange={setTokenName} required />
          <CloudSelect label='角色权限' value={tokenRole} items={roleOptions} onChange={(v) => setTokenRole(v as StateSyncRole)} />
        </CloudModal>
      )}

      {revealed && (
        <Modal.Backdrop isOpen onOpenChange={(open) => !open && setRevealed(null)}>
          <Modal.Container size='lg'>
            <Modal.Dialog>
              <Modal.CloseTrigger />
              <Modal.Header className='pe-8'>
                <Modal.Heading className='break-words'>保存空间凭证</Modal.Heading>
              </Modal.Header>
              <Modal.Body className='space-y-3'>
                <p className='text-sm text-muted'>
                  完整凭证仅展示这一次。请复制并保存「{revealed.name}」（{roleLabels[revealed.role]}）。
                </p>
                <div className='rounded-lg border border-border bg-surface-secondary p-3 font-mono text-sm break-all'>
                  {revealed.secret}
                </div>
              </Modal.Body>
              <Modal.Footer className='flex-wrap'>
                <Button variant='secondary' onPress={() => void copySecret()}><Copy />复制凭证</Button>
                <Button onPress={() => setRevealed(null)}>我已保存</Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      )}

      <ConfirmDialog
        open={Boolean(revokeTarget)}
        onOpenChange={(open) => !open && setRevokeTarget(null)}
        title='撤销空间凭证'
        desc='撤销后将立即断开所有正在使用该凭证的在线连接，且无法恢复。'
        confirmText='撤销'
        destructive
        isLoading={model.revokeToken.isPending}
        handleConfirm={() => void handleRevoke()}
      />
    </div>
  )
}
