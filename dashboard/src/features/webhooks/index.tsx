import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'
import type { DashboardWebhookDto } from '@synapse/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { ChevronLeft, ChevronRight, MoreHorizontal, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { getPageNumbers } from '@/lib/utils'
import { dashboardApi } from '@/lib/api'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { DEFAULT_DASHBOARD_PAGE_SIZE } from '@/components/data-table'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
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
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  formatOptionalWebhookDateTime,
  getCompactWebhookCardFieldLabels,
  getWebhookCardPageState,
  getWebhookDeliveryStatusLabel,
} from './webhook-display'
import { getWebhookErrorMessage } from './webhook-error'
import { WebhookUrlDialog } from './webhook-url-dialog'

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
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const webhooksQuery = useQuery({
    queryKey: ['dashboard-webhooks'],
    queryFn: () => dashboardApi.listWebhooks(),
  })

  const webhooks = webhooksQuery.data ?? []
  const { pageCount, pageData } = useMemo(
    () => getWebhookCardPageState(webhooks, page, pageSize),
    [webhooks, page, pageSize]
  )

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
    onSuccess: (_result, deletedId) => {
      setDeleteTarget(null)
      queryClient.setQueryData<DashboardWebhookDto[]>(
        ['dashboard-webhooks'],
        (current) => removeDeletedWebhookFromCache(current, deletedId)
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
      <Header fixed>
        <h1 className='text-lg font-semibold'>Webhooks</h1>
      </Header>
      <Main className='flex flex-col gap-4'>
        <div className='flex justify-end'>
          <Button
            onClick={() =>
              setForm({ mode: 'create', webhook: null, name: '' })
            }
          >
            <Plus data-icon='inline-start' />
            新建
          </Button>
        </div>

        {webhooksQuery.isLoading ? (
          <WebhookCardListSkeleton />
        ) : (
          <WebhookCardList
            webhooks={pageData}
            total={webhooks.length}
            page={page}
            pageCount={pageCount}
            pageSize={pageSize}
            error={webhooksQuery.isError ? webhooksQuery.error : null}
            onRetry={() => void webhooksQuery.refetch()}
            onPageChange={setPage}
            onPageSizeChange={(nextPageSize) => {
              setPageSize(nextPageSize)
              setPage(1)
            }}
            onEdit={(webhook) =>
              setForm({
                mode: 'edit',
                webhook,
                name: webhook.name,
              })
            }
            onToggle={(webhook) =>
              updateMutation.mutate({
                id: webhook.id,
                input: { enabled: !webhook.enabled },
              })
            }
            onResetSecret={(webhook) => resetSecretMutation.mutate(webhook.id)}
            onOpenDeliveries={(webhook) => {
              void navigate({
                to: '/webhook-deliveries',
                search: { webhookId: webhook.id },
              })
            }}
            onDelete={setDeleteTarget}
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

function WebhookCardList({
  webhooks,
  total,
  page,
  pageCount,
  pageSize,
  error,
  onRetry,
  onPageChange,
  onPageSizeChange,
  onEdit,
  onToggle,
  onResetSecret,
  onOpenDeliveries,
  onDelete,
}: {
  webhooks: DashboardWebhookDto[]
  total: number
  page: number
  pageCount: number
  pageSize: number
  error: unknown
  onRetry: () => void
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: number) => void
  onEdit: (webhook: DashboardWebhookDto) => void
  onToggle: (webhook: DashboardWebhookDto) => void
  onResetSecret: (webhook: DashboardWebhookDto) => void
  onOpenDeliveries: (webhook: DashboardWebhookDto) => void
  onDelete: (webhook: DashboardWebhookDto) => void
}) {
  if (error) {
    return (
      <Card>
        <CardContent className='flex flex-col items-start gap-3'>
          <div className='font-medium'>加载失败</div>
          <div className='text-sm text-muted-foreground'>
            {getWebhookErrorMessage(error, '列表加载失败')}
          </div>
          <Button variant='outline' size='sm' onClick={onRetry}>
            重试
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (total === 0) {
    return (
      <Card>
        <CardContent className='text-sm text-muted-foreground'>
          暂无数据
        </CardContent>
      </Card>
    )
  }

  return (
    <div className='flex flex-col gap-4'>
      <ul className='grid gap-4 md:grid-cols-2'>
        {webhooks.map((webhook) => (
          <li key={webhook.id}>
            <WebhookCard
              webhook={webhook}
              onEdit={onEdit}
              onToggle={onToggle}
              onResetSecret={onResetSecret}
              onOpenDeliveries={onOpenDeliveries}
              onDelete={onDelete}
            />
          </li>
        ))}
      </ul>
      <WebhookCardPagination
        page={Math.min(Math.max(1, page), pageCount)}
        pageCount={pageCount}
        pageSize={pageSize}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
      />
    </div>
  )
}

function WebhookCard({
  webhook,
  onEdit,
  onToggle,
  onResetSecret,
  onOpenDeliveries,
  onDelete,
}: {
  webhook: DashboardWebhookDto
  onEdit: (webhook: DashboardWebhookDto) => void
  onToggle: (webhook: DashboardWebhookDto) => void
  onResetSecret: (webhook: DashboardWebhookDto) => void
  onOpenDeliveries: (webhook: DashboardWebhookDto) => void
  onDelete: (webhook: DashboardWebhookDto) => void
}) {
  const [lastDeliveryLabel, statusLabel] = getCompactWebhookCardFieldLabels()

  return (
    <Card className='h-full gap-3'>
      <CardHeader>
        <CardTitle className='flex min-w-0 items-center gap-2 text-base'>
          <span className='truncate'>{webhook.name}</span>
          <Badge variant={webhook.enabled ? 'default' : 'secondary'}>
            {webhook.enabled ? '启用' : '停用'}
          </Badge>
        </CardTitle>
        <CardAction>
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button variant='ghost' size='icon' aria-label='Webhook 操作'>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end'>
              <DropdownMenuGroup>
                <DropdownMenuItem onClick={() => onOpenDeliveries(webhook)}>
                  记录
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onEdit(webhook)}>
                  重命名
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onResetSecret(webhook)}>
                  重置 secret
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem
                  variant='destructive'
                  onClick={() => onDelete(webhook)}
                >
                  删除
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </CardAction>
      </CardHeader>
      <CardContent className='flex flex-col gap-3'>
        <div className='grid gap-3 md:grid-cols-2'>
          <WebhookCardField label={lastDeliveryLabel}>
            {formatOptionalWebhookDateTime(webhook.lastDeliveryAt)}
          </WebhookCardField>
          <WebhookCardField label={statusLabel}>
            {webhook.lastDeliveryStatus ? (
              <Badge variant='outline'>
                {getWebhookDeliveryStatusLabel(webhook.lastDeliveryStatus)}
              </Badge>
            ) : (
              '-'
            )}
          </WebhookCardField>
        </div>
      </CardContent>
      <CardFooter className='justify-end gap-2'>
        <Button
          variant={webhook.enabled ? 'outline' : 'default'}
          size='sm'
          onClick={() => onToggle(webhook)}
        >
          {webhook.enabled ? '停用' : '启用'}
        </Button>
        <Button asChild variant='outline' size='sm'>
          <Link
            to='/webhooks/$webhookId'
            params={{ webhookId: webhook.id }}
          >
            详情
          </Link>
        </Button>
      </CardFooter>
    </Card>
  )
}

function WebhookCardField({
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

function WebhookCardPagination({
  page,
  pageCount,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: {
  page: number
  pageCount: number
  pageSize: number
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: number) => void
}) {
  const pageNumbers = getPageNumbers(page, pageCount)

  return (
    <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
      <div className='flex items-center gap-2'>
        <span className='text-sm text-muted-foreground'>每页</span>
        <Select
          value={`${pageSize}`}
          onValueChange={(value) => onPageSizeChange(Number(value))}
        >
          <SelectTrigger size='sm' className='w-20'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent side='top'>
            <SelectGroup>
              {[10, 20, 30, 40, 50].map((option) => (
                <SelectItem key={option} value={`${option}`}>
                  {option}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      <div className='flex flex-wrap items-center gap-2 sm:justify-end'>
        <Button
          variant='outline'
          size='icon'
          aria-label='上一页'
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft />
        </Button>
        {pageNumbers.map((pageNumber, index) =>
          pageNumber === '...' ? (
            <span
              key={`${pageNumber}-${index}`}
              className='px-1 text-sm text-muted-foreground'
            >
              ...
            </span>
          ) : (
            <Button
              key={pageNumber}
              variant={page === pageNumber ? 'default' : 'outline'}
              className='h-9 min-w-9 px-3'
              onClick={() => onPageChange(pageNumber)}
            >
              {pageNumber}
            </Button>
          )
        )}
        <Button
          variant='outline'
          size='icon'
          aria-label='下一页'
          disabled={page >= pageCount}
          onClick={() => onPageChange(page + 1)}
        >
          <ChevronRight />
        </Button>
      </div>
    </div>
  )
}

function WebhookCardListSkeleton() {
  return (
    <ul className='grid gap-4 md:grid-cols-2'>
      {Array.from({ length: 4 }).map((_, index) => (
        <li key={index}>
          <Card className='gap-4'>
            <CardHeader>
              <CardTitle className='flex items-center gap-2'>
                <Skeleton className='h-5 w-40' />
                <Skeleton className='h-5 w-12' />
              </CardTitle>
              <CardAction>
                <Skeleton className='size-9' />
              </CardAction>
            </CardHeader>
            <CardContent className='flex flex-col gap-4'>
              <Skeleton className='h-4 w-32' />
              <Skeleton className='h-4 w-full' />
              <Skeleton className='h-4 w-3/4' />
            </CardContent>
            <CardFooter className='gap-2'>
              <Skeleton className='h-8 w-16' />
              <Skeleton className='h-8 w-16' />
            </CardFooter>
          </Card>
        </li>
      ))}
    </ul>
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
