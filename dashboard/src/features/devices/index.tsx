import { Chip } from '@heroui/react'
import { useEffect, useMemo, useState } from 'react'
import { type ColumnDef, type SortingState } from '@tanstack/react-table'
import { useQuery } from '@tanstack/react-query'
import { adminApi, type DashboardDeviceRow } from '@/lib/api'
import { deviceStatusLabels, deviceStatusVariants } from '@/lib/device-utils'
import {
  DataTableColumnHeader,
  DEFAULT_DASHBOARD_PAGE_SIZE,
  ServerDataTable,
  getServerTableSortQuery,
} from '@/components/data-table'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { RelativeTime } from '@/components/relative-time'

export default function DevicesPage() {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_DASHBOARD_PAGE_SIZE)
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'lastSeenAt', desc: true },
  ])
  const [devices, setDevices] = useState<DashboardDeviceRow[]>([])
  const sortQuery = getServerTableSortQuery(sorting)

  const { data, error, isError, isLoading, refetch } = useQuery({
    queryKey: ['admin-devices', page, pageSize, sortQuery],
    queryFn: () => adminApi.listDevices({ page, pageSize, ...sortQuery }),
  })

  useEffect(() => {
    if (data?.data) {
      setDevices(data.data)
    }
  }, [data])

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
              {row.original.userHandle || row.original.userEmail || '-'}
            </div>
            {row.original.userHandle ? (
              <div className='truncate text-sm text-muted'>
                {row.original.userEmail}
              </div>
            ) : null}
          </div>
        ),
        enableSorting: false,
        meta: { label: '用户', className: 'w-64 max-w-64' },
      },
      {
        accessorKey: 'deviceName',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title='设备' />
        ),
        cell: ({ row }) => <DeviceName device={row.original} />,
        meta: { label: '设备', className: 'w-40 max-w-40' },
      },
      {
        accessorKey: 'status',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title='状态' />
        ),
        cell: ({ row }) => (
          <Chip color={deviceStatusVariants[row.original.status]}>
            {deviceStatusLabels[row.original.status]}
          </Chip>
        ),
        enableSorting: false,
        meta: { label: '状态', className: 'w-20' },
      },
      {
        accessorKey: 'platform',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title='平台' />
        ),
        meta: { label: '平台', className: 'w-28' },
      },
      {
        accessorKey: 'appVersion',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title='版本' />
        ),
        meta: { label: '版本', className: 'w-24' },
      },
      {
        accessorKey: 'lastSeenAt',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title='最近在线' />
        ),
        cell: ({ row }) => (
          <RelativeTime className='tabular-nums' value={row.original.lastSeenAt} />
        ),
        meta: { label: '最近在线', className: 'w-32' },
      },
      {
        accessorKey: 'firstSeenAt',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title='首次连接' />
        ),
        cell: ({ row }) => (
          <RelativeTime className='tabular-nums' value={row.original.firstSeenAt} />
        ),
        meta: { label: '首次连接', className: 'w-32' },
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
        <ServerDataTable
          columns={columns}
          data={devices}
          page={page}
          pageSize={pageSize}
          total={data?.total ?? 0}
          error={isError ? error : null}
          isLoading={isLoading}
          loadingRowCount={Math.min(pageSize, DEFAULT_DASHBOARD_PAGE_SIZE)}
          onRetry={() => void refetch()}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          sorting={sorting}
          onSortingChange={setSorting}
        />
      </Main>
    </>
  )
}

function DeviceName({ device }: { device: DashboardDeviceRow }) {
  return (
    <div className='min-w-0'>
      <div className='truncate font-medium'>{device.deviceName}</div>
      {device.displayName ? (
        <div className='truncate text-sm text-muted'>
          {device.displayName}
        </div>
      ) : null}
    </div>
  )
}
