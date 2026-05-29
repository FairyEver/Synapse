import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
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

export default function TeamsPage() {
  const [page, setPage] = useState(1)
  const pageSize = 20

  const { data, isLoading } = useQuery({
    queryKey: ['admin-teams', page],
    queryFn: () => adminApi.listTeams({ page, pageSize }),
  })

  const totalPages = data ? Math.ceil(data.total / pageSize) : 0

  return (
    <>
      <Header>
        <h1 className='text-lg font-semibold'>团队管理</h1>
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
                    <TableHead>团队名称</TableHead>
                    <TableHead>创建者</TableHead>
                    <TableHead>成员数</TableHead>
                    <TableHead>创建时间</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data?.data.map((team) => (
                    <TableRow key={team.id}>
                      <TableCell className='font-medium'>{team.name}</TableCell>
                      <TableCell>{team.createdByUser.email}</TableCell>
                      <TableCell>
                        <Badge variant='secondary'>{team.memberships.length}</Badge>
                      </TableCell>
                      <TableCell>
                        {new Date(team.createdAt).toLocaleDateString('zh-CN')}
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
