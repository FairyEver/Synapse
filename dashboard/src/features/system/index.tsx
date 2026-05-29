import { useQuery } from '@tanstack/react-query'
import { Activity, Users, Shield, Mail, FileText } from 'lucide-react'
import { adminApi } from '@/lib/api'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function SystemPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['system-overview'],
    queryFn: adminApi.getSystemOverview,
  })

  const stats = [
    { title: '用户数', value: data?.counts.users ?? '-', icon: Users },
    { title: '团队数', value: data?.counts.teams ?? '-', icon: Shield },
    { title: '邀请数', value: data?.counts.invitations ?? '-', icon: Mail },
    { title: '审计日志', value: data?.counts.auditLogs ?? '-', icon: FileText },
    { title: '权限记录', value: data?.counts.userModulePermissions ?? '-', icon: Activity },
  ]

  return (
    <>
      <Header>
        <h1 className='text-lg font-semibold'>系统概览</h1>
      </Header>
      <Main>
        {isLoading ? (
          <div className='text-muted-foreground'>加载中...</div>
        ) : (
          <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3'>
            {stats.map((stat) => (
              <Card key={stat.title}>
                <CardHeader className='flex flex-row items-center justify-between pb-2'>
                  <CardTitle className='text-sm font-medium'>{stat.title}</CardTitle>
                  <stat.icon className='h-4 w-4 text-muted-foreground' />
                </CardHeader>
                <CardContent>
                  <div className='text-2xl font-bold'>{stat.value}</div>
                </CardContent>
              </Card>
            ))}
            {data?.serverTime && (
              <Card>
                <CardHeader className='pb-2'>
                  <CardTitle className='text-sm font-medium'>服务器时间</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className='text-sm text-muted-foreground'>
                    {new Date(data.serverTime).toLocaleString('zh-CN')}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </Main>
    </>
  )
}
