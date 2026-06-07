import { useEffect, useMemo, useState } from 'react'
import { type ColumnDef, type SortingState } from '@tanstack/react-table'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { dashboardApi, type DashboardDeviceRow } from '@/lib/api'
import {
  deviceStatusLabels,
  deviceStatusVariants,
  mergeDeviceSnapshot,
  upsertDeviceLiveEvent,
} from '@/lib/device-utils'
import {
  DataTableColumnHeader,
  ServerDataTable,
} from '@/components/data-table'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuthStore } from '@/stores/auth-store'

const initialPageSize = 20
const maxDeviceNameLength = 120

export default function MyDevicesPage() {
  const queryClient = useQueryClient()
  const authUser = useAuthStore((state) => state.auth.user)
  const sessionId = authUser?.role === 'user' ? authUser.sessionId : 'anonymous'
  const [devices, setDevices] = useState<DashboardDeviceRow[]>([])
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(initialPageSize)
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'lastSeenAt', desc: true },
  ])
  const [editingDevice, setEditingDevice] = useState<DashboardDeviceRow | null>(null)
  const [displayName, setDisplayName] = useState('')
  const sortQuery = sorting[0]

  const { data, error, isError, isLoading, refetch } = useQuery({
    queryKey: ['dashboard-devices', sessionId],
    queryFn: dashboardApi.listDevices,
  })

  useEffect(() => {
    setDevices([])
    setPage(1)
  }, [sessionId])

  useEffect(() => {
    if (data) {
      setDevices((current) =>
        mergeDeviceSnapshot(current, data, { scope: 'user' })
      )
    }
  }, [data])

  useEffect(() => {
    return dashboardApi.subscribeLiveClients(
      (event) => {
        setDevices((current) =>
          upsertDeviceLiveEvent(current, event, { scope: 'user' })
        )
      },
      () => {
        void queryClient.invalidateQueries({ queryKey: ['dashboard-devices'] })
      }
    )
  }, [queryClient])

  const sortedDevices = useMemo(
    () => sortDevices(devices, sortQuery),
    [devices, sortQuery]
  )
  const pagedDevices = useMemo(() => {
    const start = (page - 1) * pageSize
    return sortedDevices.slice(start, start + pageSize)
  }, [page, pageSize, sortedDevices])

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
        id: 'displayName',
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
        cell: ({ row }) => formatOptionalDateTime(row.original.lastSeenAt),
      },
      {
        accessorKey: 'firstSeenAt',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title='首次连接' />
        ),
        cell: ({ row }) => formatOptionalDateTime(row.original.firstSeenAt),
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
      <Header>
        <h1 className='text-lg font-semibold'>我的设备</h1>
      </Header>
      <Main>
        {isLoading ? (
          <div className='text-muted-foreground'>加载中...</div>
        ) : (
          <ServerDataTable
            columns={columns}
            data={pagedDevices}
            page={page}
            pageSize={pageSize}
            total={sortedDevices.length}
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

function sortDevices(
  devices: readonly DashboardDeviceRow[],
  sort: SortingState[number] | undefined
) {
  if (!sort) return [...devices]
  return [...devices].sort((left, right) => {
    const result = compareDeviceValue(left, right, sort.id)
    return sort.desc ? -result : result
  })
}

function compareDeviceValue(
  left: DashboardDeviceRow,
  right: DashboardDeviceRow,
  key: string
) {
  if (key === 'lastSeenAt' || key === 'firstSeenAt') {
    return parseTime(left[key]) - parseTime(right[key])
  }
  return getComparableValue(left, key).localeCompare(getComparableValue(right, key))
}

function getComparableValue(device: DashboardDeviceRow, key: string) {
  if (key === 'displayName') return device.displayName ?? device.deviceName
  const value = device[key as keyof DashboardDeviceRow]
  return typeof value === 'string' ? value : ''
}

function parseTime(value: string | null | undefined) {
  if (!value) return 0
  const time = Date.parse(value)
  return Number.isNaN(time) ? 0 : time
}

function formatOptionalDateTime(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString('zh-CN') : '-'
}
