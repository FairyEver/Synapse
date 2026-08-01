import { useEffect, useMemo, useState } from 'react'
import { type ColumnDef, type SortingState } from '@tanstack/react-table'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { dashboardApi, type DashboardDeviceRow } from '@/lib/api'
import {
  deviceStatusLabels,
  deviceStatusVariants,
  sortDevicesByTableSorting,
  upsertDeviceLiveEvent,
} from '@/lib/device-utils'
import {
  DataTableColumnHeader,
  DEFAULT_DASHBOARD_PAGE_SIZE,
  ServerDataTable,
  getServerTableSortQuery,
} from '@/components/data-table'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { RelativeTime } from '@/components/relative-time'
import { Badge } from '@/components/ui/badge'
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
import { useAuthStore } from '@/stores/auth-store'

const maxDeviceNameLength = 120

export default function MyDevicesPage() {
  const queryClient = useQueryClient()
  const authUser = useAuthStore((state) => state.auth.user)
  const sessionId = authUser?.sessionId ?? 'anonymous'
  const [devices, setDevices] = useState<DashboardDeviceRow[]>([])
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_DASHBOARD_PAGE_SIZE)
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'lastSeenAt', desc: true },
  ])
  const [editingDevice, setEditingDevice] = useState<DashboardDeviceRow | null>(null)
  const [displayName, setDisplayName] = useState('')
  const sortQuery = getServerTableSortQuery(sorting)

  const { data, error, isError, isLoading, refetch } = useQuery({
    queryKey: ['dashboard-devices', sessionId, page, pageSize, sortQuery],
    queryFn: () => dashboardApi.listDevices({ page, pageSize, ...sortQuery }),
  })

  useEffect(() => {
    setDevices([])
    setPage(1)
  }, [sessionId])

  useEffect(() => {
    if (data?.data) {
      setDevices(data.data)
    }
  }, [data])

  useEffect(() => {
    return dashboardApi.subscribeLiveClients(
      (event) => {
        setDevices((current) =>
          sortDevicesByTableSorting(
            upsertDeviceLiveEvent(current, event, { scope: 'user' }),
            sorting
          )
        )
      },
      () => {
        void queryClient.invalidateQueries({ queryKey: ['dashboard-devices'] })
      }
    )
  }, [queryClient, sorting])

  const renameDevice = useMutation({
    mutationFn: (input: { clientInstanceId: string; displayName: string }) =>
      dashboardApi.renameDevice(input.clientInstanceId, {
        displayName: input.displayName,
      }),
    onSuccess: (renamed) => {
      setDevices((current) =>
        current.map((device) =>
          device.clientInstanceId === renamed.clientInstanceId ? renamed : device
        )
      )
      setEditingDevice(null)
      toast.success('设备名称已更新')
      void queryClient.invalidateQueries({ queryKey: ['dashboard-devices'] })
    },
    onError: (mutationError: Error) => toast.error(mutationError.message),
  })

  function openRenameDialog(device: DashboardDeviceRow) {
    setEditingDevice(device)
    setDisplayName(device.displayName ?? device.deviceName)
  }

  function closeRenameDialog() {
    if (renameDevice.isPending) return
    setEditingDevice(null)
  }

  function handleRenameSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const nextDisplayName = displayName.trim()
    if (!editingDevice || nextDisplayName.length === 0) return
    renameDevice.mutate({
      clientInstanceId: editingDevice.clientInstanceId,
      displayName: nextDisplayName,
    })
  }

  const columns = useMemo<ColumnDef<DashboardDeviceRow>[]>(
    () => [
      {
        accessorKey: 'deviceName',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title='设备' />
        ),
        cell: ({ row }) => <DeviceName device={row.original} />,
      },
      {
        accessorKey: 'status',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title='状态' />
        ),
        cell: ({ row }) => (
          <Badge variant={deviceStatusVariants[row.original.status]}>
            {deviceStatusLabels[row.original.status]}
          </Badge>
        ),
      },
      {
        accessorKey: 'platform',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title='平台' />
        ),
      },
      {
        accessorKey: 'appVersion',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title='版本' />
        ),
      },
      {
        accessorKey: 'lastSeenAt',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title='最近在线' />
        ),
        cell: ({ row }) => <RelativeTime value={row.original.lastSeenAt} />,
      },
      {
        accessorKey: 'firstSeenAt',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title='首次连接' />
        ),
        cell: ({ row }) => <RelativeTime value={row.original.firstSeenAt} />,
      },
      {
        id: 'actions',
        cell: ({ row }) => (
          <div className='flex justify-end'>
            <Button
              variant='ghost'
              className='h-8 px-2'
              onClick={() => openRenameDialog(row.original)}
            >
              重命名
            </Button>
          </div>
        ),
        meta: {
          thClassName: 'text-right',
          tdClassName: 'text-right',
        },
        enableSorting: false,
        enableHiding: false,
      },
    ],
    []
  )
  const trimmedDisplayName = displayName.trim()
  const isRenameInvalid =
    trimmedDisplayName.length === 0 ||
    trimmedDisplayName.length > maxDeviceNameLength

  return (
    <>
      <Header fixed>
        <h1 className='text-lg font-semibold'>我的设备</h1>
      </Header>
      <Main>
        {isLoading ? (
          <div className='text-muted-foreground'>加载中...</div>
        ) : (
          <ServerDataTable
            columns={columns}
            data={devices}
            page={page}
            pageSize={pageSize}
            total={data?.total ?? 0}
            error={isError ? error : null}
            onRetry={() => void refetch()}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            sorting={sorting}
            onSortingChange={setSorting}
          />
        )}
        <Dialog open={Boolean(editingDevice)} onOpenChange={closeRenameDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>重命名设备</DialogTitle>
            </DialogHeader>
            <form className='space-y-4' onSubmit={handleRenameSubmit}>
              <div className='space-y-2'>
                <Label htmlFor='device-display-name'>名称</Label>
                <Input
                  id='device-display-name'
                  value={displayName}
                  maxLength={maxDeviceNameLength}
                  onChange={(event) => setDisplayName(event.target.value)}
                />
              </div>
              <DialogFooter>
                <Button
                  type='button'
                  variant='outline'
                  onClick={closeRenameDialog}
                  disabled={renameDevice.isPending}
                >
                  取消
                </Button>
                <Button
                  type='submit'
                  disabled={isRenameInvalid || renameDevice.isPending}
                >
                  保存
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </Main>
    </>
  )
}

function DeviceName({ device }: { device: DashboardDeviceRow }) {
  const displayName = device.displayName?.trim()
  return (
    <div className='min-w-0'>
      <div className='truncate font-medium'>{displayName || device.deviceName}</div>
      {displayName ? (
        <div className='truncate text-sm text-muted-foreground'>
          {device.deviceName}
        </div>
      ) : null}
    </div>
  )
}
