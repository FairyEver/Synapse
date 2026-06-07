import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type { DashboardWebhookDto } from '@synapse/shared'
import { type ColumnDef, type SortingState } from '@tanstack/react-table'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, MoreHorizontal, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { dashboardApi } from '@/lib/api'
import {
  DataTableColumnHeader,
  ServerDataTable,
} from '@/components/data-table'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { WebhookDeliveriesSheet } from './webhook-deliveries-sheet'
import { getWebhookUrlDisplayState } from './webhook-display'
import { getWebhookErrorMessage } from './webhook-error'
import { WebhookUrlDialog } from './webhook-url-dialog'

const initialPageSize = 20

type WebhookFormState = {
  mode: 'create' | 'edit'
  webhook: DashboardWebhookDto | null
  name: string
}

type OneTimeUrlState = {
  title: string
  url: string
}

export default function WebhooksPage() {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(initialPageSize)
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'createdAt', desc: true },
  ])
  const [form, setForm] = useState<WebhookFormState | null>(null)
  const [oneTimeUrl, setOneTimeUrl] = useState<OneTimeUrlState | null>(null)
  const [deliveriesWebhook, setDeliveriesWebhook] =
    useState<DashboardWebhookDto | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<DashboardWebhookDto | null>(
    null
  )
  const queryClient = useQueryClient()

  const webhooksQuery = useQuery({
    queryKey: ['dashboard-webhooks'],
    queryFn: () => dashboardApi.listWebhooks(),
  })

  const sortedWebhooks = useMemo(
    () => sortWebhooks(webhooksQuery.data ?? [], sorting),
    [webhooksQuery.data, sorting]
  )
  const pageCount = Math.max(1, Math.ceil(sortedWebhooks.length / pageSize))
  const pageData = sortedWebhooks.slice((page - 1) * pageSize, page * pageSize)

  useEffect(() => {
    if (page > pageCount) {
      setPage(pageCount)
    }
  }, [page, pageCount])

  const createMutation = useMutation({
    mutationFn: (input: { name: string }) => dashboardApi.createWebhook(input),
    onSuccess: (result) => {
      setForm(null)
      setOneTimeUrl({ title: 'Webhook URL', url: result.url })
      queryClient.setQueryData<DashboardWebhookDto[]>(
        ['dashboard-webhooks'],
        (current) => [result.webhook, ...(current ?? [])]
      )
      toast.success('已创建')
    },
    onError: (error) => toast.error(getWebhookErrorMessage(error, '创建失败')),
  })

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string
      input: { name?: string; enabled?: boolean }
    }) => dashboardApi.updateWebhook(id, input),
    onSuccess: (webhook) => {
      setForm(null)
      queryClient.setQueryData<DashboardWebhookDto[]>(
        ['dashboard-webhooks'],
        (current) =>
          (current ?? []).map((item) =>
            item.id === webhook.id ? webhook : item
          )
      )
      toast.success('已保存')
    },
    onError: (error) => toast.error(getWebhookErrorMessage(error, '保存失败')),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => dashboardApi.deleteWebhook(id),
    onSuccess: () => {
      const id = deleteTarget?.id
      setDeleteTarget(null)
      queryClient.setQueryData<DashboardWebhookDto[]>(
        ['dashboard-webhooks'],
        (current) => (current ?? []).filter((item) => item.id !== id)
      )
      toast.success('已删除')
    },
    onError: (error) => toast.error(getWebhookErrorMessage(error, '删除失败')),
  })

  const resetSecretMutation = useMutation({
    mutationFn: (id: string) => dashboardApi.resetWebhookSecret(id),
    onSuccess: (result) => {
      setOneTimeUrl({ title: '新的 Webhook URL', url: result.url })
      queryClient.setQueryData<DashboardWebhookDto[]>(
        ['dashboard-webhooks'],
        (current) =>
          (current ?? []).map((item) =>
            item.id === result.webhook.id ? result.webhook : item
          )
      )
      toast.success('已重置')
    },
    onError: (error) => toast.error(getWebhookErrorMessage(error, '重置失败')),
  })

  async function copyWebhookUrl(url: string) {
    try {
      await navigator.clipboard.writeText(url)
      toast.success('已复制')
    } catch {
      toast.error('复制失败')
    }
  }

  const columns: ColumnDef<DashboardWebhookDto>[] = [
    {
      accessorKey: 'name',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='名称' />
      ),
      cell: ({ row }) => (
        <span className='font-medium'>{row.original.name}</span>
      ),
    },
    {
      accessorKey: 'enabled',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='状态' />
      ),
      cell: ({ row }) => (
        <Badge variant={row.original.enabled ? 'default' : 'secondary'}>
          {row.original.enabled ? '启用' : '停用'}
        </Badge>
      ),
    },
    {
      accessorKey: 'publicId',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='Public ID' />
      ),
      cell: ({ row }) => (
        <span className='font-mono text-sm'>{row.original.publicId}</span>
      ),
    },
    {
      accessorKey: 'maskedUrl',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='URL' />
      ),
      cell: ({ row }) => {
        const urlState = getWebhookUrlDisplayState(row.original)
        return (
          <div className='flex items-center gap-2'>
            <span className='font-mono text-sm break-all text-muted-foreground'>
              {urlState.label}
            </span>
            {urlState.copyValue ? (
              <Button
                variant='ghost'
                size='icon'
                aria-label='复制 Webhook URL'
                onClick={() => void copyWebhookUrl(urlState.copyValue)}
              >
                <Copy />
              </Button>
            ) : (
              <Button
                variant='outline'
                size='sm'
                onClick={() => resetSecretMutation.mutate(row.original.id)}
              >
                重置 secret
              </Button>
            )}
          </div>
        )
      },
      enableSorting: false,
    },
    {
      accessorKey: 'lastDeliveryAt',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='最近触发' />
      ),
      cell: ({ row }) => formatOptionalDateTime(row.original.lastDeliveryAt),
    },
    {
      accessorKey: 'createdAt',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='创建时间' />
      ),
      cell: ({ row }) => formatOptionalDateTime(row.original.createdAt),
    },
    {
      id: 'actions',
      cell: ({ row }) => (
        <div className='flex justify-end'>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant='ghost' size='icon' aria-label='Webhook 操作'>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end'>
              <DropdownMenuItem
                onClick={() => {
                  setForm({
                    mode: 'edit',
                    webhook: row.original,
                    name: row.original.name,
                  })
                }}
              >
                重命名
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  updateMutation.mutate({
                    id: row.original.id,
                    input: { enabled: !row.original.enabled },
                  })
                }
              >
                {row.original.enabled ? '停用' : '启用'}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => resetSecretMutation.mutate(row.original.id)}
              >
                重置 secret
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setDeliveriesWebhook(row.original)}
              >
                记录
              </DropdownMenuItem>
              <DropdownMenuItem
                variant='destructive'
                onClick={() => setDeleteTarget(row.original)}
              >
                删除
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
      meta: {
        thClassName: 'text-right',
        tdClassName: 'text-right',
      },
      enableSorting: false,
      enableHiding: false,
    },
  ]

  function submitForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!form) return
    const name = form.name.trim()
    if (!name) {
      toast.error('名称不能为空')
      return
    }
    if (form.mode === 'create') {
      createMutation.mutate({ name })
      return
    }
    if (form.webhook) {
      updateMutation.mutate({ id: form.webhook.id, input: { name } })
    }
  }

  const isSaving = createMutation.isPending || updateMutation.isPending

  return (
    <>
      <Header>
        <h1 className='text-lg font-semibold'>Webhooks</h1>
      </Header>
      <Main>
        {webhooksQuery.isLoading ? (
          <div className='text-muted-foreground'>加载中...</div>
        ) : (
          <ServerDataTable
            columns={columns}
            data={pageData}
            page={page}
            pageSize={pageSize}
            total={sortedWebhooks.length}
            error={webhooksQuery.isError ? webhooksQuery.error : null}
            onRetry={() => void webhooksQuery.refetch()}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            sorting={sorting}
            onSortingChange={setSorting}
            toolbar={
              <div className='flex justify-end'>
                <Button
                  onClick={() =>
                    setForm({ mode: 'create', webhook: null, name: '' })
                  }
                >
                  <Plus />
                  新建
                </Button>
              </div>
            }
          />
        )}

        <WebhookFormDialog
          form={form}
          isSaving={isSaving}
          onFormChange={setForm}
          onSubmit={submitForm}
        />
        <WebhookUrlDialog
          open={Boolean(oneTimeUrl)}
          title={oneTimeUrl?.title ?? 'Webhook URL'}
          url={oneTimeUrl?.url ?? ''}
          onOpenChange={(open) => {
            if (!open) setOneTimeUrl(null)
          }}
        />
        <WebhookDeliveriesSheet
          open={Boolean(deliveriesWebhook)}
          webhook={deliveriesWebhook}
          onOpenChange={(open) => {
            if (!open) setDeliveriesWebhook(null)
          }}
        />
        <ConfirmDialog
          open={Boolean(deleteTarget)}
          onOpenChange={(open) => {
            if (!open) setDeleteTarget(null)
          }}
          title='删除 Webhook'
          desc={deleteTarget?.name ?? ''}
          cancelBtnText='取消'
          confirmText='删除'
          destructive
          isLoading={deleteMutation.isPending}
          handleConfirm={() => {
            if (deleteTarget) deleteMutation.mutate(deleteTarget.id)
          }}
        />
      </Main>
    </>
  )
}

function WebhookFormDialog({
  form,
  isSaving,
  onFormChange,
  onSubmit,
}: {
  form: WebhookFormState | null
  isSaving: boolean
  onFormChange: (form: WebhookFormState | null) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  return (
    <Dialog
      open={Boolean(form)}
      onOpenChange={(open) => {
        if (!open) onFormChange(null)
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {form?.mode === 'edit' ? '重命名 Webhook' : '新建 Webhook'}
          </DialogTitle>
        </DialogHeader>
        <form id='webhook-form' className='grid gap-4' onSubmit={onSubmit}>
          <div className='grid gap-2'>
            <Label htmlFor='webhook-name'>名称</Label>
            <Input
              id='webhook-name'
              value={form?.name ?? ''}
              maxLength={80}
              autoFocus
              disabled={isSaving}
              onChange={(event) => {
                if (!form) return
                onFormChange({ ...form, name: event.target.value })
              }}
            />
          </div>
        </form>
        <DialogFooter>
          <Button
            variant='outline'
            disabled={isSaving}
            onClick={() => onFormChange(null)}
          >
            取消
          </Button>
          <Button type='submit' form='webhook-form' disabled={isSaving}>
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function sortWebhooks(
  webhooks: DashboardWebhookDto[],
  sorting: SortingState
) {
  const sort = sorting[0]
  if (!sort) return webhooks
  return [...webhooks].sort((left, right) => {
    const result = compareWebhookValue(left, right, sort.id)
    return sort.desc ? -result : result
  })
}

function compareWebhookValue(
  left: DashboardWebhookDto,
  right: DashboardWebhookDto,
  key: string
) {
  switch (key) {
    case 'name':
      return left.name.localeCompare(right.name, 'zh-CN')
    case 'enabled':
      return Number(left.enabled) - Number(right.enabled)
    case 'publicId':
      return left.publicId.localeCompare(right.publicId)
    case 'lastDeliveryAt':
      return dateValue(left.lastDeliveryAt) - dateValue(right.lastDeliveryAt)
    case 'createdAt':
      return dateValue(left.createdAt) - dateValue(right.createdAt)
    default:
      return 0
  }
}

function dateValue(value: string | undefined) {
  return value ? new Date(value).getTime() : 0
}

function formatOptionalDateTime(value: string | undefined) {
  return value ? new Date(value).toLocaleString('zh-CN') : '-'
}
