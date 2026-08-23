import { useMemo, useState } from 'react'
import { formatBytes } from '@synapse/shared'
import type { ColumnDef } from '@tanstack/react-table'
import { Copy, FileText, List, Plus, ShieldCheck } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  dashboardApi,
  type DashboardApiKey,
  type DashboardApiKeyCapability,
  type DashboardApiKeyCreateResult,
  type DashboardApiKeyUsageLog,
} from '@/lib/api'
import { ConfirmDialog } from '@/components/confirm-dialog'
import {
  DataTableColumnHeader,
  DEFAULT_DASHBOARD_PAGE_SIZE,
  ServerDataTable,
} from '@/components/data-table'
import { RelativeTime } from '@/components/relative-time'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'

const apiKeysQueryKey = ['dashboard-api-keys'] as const

export function ApiKeysSettings() {
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [selectedScopes, setSelectedScopes] = useState<string[]>([])
  const [created, setCreated] = useState<DashboardApiKeyCreateResult | null>(null)
  const [editTarget, setEditTarget] = useState<DashboardApiKey | null>(null)
  const [editScopes, setEditScopes] = useState<string[]>([])
  const [revokeTarget, setRevokeTarget] = useState<DashboardApiKey | null>(null)
  const [usageTarget, setUsageTarget] = useState<DashboardApiKey | null>(null)
  const { data = [], error, isError, isLoading, refetch } = useQuery({
    queryKey: apiKeysQueryKey,
    queryFn: dashboardApi.listApiKeys,
  })
  const {
    data: capabilities = [],
    isError: capabilitiesIsError,
    isLoading: capabilitiesLoading,
    refetch: refetchCapabilities,
  } = useQuery({
    queryKey: ['dashboard-api-key-capabilities'],
    queryFn: dashboardApi.listApiKeyCapabilities,
  })
  const capabilityNames = useMemo(
    () => new Map(capabilities.map((capability) => [capability.scope, capability.name])),
    [capabilities]
  )
  const createApiKey = useMutation({
    mutationFn: (input: { name: string; scopes: string[] }) => dashboardApi.createApiKey(input),
    onSuccess: (result) => {
      queryClient.setQueryData<DashboardApiKey[]>(apiKeysQueryKey, (current = []) => [
        result.apiKey,
        ...current,
      ])
      setName('')
      setSelectedScopes([])
      setCreateOpen(false)
      setCreated(result)
    },
    onError: (mutationError: Error) => toast.error(mutationError.message),
  })
  const revokeApiKey = useMutation({
    mutationFn: (id: string) => dashboardApi.revokeApiKey(id),
    onSuccess: (_result, id) => {
      queryClient.setQueryData<DashboardApiKey[]>(apiKeysQueryKey, (current = []) => (
        current.filter((apiKey) => apiKey.id !== id)
      ))
      setRevokeTarget(null)
      toast.success('已撤销')
    },
    onError: (mutationError: Error) => toast.error(mutationError.message),
  })
  const updateApiKeyPermissions = useMutation({
    mutationFn: (input: { id: string; scopes: string[] }) => (
      dashboardApi.updateApiKeyPermissions(input.id, input.scopes)
    ),
    onSuccess: (updated) => {
      queryClient.setQueryData<DashboardApiKey[]>(apiKeysQueryKey, (current = []) => (
        current.map((apiKey) => apiKey.id === updated.id ? updated : apiKey)
      ))
      setEditTarget(null)
      setEditScopes([])
      toast.success('权限已更新')
    },
    onError: (mutationError: Error) => toast.error(mutationError.message),
  })

  function submitCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedName = name.trim()
    if (!trimmedName || selectedScopes.length === 0) return
    createApiKey.mutate({ name: trimmedName, scopes: selectedScopes })
  }

  function toggleScope(scope: string, checked: boolean) {
    setSelectedScopes((current) => toggleScopeValue(current, scope, checked))
  }

  function openPermissionEditor(apiKey: DashboardApiKey) {
    setEditTarget(apiKey)
    setEditScopes([...apiKey.scopes])
  }

  function closePermissionEditor() {
    setEditTarget(null)
    setEditScopes([])
  }

  function submitPermissionUpdate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editTarget || sameScopes(editTarget.scopes, editScopes)) return
    updateApiKeyPermissions.mutate({ id: editTarget.id, scopes: editScopes })
  }

  async function copySecret() {
    if (!created) return
    try {
      await navigator.clipboard.writeText(created.secret)
      toast.success('已复制')
    } catch (copyError) {
      toast.error(copyError instanceof Error ? copyError.message : '复制失败')
    }
  }

  return (
    <section className='flex flex-1 flex-col'>
      <div className='flex flex-none items-center justify-between gap-3'>
        <h3 className='text-lg font-medium'>API 秘钥</h3>
        <Button size='sm' onClick={() => setCreateOpen(true)}>
          <Plus />
          创建秘钥
        </Button>
      </div>
      <Separator className='my-4 flex-none' />
      <div className='h-full w-full overflow-y-auto pe-4 pb-12'>
        <div className='max-w-3xl'>
          {isLoading ? (
            <div className='text-sm text-muted-foreground'>加载中...</div>
          ) : null}
          {isError ? (
            <div className='flex flex-col items-start gap-3'>
              <div className='space-y-1'>
                <div className='font-medium'>加载失败</div>
                <p className='text-sm text-muted-foreground'>
                  {error instanceof Error ? error.message : '请求失败'}
                </p>
              </div>
              <Button variant='outline' size='sm' onClick={() => void refetch()}>
                重试
              </Button>
            </div>
          ) : null}
          {!isLoading && !isError && data.length === 0 ? (
            <div className='py-8 text-center text-sm text-muted-foreground'>尚无秘钥</div>
          ) : null}
          {!isLoading && !isError && data.length > 0 ? (
            <div className='space-y-3'>
              {data.map((apiKey) => (
                <Card key={apiKey.id} className='gap-4 py-4 shadow-none'>
                  <CardHeader className='flex flex-col gap-3 px-4 sm:flex-row sm:items-start sm:justify-between'>
                    <div className='min-w-0'>
                      <CardTitle className='truncate text-base'>{apiKey.name}</CardTitle>
                      <CardDescription className='mt-1 truncate font-mono'>
                        {apiKey.prefix}...
                      </CardDescription>
                    </div>
                    <div className='flex flex-wrap items-center gap-1 sm:justify-end'>
                      <Button variant='ghost' size='sm' onClick={() => openPermissionEditor(apiKey)}>
                        <ShieldCheck />
                        编辑权限
                      </Button>
                      <Button variant='ghost' size='sm' onClick={() => setUsageTarget(apiKey)}>
                        <List />
                        使用记录
                      </Button>
                      <Button variant='ghost' size='sm' onClick={() => setRevokeTarget(apiKey)}>
                        撤销
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className='flex flex-col gap-4 px-4 sm:flex-row sm:items-end sm:justify-between'>
                    <div className='min-w-0 space-y-2'>
                      <div className='text-xs font-medium text-muted-foreground'>API 权限</div>
                      <div className='flex flex-wrap gap-1'>
                        {apiKey.scopes.length > 0 ? apiKey.scopes.map((scope) => (
                          <Badge key={scope} variant='outline'>
                            {capabilityNames.get(scope) ?? scope}
                          </Badge>
                        )) : <span className='text-sm text-muted-foreground'>无开放接口权限</span>}
                      </div>
                    </div>
                    <dl className='grid shrink-0 grid-cols-2 gap-x-6 gap-y-2'>
                      <div>
                        <dt className='text-xs text-muted-foreground'>最后使用</dt>
                        <dd className='mt-1 text-sm'>
                          <RelativeTime value={apiKey.lastUsedAt} />
                        </dd>
                      </div>
                      <div>
                        <dt className='text-xs text-muted-foreground'>创建时间</dt>
                        <dd className='mt-1 text-sm'>
                          <RelativeTime value={apiKey.createdAt} mode='absolute' />
                        </dd>
                      </div>
                    </dl>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <form className='space-y-4' onSubmit={submitCreate}>
            <DialogHeader>
              <DialogTitle>创建秘钥</DialogTitle>
              <DialogDescription>完整秘钥只会显示一次。</DialogDescription>
            </DialogHeader>
            <div className='space-y-2'>
              <Label htmlFor='api-key-name'>名称</Label>
              <Input
                id='api-key-name'
                value={name}
                maxLength={80}
                onChange={(event) => setName(event.target.value)}
                autoFocus
              />
            </div>
            <ApiKeyPermissionSelector
              idPrefix='api-key-create'
              capabilities={capabilities}
              selectedScopes={selectedScopes}
              onToggle={toggleScope}
              isLoading={capabilitiesLoading}
              isError={capabilitiesIsError}
              onRetry={() => void refetchCapabilities()}
              disabled={createApiKey.isPending}
            />
            <DialogFooter>
              <Button type='button' variant='outline' onClick={() => setCreateOpen(false)}>
                取消
              </Button>
              <Button
                type='submit'
                disabled={!name.trim() || selectedScopes.length === 0 || capabilitiesLoading || capabilitiesIsError || createApiKey.isPending}
              >
                创建
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(editTarget)}
        onOpenChange={(open) => !open && closePermissionEditor()}
      >
        <DialogContent>
          <form className='space-y-4' onSubmit={submitPermissionUpdate}>
            <DialogHeader>
              <DialogTitle>编辑 API 权限</DialogTitle>
              <DialogDescription>{editTarget?.name ?? ''}</DialogDescription>
            </DialogHeader>
            <ApiKeyPermissionSelector
              idPrefix='api-key-edit'
              capabilities={capabilities}
              selectedScopes={editScopes}
              onToggle={(scope, checked) => (
                setEditScopes((current) => toggleScopeValue(current, scope, checked))
              )}
              isLoading={capabilitiesLoading}
              isError={capabilitiesIsError}
              onRetry={() => void refetchCapabilities()}
              disabled={updateApiKeyPermissions.isPending}
            />
            <DialogFooter>
              <Button type='button' variant='outline' onClick={closePermissionEditor}>
                取消
              </Button>
              <Button
                type='submit'
                disabled={
                  !editTarget
                  || sameScopes(editTarget.scopes, editScopes)
                  || capabilitiesLoading
                  || capabilitiesIsError
                  || updateApiKeyPermissions.isPending
                }
              >
                保存权限
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(created)} onOpenChange={(open) => !open && setCreated(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>秘钥已创建</DialogTitle>
            <DialogDescription>请立即复制，关闭后无法再次查看。</DialogDescription>
          </DialogHeader>
          <div className='flex items-center gap-2'>
            <Input value={created?.secret ?? ''} readOnly className='font-mono' />
            <Button type='button' variant='outline' size='icon' onClick={() => void copySecret()}>
              <Copy />
              <span className='sr-only'>复制秘钥</span>
            </Button>
          </div>
          <DialogFooter>
            <Button type='button' onClick={() => setCreated(null)}>完成</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(revokeTarget)}
        onOpenChange={(open) => !open && setRevokeTarget(null)}
        title='撤销秘钥'
        desc={`撤销“${revokeTarget?.name ?? ''}”后将无法恢复。`}
        cancelBtnText='取消'
        confirmText='撤销'
        destructive
        isLoading={revokeApiKey.isPending}
        handleConfirm={() => revokeTarget && revokeApiKey.mutate(revokeTarget.id)}
      />

      <ApiKeyUsageDialog apiKey={usageTarget} onOpenChange={(open) => !open && setUsageTarget(null)} />
    </section>
  )
}

function ApiKeyPermissionSelector({
  idPrefix,
  capabilities,
  selectedScopes,
  onToggle,
  isLoading,
  isError,
  onRetry,
  disabled,
}: {
  readonly idPrefix: string
  readonly capabilities: readonly DashboardApiKeyCapability[]
  readonly selectedScopes: readonly string[]
  readonly onToggle: (scope: string, checked: boolean) => void
  readonly isLoading: boolean
  readonly isError: boolean
  readonly onRetry: () => void
  readonly disabled: boolean
}) {
  return (
    <fieldset className='space-y-2' disabled={disabled}>
      <legend className='text-sm font-medium'>API 权限</legend>
      {isLoading ? (
        <div className='space-y-3 rounded-lg border p-3' aria-label='API 权限加载中'>
          <Skeleton className='h-4 w-32' />
          <Skeleton className='h-4 w-64' />
        </div>
      ) : isError ? (
        <div className='flex items-center justify-between gap-3 rounded-lg border p-3'>
          <span className='text-sm text-muted-foreground'>权限加载失败</span>
          <Button type='button' variant='outline' size='sm' onClick={onRetry}>
            重试
          </Button>
        </div>
      ) : capabilities.length === 0 ? (
        <div className='rounded-lg border p-3 text-sm text-muted-foreground'>暂无可用权限</div>
      ) : (
        <div className='max-h-64 overflow-y-auto rounded-lg border'>
          <div className='divide-y'>
            {capabilities.map((capability) => {
              const checkboxId = `${idPrefix}-${capability.scope}`
              const descriptionId = `${checkboxId}-description`
              return (
                <div
                  key={capability.scope}
                  className='flex items-center gap-3 px-3 py-3 hover:bg-muted/50'
                >
                  <label
                    htmlFor={checkboxId}
                    className='flex min-w-0 flex-1 cursor-pointer items-start gap-3'
                  >
                    <Checkbox
                      id={checkboxId}
                      className='mt-0.5'
                      checked={selectedScopes.includes(capability.scope)}
                      aria-describedby={descriptionId}
                      onCheckedChange={(checked) => onToggle(capability.scope, checked === true)}
                    />
                    <span className='min-w-0 space-y-1'>
                      <span className='block text-sm font-medium'>{capability.name}</span>
                      <span id={descriptionId} className='block text-sm text-muted-foreground'>
                        {capability.description}
                      </span>
                    </span>
                  </label>
                  <Button asChild variant='ghost' size='sm'>
                    <a
                      href={capability.documentationUrl}
                      target='_blank'
                      rel='noreferrer'
                      aria-label={`${capability.name} API 文档`}
                    >
                      <FileText />
                      文档
                    </a>
                  </Button>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </fieldset>
  )
}

function toggleScopeValue(current: readonly string[], scope: string, checked: boolean): string[] {
  return checked
    ? current.includes(scope) ? [...current] : [...current, scope]
    : current.filter((item) => item !== scope)
}

function sameScopes(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((scope) => right.includes(scope))
}

function ApiKeyUsageDialog({
  apiKey,
  onOpenChange,
}: {
  readonly apiKey: DashboardApiKey | null
  readonly onOpenChange: (open: boolean) => void
}) {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_DASHBOARD_PAGE_SIZE)
  const { data, error, isError, isLoading, refetch } = useQuery({
    queryKey: ['dashboard-api-key-usage', apiKey?.id, page, pageSize],
    queryFn: () => dashboardApi.listApiKeyUsageLogs(apiKey!.id, { page, pageSize }),
    enabled: Boolean(apiKey),
  })
  const columns = useMemo<ColumnDef<DashboardApiKeyUsageLog>[]>(() => [
    {
      accessorKey: 'startedAt',
      header: ({ column }) => <DataTableColumnHeader column={column} title='时间' />,
      cell: ({ row }) => <RelativeTime value={row.original.startedAt} mode='absolute' />,
      enableSorting: false,
    },
    {
      accessorKey: 'operation',
      header: ({ column }) => <DataTableColumnHeader column={column} title='操作' />,
      cell: ({ row }) => usageOperationLabels[row.original.operation],
      enableSorting: false,
    },
    {
      accessorKey: 'status',
      header: ({ column }) => <DataTableColumnHeader column={column} title='状态' />,
      cell: ({ row }) => <Badge variant='outline'>{usageStatusLabels[row.original.status]}</Badge>,
      enableSorting: false,
    },
    {
      accessorKey: 'httpStatus',
      header: ({ column }) => <DataTableColumnHeader column={column} title='HTTP' />,
      cell: ({ row }) => row.original.httpStatus ?? '-',
      enableSorting: false,
      meta: { className: 'text-end tabular-nums' },
    },
    {
      accessorKey: 'artifactType',
      header: ({ column }) => <DataTableColumnHeader column={column} title='制品' />,
      cell: ({ row }) => row.original.artifactType === 'archive'
        ? 'ZIP'
        : row.original.artifactType === 'file' ? '文件' : '-',
      enableSorting: false,
    },
    {
      accessorKey: 'responseBytes',
      header: ({ column }) => <DataTableColumnHeader column={column} title='传输' />,
      cell: ({ row }) => row.original.responseBytes ? formatBytes(row.original.responseBytes) : '-',
      enableSorting: false,
      meta: { className: 'text-end tabular-nums' },
    },
    {
      accessorKey: 'requestId',
      header: ({ column }) => <DataTableColumnHeader column={column} title='Request ID' />,
      cell: ({ row }) => <span className='font-mono text-xs'>{row.original.requestId}</span>,
      enableSorting: false,
    },
  ], [])

  return (
    <Dialog open={Boolean(apiKey)} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-5xl'>
        <DialogHeader>
          <DialogTitle>{apiKey?.name ?? ''} 使用记录</DialogTitle>
          <DialogDescription className='sr-only'>API 密钥使用记录</DialogDescription>
        </DialogHeader>
        <ServerDataTable
          columns={columns}
          data={data?.data ?? []}
          page={page}
          pageSize={pageSize}
          total={data?.total ?? 0}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          error={isError ? error : null}
          onRetry={() => void refetch()}
          isLoading={isLoading}
          emptyMessage='暂无使用记录'
        />
      </DialogContent>
    </Dialog>
  )
}

const usageOperationLabels = {
  grant_create: '创建下载地址',
  download: '下载',
} as const

const usageStatusLabels = {
  started: '进行中',
  succeeded: '成功',
  failed: '失败',
  aborted: '已中断',
} as const
