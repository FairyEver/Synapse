import { useState, type ReactNode } from 'react'
import type { DashboardWebhookDto } from '@synapse/shared'
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { toast } from 'sonner'
import { dashboardApi } from '@/lib/api'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { RelativeTime } from '@/components/relative-time'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  getWebhookDeliveryStatusLabel,
  getWebhookUrlDisplayState,
} from './webhook-display'
import { getWebhookErrorMessage } from './webhook-error'
import {
  WebhookFormDialog,
  type WebhookFormState,
} from './index'
import { WebhookUrlDialog } from './webhook-url-dialog'
import {
  getWebhookResetSecretDialogDescription,
  webhookResetSecretDialogTitle,
} from './webhook-reset-secret'

type OneTimeUrlState = {
  title: string
  url: string
}

export default function WebhookDetailPage() {
  const { webhookId } = useParams({
    from: '/_authenticated/webhooks/$webhookId',
  })
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
    queryKey: ['dashboard-webhook', webhookId],
    queryFn: () => dashboardApi.getWebhook(webhookId),
  })

  const webhook = webhooksQuery.data ?? null

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string
      input: { name?: string; enabled?: boolean }
    }) => dashboardApi.updateWebhook(id, input),
    onSuccess: (updatedWebhook) => {
      setForm(null)
      replaceWebhookInCache(queryClient, updatedWebhook)
      toast.success('已保存')
    },
    onError: (error) => toast.error(getWebhookErrorMessage(error, '保存失败')),
  })

  const resetSecretMutation = useMutation({
    mutationFn: (id: string) => dashboardApi.resetWebhookSecret(id),
    onSuccess: (result) => {
      setResetSecretTarget(null)
      setOneTimeUrl({ title: '新的 Webhook URL', url: result.url })
      replaceWebhookInCache(queryClient, result.webhook)
      toast.success('已重置')
    },
    onError: (error) => toast.error(getWebhookErrorMessage(error, '重置失败')),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => dashboardApi.deleteWebhook(id),
    onSuccess: (_result, deletedId) => {
      setDeleteTarget(null)
      queryClient.removeQueries({ queryKey: ['dashboard-webhook', deletedId] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard-webhooks'] })
      toast.success('已删除')
      void navigate({ to: '/webhooks/' })
    },
    onError: (error) => toast.error(getWebhookErrorMessage(error, '删除失败')),
  })

  return (
    <>
      <Header fixed>
        <h1 className='text-lg font-semibold'>Webhook 详情</h1>
      </Header>
      <Main className='flex max-w-4xl flex-col gap-4'>
        <div>
          <Button asChild variant='outline' size='sm'>
            <Link to='/webhooks/'>返回</Link>
          </Button>
        </div>

        {webhooksQuery.isLoading ? (
          <WebhookDetailSkeleton />
        ) : webhooksQuery.isError ? (
          <Card>
            <CardContent className='flex flex-col items-start gap-3'>
              <div className='font-medium'>加载失败</div>
              <div className='text-sm text-muted-foreground'>
                {getWebhookErrorMessage(webhooksQuery.error, '详情加载失败')}
              </div>
              <Button
                variant='outline'
                size='sm'
                onClick={() => void webhooksQuery.refetch()}
              >
                重试
              </Button>
            </CardContent>
          </Card>
        ) : webhook ? (
          <WebhookDetailCard
            webhook={webhook}
            isUpdating={updateMutation.isPending}
            isResetting={resetSecretMutation.isPending}
            onEdit={(target) =>
              setForm({
                mode: 'edit',
                webhook: target,
                name: target.name,
              })
            }
            onToggle={(target) =>
              updateMutation.mutate({
                id: target.id,
                input: { enabled: !target.enabled },
              })
            }
            onResetSecret={setResetSecretTarget}
            onDelete={setDeleteTarget}
          />
        ) : (
          <Card>
            <CardContent className='flex flex-col items-start gap-3'>
              <div className='font-medium'>未找到 Webhook</div>
              <Button asChild variant='outline' size='sm'>
                <Link to='/webhooks/'>返回列表</Link>
              </Button>
            </CardContent>
          </Card>
        )}

        <WebhookFormDialog
          form={form}
          isSaving={updateMutation.isPending}
          onFormChange={setForm}
          onSubmit={(event) => {
            event.preventDefault()
            if (!form?.webhook) return
            const name = form.name.trim()
            if (!name) {
              toast.error('名称不能为空')
              return
            }
            updateMutation.mutate({
              id: form.webhook.id,
              input: { name },
            })
          }}
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
            if (resetSecretTarget) resetSecretMutation.mutate(resetSecretTarget.id)
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

function WebhookDetailCard({
  webhook,
  isUpdating,
  isResetting,
  onEdit,
  onToggle,
  onResetSecret,
  onDelete,
}: {
  webhook: DashboardWebhookDto
  isUpdating: boolean
  isResetting: boolean
  onEdit: (webhook: DashboardWebhookDto) => void
  onToggle: (webhook: DashboardWebhookDto) => void
  onResetSecret: (webhook: DashboardWebhookDto) => void
  onDelete: (webhook: DashboardWebhookDto) => void
}) {
  const urlState = getWebhookUrlDisplayState(webhook)

  return (
    <Card>
      <CardHeader>
        <CardTitle className='flex min-w-0 items-center gap-2 text-base'>
          <span className='truncate'>{webhook.name}</span>
          <Badge variant={webhook.enabled ? 'default' : 'secondary'}>
            {webhook.enabled ? '启用' : '停用'}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className='grid gap-4 md:grid-cols-2'>
        <WebhookDetailField label='Public ID'>
          <span className='break-all font-mono'>{webhook.publicId}</span>
        </WebhookDetailField>
        <WebhookDetailField label='URL'>
          <span className='break-all font-mono text-muted-foreground'>
            {urlState.label}
          </span>
        </WebhookDetailField>
        <WebhookDetailField label='创建时间'>
          <RelativeTime value={webhook.createdAt} />
        </WebhookDetailField>
        <WebhookDetailField label='更新时间'>
          <RelativeTime value={webhook.updatedAt} />
        </WebhookDetailField>
        <WebhookDetailField label='最近触发'>
          <RelativeTime value={webhook.lastDeliveryAt} />
        </WebhookDetailField>
        <WebhookDetailField label='触发状态'>
          {webhook.lastDeliveryStatus ? (
            <Badge variant='outline'>
              {getWebhookDeliveryStatusLabel(webhook.lastDeliveryStatus)}
            </Badge>
          ) : (
            '-'
          )}
        </WebhookDetailField>
      </CardContent>
      <CardFooter className='flex-wrap justify-end gap-2'>
        <Button
          variant={webhook.enabled ? 'outline' : 'default'}
          size='sm'
          disabled={isUpdating}
          onClick={() => onToggle(webhook)}
        >
          {webhook.enabled ? '停用' : '启用'}
        </Button>
        <Button asChild variant='outline' size='sm'>
          <Link
            to='/webhook-deliveries'
            search={{ webhookId: webhook.id }}
          >
            查看记录
          </Link>
        </Button>
        <Button variant='outline' size='sm' onClick={() => onEdit(webhook)}>
          重命名
        </Button>
        <Button
          variant='outline'
          size='sm'
          disabled={isResetting}
          onClick={() => onResetSecret(webhook)}
        >
          重置 secret
        </Button>
        <Button
          variant='destructive'
          size='sm'
          onClick={() => onDelete(webhook)}
        >
          删除
        </Button>
      </CardFooter>
    </Card>
  )
}

function WebhookDetailField({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div className='flex min-w-0 flex-col gap-1 text-sm'>
      <span className='text-xs font-medium text-muted-foreground'>
        {label}
      </span>
      <div className='min-w-0'>{children}</div>
    </div>
  )
}

function WebhookDetailSkeleton() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className='flex items-center gap-2'>
          <Skeleton className='h-5 w-40' />
          <Skeleton className='h-5 w-12' />
        </CardTitle>
      </CardHeader>
      <CardContent className='grid gap-4 md:grid-cols-2'>
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className='h-9 w-full' />
        ))}
      </CardContent>
      <CardFooter className='flex-wrap justify-end gap-2'>
        <Skeleton className='h-8 w-16' />
        <Skeleton className='h-8 w-20' />
        <Skeleton className='h-8 w-16' />
      </CardFooter>
    </Card>
  )
}

function replaceWebhookInCache(
  queryClient: QueryClient,
  webhook: DashboardWebhookDto
) {
  queryClient.setQueryData(['dashboard-webhook', webhook.id], webhook)
  void queryClient.invalidateQueries({ queryKey: ['dashboard-webhooks'] })
}
