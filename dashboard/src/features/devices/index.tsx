import { useEffect, useMemo, useRef, useState } from 'react'
import { type ColumnDef, type SortingState } from '@tanstack/react-table'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { adminApi, type DashboardDeviceRow } from '@/lib/api'
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

export default function DevicesPage() {
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_DASHBOARD_PAGE_SIZE)
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'lastSeenAt', desc: true },
  ])
  const [devices, setDevices] = useState<DashboardDeviceRow[]>([])
  const devicesRef = useRef<DashboardDeviceRow[]>([])
  const sortQuery = getServerTableSortQuery(sorting)

  const { data, error, isError, isLoading, refetch } = useQuery({
    queryKey: ['admin-devices', page, pageSize, sortQuery],
    queryFn: () => adminApi.listDevices({ page, pageSize, ...sortQuery }),
  })

  useEffect(() => {
    if (data?.data) {
      setDevices(data.data)
      devicesRef.current = data.data
    }
  }, [data])

  useEffect(() => {
    return adminApi.subscribeLiveClients(
      (event) => {
        if (!event.client.userId) return
        const nextDevices = upsertDeviceLiveEvent(devicesRef.current, event, {
          scope: 'admin',
          insertMissing: false,
        })
        if (nextDevices === devicesRef.current) {
          void queryClient.invalidateQueries({ queryKey: ['admin-devices'] })
          return
        }
        const sortedDevices = sortDevicesByTableSorting(nextDevices, sorting)
        devicesRef.current = sortedDevices
        setDevices(sortedDevices)
      },
      () => {
        void queryClient.invalidateQueries({ queryKey: ['admin-devices'] })
      }
    )
  }, [queryClient, sorting])

  const columns = useMemo<ColumnDef<DashboardDeviceRow>[]>(
    () => [
      {
        id: 'user',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title='用户' />
        ),
        cell: ({ row }) => (
          <div className='min-w-0'>
            <div className='truncate font-medium'>
              {row.original.userDisplayName || row.original.userEmail || '-'}
            </div>
            {row.original.userDisplayName ? (
              <div className='truncate text-sm text-muted-foreground'>
                {row.original.userEmail}
              </div>
            ) : null}
          </div>
        ),
        enableSorting: false,
      },
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
        enableSorting: false,
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
    ],
    []
  )

  return (
    <>
      <Header fixed>
        <h1 className='text-lg font-semibold'>设备</h1>
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
      </Main>
    </>
  )
}

function DeviceName({ device }: { device: DashboardDeviceRow }) {
  return (
    <div className='min-w-0'>
      <div className='truncate font-medium'>{device.deviceName}</div>
      {device.displayName ? (
        <div className='truncate text-sm text-muted-foreground'>
          {device.displayName}
        </div>
      ) : null}
    </div>
  )
}
