import { useMemo, useState } from 'react'
import { formatBytes } from '@synapse/shared'
import type { ColumnDef } from '@tanstack/react-table'
import { Copy, List, Plus } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  dashboardApi,
  type DashboardApiKey,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

const apiKeysQueryKey = ['dashboard-api-keys'] as const

export function ApiKeysSettings() {
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [selectedScopes, setSelectedScopes] = useState<string[]>([])
  const [created, setCreated] = useState<DashboardApiKeyCreateResult | null>(null)
  const [revokeTarget, setRevokeTarget] = useState<DashboardApiKey | null>(null)
  const [usageTarget, setUsageTarget] = useState<DashboardApiKey | null>(null)
  const { data = [], error, isError, isLoading, refetch } = useQuery({
    queryKey: apiKeysQueryKey,
    queryFn: dashboardApi.listApiKeys,
  })
  const { data: capabilities = [], isLoading: capabilitiesLoading } = useQuery({
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

  function submitCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedName = name.trim()
    if (!trimmedName || selectedScopes.length === 0) return
    createApiKey.mutate({ name: trimmedName, scopes: selectedScopes })
  }

  function toggleScope(scope: string, checked: boolean) {
    setSelectedScopes((current) => checked
      ? current.includes(scope) ? current : [...current, scope]
      : current.filter((item) => item !== scope))
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
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>名称</TableHead>
                  <TableHead>秘钥</TableHead>
                  <TableHead>API 权限</TableHead>
                  <TableHead>最后使用</TableHead>
                  <TableHead>创建时间</TableHead>
                  <TableHead className='text-end'>操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((apiKey) => (
                  <TableRow key={apiKey.id}>
                    <TableCell className='font-medium'>{apiKey.name}</TableCell>
                    <TableCell className='font-mono'>{apiKey.prefix}...</TableCell>
                    <TableCell>
                      <div className='flex flex-wrap gap-1'>
                        {apiKey.scopes.length > 0 ? apiKey.scopes.map((scope) => (
                          <Badge key={scope} variant='outline'>
                            {capabilityNames.get(scope) ?? scope}
                          </Badge>
                        )) : <span className='text-sm text-muted-foreground'>无开放接口权限</span>}
                      </div>
                    </TableCell>
                    <TableCell>
                      <RelativeTime value={apiKey.lastUsedAt} />
                    </TableCell>
                    <TableCell>
                      <RelativeTime value={apiKey.createdAt} mode='absolute' />
                    </TableCell>
                    <TableCell className='text-end'>
                      <Button variant='ghost' size='sm' onClick={() => setUsageTarget(apiKey)}>
                        <List />
                        使用记录
                      </Button>
                      <Button variant='ghost' size='sm' onClick={() => setRevokeTarget(apiKey)}>
                        撤销
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
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
            <div className='space-y-2'>
              <Label>API 权限</Label>
              <div className='space-y-2'>
                {capabilities.map((capability) => (
                  <label key={capability.scope} className='flex items-center gap-2 text-sm'>
                    <Checkbox
                      checked={selectedScopes.includes(capability.scope)}
                      onCheckedChange={(checked) => toggleScope(capability.scope, checked === true)}
                    />
                    {capability.name}
                  </label>
                ))}
              </div>
            </div>
            <DialogFooter>
              <Button type='button' variant='outline' onClick={() => setCreateOpen(false)}>
                取消
              </Button>
              <Button
                type='submit'
                disabled={!name.trim() || selectedScopes.length === 0 || capabilitiesLoading || createApiKey.isPending}
              >
                创建
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
