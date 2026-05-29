import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { toast } from 'sonner'
import { adminApi } from '@/lib/api'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export default function AuditLogsPage() {
  const [page, setPage] = useState(1)
  const [action, setAction] = useState('')
  const pageSize = 20

  const { data, isLoading } = useQuery({
    queryKey: ['admin-audit-logs', page, action],
    queryFn: () => adminApi.listAuditLogs({ page, pageSize, action: action || undefined }),
  })

  async function handleExport() {
    try {
      await adminApi.exportAuditLogs({ action: action || undefined })
      toast.success('导出成功')
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '导出失败')
    }
  }

  const totalPages = data ? Math.ceil(data.total / pageSize) : 0

  return (
    <>
      <Header>
        <h1 className='text-lg font-semibold'>审计日志</h1>
      </Header>
      <Main>
        <div className='flex items-center gap-2 pb-4'>
          <Input
            placeholder='按操作类型筛选...'
            value={action}
            onChange={(e) => { setAction(e.target.value); setPage(1) }}
            className='max-w-xs'
          />
          <Button variant='outline' size='sm' onClick={handleExport}>
            <Download className='mr-1 h-4 w-4' />
            导出
          </Button>
        </div>
        {isLoading ? (
          <div className='text-muted-foreground'>加载中...</div>
        ) : (
          <>
            <div className='rounded-md border'>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>操作</TableHead>
                    <TableHead>管理员</TableHead>
                    <TableHead>目标</TableHead>
                    <TableHead>IP</TableHead>
                    <TableHead>时间</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data?.data.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className='font-medium'>{log.action}</TableCell>
                      <TableCell>{log.adminEmail}</TableCell>
                      <TableCell>{log.targetType}:{log.targetId}</TableCell>
                      <TableCell>{log.ipAddress}</TableCell>
                      <TableCell>
                        {new Date(log.createdAt).toLocaleString('zh-CN')}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {totalPages > 1 && (
              <div className='flex items-center justify-end gap-2 pt-4'>
                <Button variant='outline' size='sm' disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>上一页</Button>
                <span className='text-sm text-muted-foreground'>{page} / {totalPages}</span>
                <Button variant='outline' size='sm' disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>下一页</Button>
              </div>
            )}
          </>
        )}
      </Main>
    </>
  )
}
