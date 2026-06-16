import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from 'react'
import type { DashboardWebhookDto } from '@synapse/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { dashboardApi } from '@/lib/api'
import { ConfirmDialog } from '@/components/confirm-dialog'
import {
  DEFAULT_DASHBOARD_PAGE_SIZE,
  ServerDataTable,
} from '@/components/data-table'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getWebhookErrorMessage } from './webhook-error'
import { WebhookUrlDialog } from './webhook-url-dialog'
import {
  getWebhookResetSecretDialogDescription,
  webhookResetSecretDialogTitle,
} from './webhook-reset-secret'
import { buildWebhookColumns } from './webhook-columns'

export type WebhookFormState = {
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
  const [pageSize, setPageSize] = useState(DEFAULT_DASHBOARD_PAGE_SIZE)
  const [form, setForm] = useState<WebhookFormState | null>(null)
  const [oneTimeUrl, setOneTimeUrl] = useState<OneTimeUrlState | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<DashboardWebhookDto | null>(
    null
  )
  const [resetSecretTarget, setResetSecretTarget] =
    useState<DashboardWebhookDto | null>(null)
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const webhooksQuery = useQuery({
    queryKey: ['dashboard-webhooks', page, pageSize],
    queryFn: () => dashboardApi.listWebhooks({ page, pageSize }),
  })

  const webhooksPage = webhooksQuery.data
  const total = webhooksPage?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / Math.max(1, pageSize)))

  useEffect(() => {
    if (page > pageCount) {
      setPage(pageCount)
    }
  }, [page, pageCount])

  const createMutation = useMutation({
    mutationFn: (input: { name: string }) => dashboardApi.createWebhook(input),
    onSuccess: (result) => {
      setForm(null)
      setPage(1)
      setOneTimeUrl({ title: 'Webhook URL', url: result.url })
      void queryClient.invalidateQueries({ queryKey: ['dashboard-webhooks'] })
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
      void queryClient.invalidateQueries({ queryKey: ['dashboard-webhooks'] })
      queryClient.setQueryData(['dashboard-webhook', webhook.id], webhook)
      toast.success('已保存')
    },
    onError: (error) => toast.error(getWebhookErrorMessage(error, '保存失败')),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => dashboardApi.deleteWebhook(id),
    onSuccess: (_result, deletedId) => {
      setDeleteTarget(null)
      queryClient.removeQueries({ queryKey: ['dashboard-webhook', deletedId] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard-webhooks'] })
      toast.success('已删除')
    },
    onError: (error) => toast.error(getWebhookErrorMessage(error, '删除失败')),
  })

  const resetSecretMutation = useMutation({
    mutationFn: (id: string) => dashboardApi.resetWebhookSecret(id),
    onSuccess: (result) => {
      setResetSecretTarget(null)
      setOneTimeUrl({ title: '新的 Webhook URL', url: result.url })
      void queryClient.invalidateQueries({ queryKey: ['dashboard-webhooks'] })
      queryClient.setQueryData(
        ['dashboard-webhook', result.webhook.id],
        result.webhook
      )
      toast.success('已重置')
    },
    onError: (error) => toast.error(getWebhookErrorMessage(error, '重置失败')),
  })

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
  const columns = useMemo(
    () =>
      buildWebhookColumns({
        onEdit: (webhook) =>
          setForm({
            mode: 'edit',
            webhook,
            name: webhook.name,
          }),
        onToggle: (webhook) =>
          updateMutation.mutate({
            id: webhook.id,
            input: { enabled: !webhook.enabled },
          }),
        onResetSecret: setResetSecretTarget,
        onOpenDeliveries: (webhook) => {
          void navigate({
            to: '/webhook-deliveries',
            search: { webhookId: webhook.id },
          })
        },
        onDelete: setDeleteTarget,
      }),
    [navigate, updateMutation]
  )

  return (
    <>
      <Header fixed>
        <h1 className='text-lg font-semibold'>Webhooks</h1>
      </Header>
      <Main className='flex flex-1 flex-col gap-4'>
        <ServerDataTable
          columns={columns}
          data={[...(webhooksPage?.data ?? [])]}
          page={page}
          pageSize={pageSize}
          total={total}
          error={webhooksQuery.isError ? webhooksQuery.error : null}
          onRetry={() => void webhooksQuery.refetch()}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          isLoading={webhooksQuery.isLoading}
          loadingRowCount={Math.min(pageSize, DEFAULT_DASHBOARD_PAGE_SIZE)}
          emptyMessage='暂无 Webhook'
          toolbar={
            <div className='flex items-center justify-end'>
              <Button
                onClick={() =>
                  setForm({ mode: 'create', webhook: null, name: '' })
                }
              >
                <Plus data-icon='inline-start' />
                新建
              </Button>
            </div>
          }
        />

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
        <ConfirmDialog
          open={Boolean(resetSecretTarget)}
          onOpenChange={(open) => {
            if (!open) setResetSecretTarget(null)
          }}
          title={webhookResetSecretDialogTitle}
          desc={getWebhookResetSecretDialogDescription(resetSecretTarget)}
          cancelBtnText='取消'
          confirmText='重置'
          destructive
          isLoading={resetSecretMutation.isPending}
          handleConfirm={() => {
            if (resetSecretTarget) {
              resetSecretMutation.mutate(resetSecretTarget.id)
            }
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

export function WebhookFormDialog({
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

export function removeDeletedWebhookFromCache(
  current: DashboardWebhookDto[] | undefined,
  deletedId: string
): DashboardWebhookDto[] {
  return (current ?? []).filter((item) => item.id !== deletedId)
}

export function getWebhookDeliveriesHref(webhookId: string) {
  const query = new URLSearchParams({ webhookId })
  return `/webhook-deliveries?${query.toString()}`
}

export function getWebhookDetailHref(webhookId: string) {
  return `/webhooks/${encodeURIComponent(webhookId)}`
}
