import { TextField } from '@heroui/react';
import { useReturnFocus } from '@/hooks/use-return-focus';
import { Link as HeroLink } from '@heroui/react';
import { Button, Card, Checkbox, Chip, Input, Label, Modal, Separator, Skeleton, toast } from '@heroui/react';
import { useMemo, useRef, useState } from 'react';
import { formatBytes } from '@synapse/shared';
import type { ColumnDef } from '@tanstack/react-table';
import { Copy, List, Pencil, Plus, ShieldCheck } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { dashboardApi, type DashboardApiKey, type DashboardApiKeyCapability, type DashboardApiKeyCreateResult, type DashboardApiKeyUsageLog, } from '@/lib/api';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { DataTableColumnHeader, DEFAULT_DASHBOARD_PAGE_SIZE, ServerDataTable, } from '@/components/data-table';
import { RelativeTime } from '@/components/relative-time';
const apiKeysQueryKey = ['dashboard-api-keys'] as const;
export function ApiKeysSettings() {
    const queryClient = useQueryClient();
    const createTriggerRef = useRef<HTMLButtonElement>(null);
    const renameTriggerRef = useRef<HTMLButtonElement>(null);
    const permissionTriggerRef = useRef<HTMLButtonElement>(null);
    const usageTriggerRef = useRef<HTMLButtonElement>(null);
    const revokeTriggerRef = useRef<HTMLButtonElement>(null);
    const [createOpen, setCreateOpen] = useState(false);
    const [name, setName] = useState('');
    const [selectedScopes, setSelectedScopes] = useState<string[]>([]);
    const [created, setCreated] = useState<DashboardApiKeyCreateResult | null>(null);
    const [renameTarget, setRenameTarget] = useState<DashboardApiKey | null>(null);
    const [renameName, setRenameName] = useState('');
    const [editTarget, setEditTarget] = useState<DashboardApiKey | null>(null);
    const [editScopes, setEditScopes] = useState<string[]>([]);
    const [revokeTarget, setRevokeTarget] = useState<DashboardApiKey | null>(null);
    const [usageTarget, setUsageTarget] = useState<DashboardApiKey | null>(null);
    const { data = [], error, isError, isLoading, refetch } = useQuery({
        queryKey: apiKeysQueryKey,
        queryFn: dashboardApi.listApiKeys,
    });
    const { data: capabilities = [], isError: capabilitiesIsError, isLoading: capabilitiesLoading, refetch: refetchCapabilities, } = useQuery({
        queryKey: ['dashboard-api-key-capabilities'],
        queryFn: dashboardApi.listApiKeyCapabilities,
    });
    const capabilityNames = useMemo(() => new Map(capabilities.map((capability) => [capability.scope, capability.name])), [capabilities]);
    useReturnFocus(createOpen, createTriggerRef, undefined, Boolean(created));
    useReturnFocus(Boolean(renameTarget), renameTriggerRef);
    useReturnFocus(Boolean(editTarget), permissionTriggerRef);
    useReturnFocus(Boolean(usageTarget), usageTriggerRef);
    const createApiKey = useMutation({
        mutationFn: (input: {
            name: string;
            scopes: string[];
        }) => dashboardApi.createApiKey(input),
        onSuccess: (result) => {
            queryClient.setQueryData<DashboardApiKey[]>(apiKeysQueryKey, (current = []) => [
                result.apiKey,
                ...current,
            ]);
            closeCreateDialog();
            setCreated(result);
        },
        onError: (mutationError: Error) => toast.danger(mutationError.message),
    });
    const revokeApiKey = useMutation({
        mutationFn: (id: string) => dashboardApi.revokeApiKey(id),
        onSuccess: (_result, id) => {
            queryClient.setQueryData<DashboardApiKey[]>(apiKeysQueryKey, (current = []) => (current.filter((apiKey) => apiKey.id !== id)));
            setRevokeTarget(null);
            toast.success('已撤销');
        },
        onError: (mutationError: Error) => toast.danger(mutationError.message),
    });
    const updateApiKeyPermissions = useMutation({
        mutationFn: (input: {
            id: string;
            scopes: string[];
        }) => (dashboardApi.updateApiKeyPermissions(input.id, input.scopes)),
        onSuccess: (updated) => {
            queryClient.setQueryData<DashboardApiKey[]>(apiKeysQueryKey, (current = []) => (current.map((apiKey) => apiKey.id === updated.id ? updated : apiKey)));
            setEditTarget(null);
            setEditScopes([]);
            toast.success('权限已更新');
        },
        onError: (mutationError: Error) => toast.danger(mutationError.message),
    });
    const renameApiKey = useMutation({
        mutationFn: (input: {
            id: string;
            name: string;
        }) => (dashboardApi.renameApiKey(input.id, input.name)),
        onSuccess: (updated) => {
            queryClient.setQueryData<DashboardApiKey[]>(apiKeysQueryKey, (current = []) => (current.map((apiKey) => apiKey.id === updated.id ? updated : apiKey)));
            closeRenameDialog();
            toast.success('名称已更新');
        },
        onError: (mutationError: Error) => toast.danger(mutationError.message),
    });
    function submitCreate(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const trimmedName = name.trim();
        if (!trimmedName || selectedScopes.length === 0)
            return;
        createApiKey.mutate({ name: trimmedName, scopes: selectedScopes });
    }
    function closeCreateDialog() {
        setCreateOpen(false);
        setName('');
        setSelectedScopes([]);
    }
    function toggleScope(scope: string, checked: boolean) {
        setSelectedScopes((current) => toggleScopeValue(current, scope, checked));
    }
    function openPermissionEditor(apiKey: DashboardApiKey) {
        setEditTarget(apiKey);
        setEditScopes([...apiKey.scopes]);
    }
    function openRenameDialog(apiKey: DashboardApiKey) {
        setRenameTarget(apiKey);
        setRenameName(apiKey.name);
    }
    function closeRenameDialog() {
        setRenameTarget(null);
        setRenameName('');
    }
    function submitRename(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const trimmedName = renameName.trim();
        if (!renameTarget || !trimmedName || trimmedName === renameTarget.name)
            return;
        renameApiKey.mutate({ id: renameTarget.id, name: trimmedName });
    }
    function closePermissionEditor() {
        setEditTarget(null);
        setEditScopes([]);
    }
    function submitPermissionUpdate(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!editTarget || sameScopes(editTarget.scopes, editScopes))
            return;
        updateApiKeyPermissions.mutate({ id: editTarget.id, scopes: editScopes });
    }
    async function copySecret() {
        if (!created)
            return;
        try {
            await navigator.clipboard.writeText(created.secret);
            toast.success('已复制');
        }
        catch (copyError) {
            toast.danger(copyError instanceof Error ? copyError.message : '复制失败');
        }
    }
    return (<section className='flex flex-1 flex-col'>
      <div className='flex flex-none items-center justify-between gap-3'>
        <h3 className='text-lg font-medium'>API 密钥</h3>
        <Button ref={createTriggerRef} onPress={() => setCreateOpen(true)}>
          <Plus />
          创建密钥
        </Button>
      </div>
      <Separator className='my-4 flex-none'></Separator>
      <div className='h-full w-full overflow-y-auto pe-4 pb-12'>
        <div className='max-w-3xl'>
          {isLoading ? (<div className='text-sm text-muted'>加载中...</div>) : null}
          {isError ? (<div className='flex flex-col items-start gap-3'>
              <div className='space-y-1'>
                <div className='font-medium'>加载失败</div>
                <p className='text-sm text-muted'>
                  {error instanceof Error ? error.message : '请求失败'}
                </p>
              </div>
              <Button variant="outline" onPress={() => void refetch()}>
                重试
              </Button>
            </div>) : null}
          {!isLoading && !isError && data.length === 0 ? (<div className='py-8 text-center text-sm text-muted'>尚无密钥</div>) : null}
          {!isLoading && !isError && data.length > 0 ? (<div className='space-y-3'>
              {data.map((apiKey) => (<Card key={apiKey.id} className='gap-4 py-4 shadow-none'>
                  <Card.Header className='flex flex-col gap-3 px-4 sm:flex-row sm:items-start sm:justify-between'>
                    <div className='min-w-0'>
                      <Card.Title className='truncate text-base'>{apiKey.name}</Card.Title>
                      <Card.Description className='mt-1 truncate font-mono'>
                        {apiKey.prefix}...
                      </Card.Description>
                    </div>
                    <div className='flex flex-wrap items-center gap-1 sm:justify-end'>
                      <Button variant="ghost" onPress={(event) => {
                    renameTriggerRef.current = event.target.closest('button');
                    openRenameDialog(apiKey);
                }}>
                        <Pencil />
                        重命名
                      </Button>
                      <Button variant="ghost" onPress={(event) => {
                    permissionTriggerRef.current = event.target.closest('button');
                    openPermissionEditor(apiKey);
                }}>
                        <ShieldCheck />
                        编辑权限
                      </Button>
                      <Button variant="ghost" onPress={(event) => {
                    usageTriggerRef.current = event.target.closest('button');
                    setUsageTarget(apiKey);
                }}>
                        <List />
                        使用记录
                      </Button>
                      <Button variant="ghost" onPress={(event) => {
                    revokeTriggerRef.current = event.target.closest('button');
                    setRevokeTarget(apiKey);
                }}>
                        撤销
                      </Button>
                    </div>
                  </Card.Header>
                  <Card.Content className='flex flex-col gap-4 px-4 sm:flex-row sm:items-end sm:justify-between'>
                    <div className='min-w-0 space-y-2'>
                      <div className='text-xs font-medium text-muted'>API 权限</div>
                      <div className='flex flex-wrap gap-1'>
                        {apiKey.scopes.length > 0 ? apiKey.scopes.map((scope) => (<Chip key={scope} variant="tertiary">
                            {capabilityNames.get(scope) ?? scope}
                          </Chip>)) : <span className='text-sm text-muted'>无开放接口权限</span>}
                      </div>
                    </div>
                    <dl className='grid shrink-0 grid-cols-2 gap-x-6 gap-y-2'>
                      <div>
                        <dt className='text-xs text-muted'>最后使用</dt>
                        <dd className='mt-1 text-sm'>
                          <RelativeTime value={apiKey.lastUsedAt}/>
                        </dd>
                      </div>
                      <div>
                        <dt className='text-xs text-muted'>创建时间</dt>
                        <dd className='mt-1 text-sm'>
                          <RelativeTime value={apiKey.createdAt} mode='absolute'/>
                        </dd>
                      </div>
                    </dl>
                  </Card.Content>
                </Card>))}
            </div>) : null}
        </div>
      </div>

      <Modal.Backdrop isOpen={createOpen} onOpenChange={(open) => open ? setCreateOpen(true) : closeCreateDialog()}><Modal.Container><Modal.Dialog>
          <form className='flex min-h-0 flex-1 flex-col' onSubmit={submitCreate}>
            <Modal.Header>
              <Modal.Heading>创建密钥</Modal.Heading>
              <p>完整密钥只会显示一次。</p>
            </Modal.Header>
            <Modal.Body className='space-y-4'>
              <TextField className='space-y-2'>
                <Label htmlFor='api-key-name'>名称</Label>
                <Input id='api-key-name' value={name} maxLength={80} onChange={(event) => setName(event.target.value)} autoFocus></Input>
              </TextField>
              <ApiKeyPermissionSelector idPrefix='api-key-create' capabilities={capabilities} selectedScopes={selectedScopes} onToggle={toggleScope} isLoading={capabilitiesLoading} isError={capabilitiesIsError} onRetry={() => void refetchCapabilities()} disabled={createApiKey.isPending}/>
            </Modal.Body>
            <Modal.Footer>
              <Button type='button' variant="outline" onPress={closeCreateDialog}>
                取消
              </Button>
              <Button type='submit' isDisabled={!name.trim() || selectedScopes.length === 0 || capabilitiesLoading || capabilitiesIsError || createApiKey.isPending}>
                创建
              </Button>
            </Modal.Footer>
          </form>
        </Modal.Dialog></Modal.Container></Modal.Backdrop>

      <Modal.Backdrop isOpen={Boolean(editTarget)} onOpenChange={(open) => !open && closePermissionEditor()}><Modal.Container><Modal.Dialog>
          <form className='flex min-h-0 flex-1 flex-col' onSubmit={submitPermissionUpdate}>
            <Modal.Header>
              <Modal.Heading>编辑 API 权限</Modal.Heading>
              <p>{editTarget?.name ?? ''}</p>
            </Modal.Header>
            <Modal.Body className='space-y-4'>
              <ApiKeyPermissionSelector idPrefix='api-key-edit' capabilities={capabilities} selectedScopes={editScopes} onToggle={(scope, checked) => (setEditScopes((current) => toggleScopeValue(current, scope, checked)))} isLoading={capabilitiesLoading} isError={capabilitiesIsError} onRetry={() => void refetchCapabilities()} disabled={updateApiKeyPermissions.isPending}/>
            </Modal.Body>
            <Modal.Footer>
              <Button type='button' variant="outline" onPress={closePermissionEditor}>
                取消
              </Button>
              <Button type='submit' isDisabled={!editTarget
            || sameScopes(editTarget.scopes, editScopes)
            || capabilitiesLoading
            || capabilitiesIsError
            || updateApiKeyPermissions.isPending}>
                保存权限
              </Button>
            </Modal.Footer>
          </form>
        </Modal.Dialog></Modal.Container></Modal.Backdrop>

      <Modal.Backdrop isOpen={Boolean(created)} onOpenChange={(open) => !open && setCreated(null)}><Modal.Container><Modal.Dialog>
          <Modal.Header>
            <Modal.Heading>密钥已创建</Modal.Heading>
            <p>请立即复制，关闭后无法再次查看。</p>
          </Modal.Header>
          <Modal.Body>
            <div className='flex items-center gap-2'>
              <Input value={created?.secret ?? ''} readOnly className='font-mono'></Input>
              <Button type='button' variant="outline" isIconOnly onPress={() => void copySecret()}>
                <Copy />
                <span className='sr-only'>复制密钥</span>
              </Button>
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button type='button' onPress={() => setCreated(null)}>完成</Button>
          </Modal.Footer>
        </Modal.Dialog></Modal.Container></Modal.Backdrop>

      <Modal.Backdrop isOpen={Boolean(renameTarget)} onOpenChange={(open) => !open && closeRenameDialog()}><Modal.Container><Modal.Dialog>
          <form className='flex min-h-0 flex-1 flex-col' onSubmit={submitRename}>
            <Modal.Header>
              <Modal.Heading>重命名密钥</Modal.Heading>
              <p>{renameTarget?.prefix ?? ''}...</p>
            </Modal.Header>
            <Modal.Body className='space-y-4'>
              <TextField className='space-y-2'>
                <Label htmlFor='api-key-rename-name'>名称</Label>
                <Input id='api-key-rename-name' value={renameName} maxLength={80} onChange={(event) => setRenameName(event.target.value)} autoFocus></Input>
              </TextField>
            </Modal.Body>
            <Modal.Footer>
              <Button type='button' variant="outline" onPress={closeRenameDialog}>
                取消
              </Button>
              <Button type='submit' isDisabled={!renameTarget
            || !renameName.trim()
            || renameName.trim() === renameTarget.name
            || renameApiKey.isPending}>
                保存名称
              </Button>
            </Modal.Footer>
          </form>
        </Modal.Dialog></Modal.Container></Modal.Backdrop>

      <ConfirmDialog open={Boolean(revokeTarget)} onOpenChange={(open) => !open && setRevokeTarget(null)} title='撤销密钥' desc={`撤销“${revokeTarget?.name ?? ''}”后将无法恢复。`} cancelBtnText='取消' confirmText='撤销' destructive isLoading={revokeApiKey.isPending} handleConfirm={() => revokeTarget && revokeApiKey.mutate(revokeTarget.id)} onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (revokeTriggerRef.current?.isConnected) {
                revokeTriggerRef.current.focus();
                return;
            }
            createTriggerRef.current?.focus();
        }}/>

      <ApiKeyUsageDialog apiKey={usageTarget} onOpenChange={(open) => !open && setUsageTarget(null)}/>
    </section>);
}
function ApiKeyPermissionSelector({ idPrefix, capabilities, selectedScopes, onToggle, isLoading, isError, onRetry, disabled, }: {
    readonly idPrefix: string;
    readonly capabilities: readonly DashboardApiKeyCapability[];
    readonly selectedScopes: readonly string[];
    readonly onToggle: (scope: string, checked: boolean) => void;
    readonly isLoading: boolean;
    readonly isError: boolean;
    readonly onRetry: () => void;
    readonly disabled: boolean;
}) {
    return (<fieldset className='space-y-2' disabled={disabled}>
      <legend className='text-sm font-medium'>API 权限</legend>
      {isLoading ? (<div className='space-y-3 rounded-lg border p-3' aria-label='API 权限加载中'>
          <Skeleton className='h-4 w-32'></Skeleton>
          <Skeleton className='h-4 w-64'></Skeleton>
        </div>) : isError ? (<div className='flex items-center justify-between gap-3 rounded-lg border p-3'>
          <span className='text-sm text-muted'>权限加载失败</span>
          <Button type='button' variant="outline" onPress={onRetry}>
            重试
          </Button>
        </div>) : capabilities.length === 0 ? (<div className='rounded-lg border p-3 text-sm text-muted'>暂无可用权限</div>) : (<div className='max-h-64 overflow-y-auto rounded-lg border'>
          <div className='divide-y'>
            {capabilities.map((capability) => {
                const checkboxId = `${idPrefix}-${capability.scope}`;
                const descriptionId = `${checkboxId}-description`;
                return (<div key={capability.scope} className='flex items-start gap-3 px-3 py-3 hover:bg-surface-secondary/50'>
                  <Checkbox id={checkboxId} className='mt-2' isSelected={selectedScopes.includes(capability.scope)} aria-describedby={descriptionId} onChange={(checked) => onToggle(capability.scope, checked === true)}><Checkbox.Content><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control></Checkbox.Content></Checkbox>
                  <div className='min-w-0 flex-1 space-y-1'>
                    <div className='flex items-center justify-between gap-3'>
                      <label htmlFor={checkboxId} className='min-w-0 cursor-pointer truncate text-sm font-medium'>
                        {capability.name}
                      </label>
                      <HeroLink target='_blank' rel='noreferrer' aria-label={`${capability.name} API 文档`} href={capability.documentationUrl}>
                          文档<HeroLink.Icon />
                        </HeroLink>
                    </div>
                    <span id={descriptionId} className='block text-sm text-muted'>
                      {capability.description}
                    </span>
                  </div>
                </div>);
            })}
          </div>
        </div>)}
    </fieldset>);
}
function toggleScopeValue(current: readonly string[], scope: string, checked: boolean): string[] {
    return checked
        ? current.includes(scope) ? [...current] : [...current, scope]
        : current.filter((item) => item !== scope);
}
function sameScopes(left: readonly string[], right: readonly string[]): boolean {
    return left.length === right.length && left.every((scope) => right.includes(scope));
}
function ApiKeyUsageDialog({ apiKey, onOpenChange, }: {
    readonly apiKey: DashboardApiKey | null;
    readonly onOpenChange: (open: boolean) => void;
}) {
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(DEFAULT_DASHBOARD_PAGE_SIZE);
    const { data, error, isError, isLoading, refetch } = useQuery({
        queryKey: ['dashboard-api-key-usage', apiKey?.id, page, pageSize],
        queryFn: () => dashboardApi.listApiKeyUsageLogs(apiKey!.id, { page, pageSize }),
        enabled: Boolean(apiKey),
    });
    const columns = useMemo<ColumnDef<DashboardApiKeyUsageLog>[]>(() => [
        {
            meta: { label: '时间' },
            accessorKey: 'startedAt',
            header: ({ column }) => <DataTableColumnHeader column={column} title='时间'/>,
            cell: ({ row }) => <RelativeTime value={row.original.startedAt} mode='absolute'/>,
            enableSorting: false,
        },
        {
            meta: { label: '操作' },
            accessorKey: 'operation',
            header: ({ column }) => <DataTableColumnHeader column={column} title='操作'/>,
            cell: ({ row }) => usageOperationLabels[row.original.operation],
            enableSorting: false,
        },
        {
            meta: { label: '状态' },
            accessorKey: 'status',
            header: ({ column }) => <DataTableColumnHeader column={column} title='状态'/>,
            cell: ({ row }) => <Chip variant="tertiary">{usageStatusLabels[row.original.status]}</Chip>,
            enableSorting: false,
        },
        {
            accessorKey: 'httpStatus',
            header: ({ column }) => <DataTableColumnHeader column={column} title='HTTP'/>,
            cell: ({ row }) => row.original.httpStatus ?? '-',
            enableSorting: false,
            meta: { label: 'HTTP', className: 'text-end tabular-nums' },
        },
        {
            meta: { label: '制品' },
            accessorKey: 'artifactType',
            header: ({ column }) => <DataTableColumnHeader column={column} title='制品'/>,
            cell: ({ row }) => row.original.artifactType === 'archive'
                ? 'ZIP'
                : row.original.artifactType === 'file' ? '文件' : '-',
            enableSorting: false,
        },
        {
            accessorKey: 'responseBytes',
            header: ({ column }) => <DataTableColumnHeader column={column} title='传输'/>,
            cell: ({ row }) => row.original.responseBytes ? formatBytes(row.original.responseBytes) : '-',
            enableSorting: false,
            meta: { label: '传输', className: 'text-end tabular-nums' },
        },
        {
            meta: { label: 'Request ID' },
            accessorKey: 'requestId',
            header: ({ column }) => <DataTableColumnHeader column={column} title='Request ID'/>,
            cell: ({ row }) => <span className='font-mono text-xs'>{row.original.requestId}</span>,
            enableSorting: false,
        },
    ], []);
    return (<Modal.Backdrop isOpen={Boolean(apiKey)} onOpenChange={onOpenChange}><Modal.Container><Modal.Dialog className='sm:max-w-5xl'>
        <Modal.Header>
          <Modal.Heading>{apiKey?.name ?? ''} 使用记录</Modal.Heading>
          <p className='sr-only'>API 密钥使用记录</p>
        </Modal.Header>
        <Modal.Body>
          <ServerDataTable columns={columns} data={data?.data ?? []} page={page} pageSize={pageSize} total={data?.total ?? 0} onPageChange={setPage} onPageSizeChange={setPageSize} error={isError ? error : null} onRetry={() => void refetch()} isLoading={isLoading} emptyMessage='暂无使用记录'/>
        </Modal.Body>
      </Modal.Dialog></Modal.Container></Modal.Backdrop>);
}
const usageOperationLabels = {
    grant_create: '创建下载地址',
    download: '下载',
    message_create: '添加文章留言',
} as const;
const usageStatusLabels = {
    started: '进行中',
    succeeded: '成功',
    failed: '失败',
    aborted: '已中断',
} as const;
