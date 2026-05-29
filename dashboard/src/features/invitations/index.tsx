import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Trash2 } from 'lucide-react'
import { adminApi } from '@/lib/api'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export default function InvitationsPage() {
  const [page, setPage] = useState(1)
  const pageSize = 20
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['admin-invitations', page],
    queryFn: () => adminApi.listInvitations({ page, pageSize }),
  })

  const deleteMutation = useMutation({
    mutationFn: adminApi.deleteInvitation,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-invitations'] })
      toast.success('邀请已删除')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const totalPages = data ? Math.ceil(data.total / pageSize) : 0

  return (
    <>
      <Header>
        <h1 className='text-lg font-semibold'>邀请管理</h1>
      </Header>
      <Main>
        {isLoading ? (
          <div className='text-muted-foreground'>加载中...</div>
        ) : (
          <>
            <div className='rounded-md border'>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>类型</TableHead>
                    <TableHead>团队</TableHead>
                    <TableHead>创建者</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>过期时间</TableHead>
                    <TableHead>操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data?.data.map((inv) => (
                    <TableRow key={inv.id}>
                      <TableCell>{inv.type}</TableCell>
                      <TableCell>{inv.team?.name ?? '-'}</TableCell>
                      <TableCell>
                        {inv.createdByAdmin?.email ?? inv.createdByUser?.email ?? '-'}
                      </TableCell>
                      <TableCell>
                        {inv.usedAt ? (
                          <Badge variant='default'>已使用</Badge>
                        ) : new Date(inv.expiresAt) < new Date() ? (
                          <Badge variant='secondary'>已过期</Badge>
                        ) : (
                          <Badge variant='outline'>有效</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {new Date(inv.expiresAt).toLocaleString('zh-CN')}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant='ghost'
                          size='icon'
                          onClick={() => deleteMutation.mutate(inv.id)}
                        >
                          <Trash2 className='h-4 w-4' />
                        </Button>
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
