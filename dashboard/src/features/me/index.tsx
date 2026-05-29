import { useQuery } from '@tanstack/react-query'
import { dashboardApi } from '@/lib/api'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

export default function MePage() {
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard-me'],
    queryFn: dashboardApi.getMe,
  })

  return (
    <>
      <Header>
        <h1 className='text-lg font-semibold'>个人中心</h1>
      </Header>
      <Main>
        {isLoading ? (
          <div className='text-muted-foreground'>加载中...</div>
        ) : data ? (
          <div className='grid gap-4 max-w-lg'>
            <Card>
              <CardHeader>
                <CardTitle className='text-base'>账户信息</CardTitle>
              </CardHeader>
              <CardContent className='space-y-2'>
                <div className='flex justify-between'>
                  <span className='text-muted-foreground'>邮箱</span>
                  <span>{data.user.email}</span>
                </div>
                <div className='flex justify-between'>
                  <span className='text-muted-foreground'>状态</span>
                  <Badge variant={data.user.status === 'active' ? 'default' : 'secondary'}>
                    {data.user.status === 'active' ? '正常' : '禁用'}
                  </Badge>
                </div>
              </CardContent>
            </Card>
            {data.teams.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className='text-base'>我的团队</CardTitle>
                </CardHeader>
                <CardContent className='space-y-2'>
                  {data.teams.map((team) => (
                    <div key={team.id} className='flex justify-between'>
                      <span>{team.name}</span>
                      <Badge variant='outline'>{team.membershipRole}</Badge>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>
        ) : null}
      </Main>
    </>
  )
}
