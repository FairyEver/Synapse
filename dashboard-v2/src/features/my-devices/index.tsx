import { TextField } from '@heroui/react';
import { Button, Chip, Input, Label, Modal, toast } from '@heroui/react';
import { useEffect, useMemo, useState } from 'react';
import { type ColumnDef, type SortingState } from '@tanstack/react-table';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { dashboardApi, type DashboardDeviceRow } from '@/lib/api';
import { deviceStatusLabels, deviceStatusVariants, sortDevicesByTableSorting, upsertDeviceLiveEvent, } from '@/lib/device-utils';
import { DataTableColumnHeader, DEFAULT_DASHBOARD_PAGE_SIZE, ServerDataTable, getServerTableSortQuery, } from '@/components/data-table';
import { Header } from '@/components/layout/header';
import { Main } from '@/components/layout/main';
import { RelativeTime } from '@/components/relative-time';
import { useAuthStore } from '@/stores/auth-store';
const maxDeviceNameLength = 120;
export default function MyDevicesPage() {
    const queryClient = useQueryClient();
    const authUser = useAuthStore((state) => state.auth.user);
    const sessionId = authUser?.sessionId ?? 'anonymous';
    const [devices, setDevices] = useState<DashboardDeviceRow[]>([]);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(DEFAULT_DASHBOARD_PAGE_SIZE);
    const [sorting, setSorting] = useState<SortingState>([
        { id: 'lastSeenAt', desc: true },
    ]);
    const [editingDevice, setEditingDevice] = useState<DashboardDeviceRow | null>(null);
    const [displayName, setDisplayName] = useState('');
    const sortQuery = getServerTableSortQuery(sorting);
    const { data, error, isError, isLoading, refetch } = useQuery({
        queryKey: ['dashboard-devices', sessionId, page, pageSize, sortQuery],
        queryFn: () => dashboardApi.listDevices({ page, pageSize, ...sortQuery }),
    });
    useEffect(() => {
        setDevices([]);
        setPage(1);
    }, [sessionId]);
    useEffect(() => {
        if (data?.data) {
            setDevices(data.data);
        }
    }, [data]);
    useEffect(() => {
        return dashboardApi.subscribeLiveClients((event) => {
            setDevices((current) => sortDevicesByTableSorting(upsertDeviceLiveEvent(current, event, { scope: 'user' }), sorting));
        }, () => {
            void queryClient.invalidateQueries({ queryKey: ['dashboard-devices'] });
        });
    }, [queryClient, sorting]);
    const renameDevice = useMutation({
        mutationFn: (input: {
            clientInstanceId: string;
            displayName: string;
        }) => dashboardApi.renameDevice(input.clientInstanceId, {
            displayName: input.displayName,
        }),
        onSuccess: (renamed) => {
            setDevices((current) => current.map((device) => device.clientInstanceId === renamed.clientInstanceId ? renamed : device));
            setEditingDevice(null);
            toast.success('设备名称已更新');
            void queryClient.invalidateQueries({ queryKey: ['dashboard-devices'] });
        },
        onError: (mutationError: Error) => toast.danger(mutationError.message),
    });
    function openRenameDialog(device: DashboardDeviceRow) {
        setEditingDevice(device);
        setDisplayName(device.displayName ?? device.deviceName);
    }
    function closeRenameDialog() {
        if (renameDevice.isPending)
            return;
        setEditingDevice(null);
    }
    function handleRenameSubmit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const nextDisplayName = displayName.trim();
        if (!editingDevice || nextDisplayName.length === 0)
            return;
        renameDevice.mutate({
            clientInstanceId: editingDevice.clientInstanceId,
            displayName: nextDisplayName,
        });
    }
    const columns = useMemo<ColumnDef<DashboardDeviceRow>[]>(() => [
        {
            meta: { label: '设备' },
            accessorKey: 'deviceName',
            header: ({ column }) => (<DataTableColumnHeader column={column} title='设备'/>),
            cell: ({ row }) => <DeviceName device={row.original}/>,
        },
        {
            meta: { label: '状态' },
            accessorKey: 'status',
            header: ({ column }) => (<DataTableColumnHeader column={column} title='状态'/>),
            cell: ({ row }) => (<Chip color={deviceStatusVariants[row.original.status]}>
            {deviceStatusLabels[row.original.status]}
          </Chip>),
        },
        {
            meta: { label: '平台' },
            accessorKey: 'platform',
            header: ({ column }) => (<DataTableColumnHeader column={column} title='平台'/>),
        },
        {
            meta: { label: '版本' },
            accessorKey: 'appVersion',
            header: ({ column }) => (<DataTableColumnHeader column={column} title='版本'/>),
        },
        {
            meta: { label: '最近在线' },
            accessorKey: 'lastSeenAt',
            header: ({ column }) => (<DataTableColumnHeader column={column} title='最近在线'/>),
            cell: ({ row }) => <RelativeTime value={row.original.lastSeenAt}/>,
        },
        {
            meta: { label: '首次连接' },
            accessorKey: 'firstSeenAt',
            header: ({ column }) => (<DataTableColumnHeader column={column} title='首次连接'/>),
            cell: ({ row }) => <RelativeTime value={row.original.firstSeenAt}/>,
        },
        {
            id: 'actions',
            cell: ({ row }) => (<div className='flex justify-end'>
            <Button variant="ghost" className='h-8 px-2' onPress={() => openRenameDialog(row.original)}>
              重命名
            </Button>
          </div>),
            meta: {
                thClassName: 'text-right',
                tdClassName: 'text-right',
            },
            enableSorting: false,
            enableHiding: false,
        },
    ], []);
    const trimmedDisplayName = displayName.trim();
    const isRenameInvalid = trimmedDisplayName.length === 0 ||
        trimmedDisplayName.length > maxDeviceNameLength;
    return (<>
      <Header fixed>
        <h1 className='text-lg font-semibold'>我的设备</h1>
      </Header>
      <Main>
        {isLoading ? (<div className='text-muted'>加载中...</div>) : (<ServerDataTable columns={columns} data={devices} page={page} pageSize={pageSize} total={data?.total ?? 0} error={isError ? error : null} onRetry={() => void refetch()} onPageChange={setPage} onPageSizeChange={setPageSize} sorting={sorting} onSortingChange={setSorting}/>)}
        <Modal.Backdrop isOpen={Boolean(editingDevice)} onOpenChange={closeRenameDialog}><Modal.Container><Modal.Dialog>
            <form className='flex min-h-0 flex-1 flex-col' onSubmit={handleRenameSubmit}>
              <Modal.Header>
                <Modal.Heading>重命名设备</Modal.Heading>
              </Modal.Header>
              <Modal.Body className='space-y-4'>
                <TextField className='space-y-2'>
                  <Label htmlFor='device-display-name'>名称</Label>
                  <Input variant="secondary" id='device-display-name' value={displayName} maxLength={maxDeviceNameLength} onChange={(event) => setDisplayName(event.target.value)}></Input>
                </TextField>
              </Modal.Body>
              <Modal.Footer>
                <Button type='button' variant="outline" onPress={closeRenameDialog} isDisabled={renameDevice.isPending}>
                  取消
                </Button>
                <Button type='submit' isDisabled={isRenameInvalid || renameDevice.isPending}>
                  保存
                </Button>
              </Modal.Footer>
            </form>
          </Modal.Dialog></Modal.Container></Modal.Backdrop>
      </Main>
    </>);
}
function DeviceName({ device }: {
    device: DashboardDeviceRow;
}) {
    const displayName = device.displayName?.trim();
    return (<div className='min-w-0'>
      <div className='truncate font-medium'>{displayName || device.deviceName}</div>
      {displayName ? (<div className='truncate text-sm text-muted'>
          {device.deviceName}
        </div>) : null}
    </div>);
}
