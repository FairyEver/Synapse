import { useQuery } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import {
  adminApi,
  type AdminDriveStorageBucket,
  type AdminDriveStorageSummary as AdminDriveStorageSummaryDto,
} from '@/lib/api'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatDriveBytes } from '@/features/drive'

type StorageRow = {
  label: string
  bucket: 'normalDrive' | 'publicAssets'
}

type StorageTotalRow = {
  label: string
  value: (total: AdminDriveStorageSummaryDto['total']) => string
}

const storageRows: StorageRow[] = [
  { label: '普通文件', bucket: 'normalDrive' },
  { label: '公开素材', bucket: 'publicAssets' },
]

const storageTotalRows: StorageTotalRow[] = [
  { label: '配额计入', value: (total) => formatDriveBytes(total.quotaBytes) },
  { label: '后台留存', value: (total) => formatDriveBytes(total.adminVisibleBytes) },
]

export function AdminDriveStorageSummary() {
  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ['admin-drive-storage-summary'],
    queryFn: () => adminApi.getDriveStorageSummary(),
  })

  return (
    <section className='flex flex-col gap-3'>
      <div className='flex items-center justify-between gap-3'>
        <h2 className='text-base font-semibold'>存储</h2>
        <Button
          type='button'
          variant='outline'
          size='sm'
          onClick={() => void refetch()}
          disabled={isLoading}
        >
          <RefreshCw className={isLoading ? 'animate-spin' : undefined} />
          刷新
        </Button>
      </div>
      <div className='overflow-hidden rounded-md border'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>类型</TableHead>
              <TableHead className='text-right'>正常</TableHead>
              <TableHead className='text-right'>回收站</TableHead>
              <TableHead className='text-right'>隐藏</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {storageRows.map((row) => (
              <TableRow key={row.bucket}>
                <TableCell className='font-medium'>{row.label}</TableCell>
                <StorageBucketCell bucket={data?.[row.bucket]} status='active' />
                <StorageBucketCell bucket={data?.[row.bucket]} status='trashed' />
                <StorageBucketCell bucket={data?.[row.bucket]} status='hidden' />
              </TableRow>
            ))}
            <TableRow>
              <TableCell className='font-medium'>历史版本</TableCell>
              <TableCell className='text-right tabular-nums'>
                {data ? formatStorageValue(data.publicAssetRevisions.count, data.publicAssetRevisions.bytes) : '-'}
              </TableCell>
              <TableCell className='text-right text-muted-foreground'>-</TableCell>
              <TableCell className='text-right text-muted-foreground'>-</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
      <div className='overflow-hidden rounded-md border'>
        <Table aria-label='存储汇总'>
          <TableBody>
            {storageTotalRows.map((row) => (
              <TableRow key={row.label}>
                <TableCell className='font-medium'>{row.label}</TableCell>
                <TableCell className='text-right tabular-nums'>
                  {data ? row.value(data.total) : '-'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {error instanceof Error ? (
        <div className='text-sm text-destructive'>{error.message}</div>
      ) : null}
    </section>
  )
}

function StorageBucketCell({
  bucket,
  status,
}: {
  readonly bucket?: AdminDriveStorageBucket
  readonly status: keyof AdminDriveStorageBucket
}) {
  const value = bucket?.[status]
  return (
    <TableCell className='text-right tabular-nums'>
      {value ? formatStorageValue(value.count, value.bytes) : '-'}
    </TableCell>
  )
}

function formatStorageValue(count: number, bytes: string) {
  return `${count} / ${formatDriveBytes(bytes)}`
}
