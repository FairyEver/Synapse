import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Clock,
  FileText,
  Users,
  type LucideIcon,
} from 'lucide-react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts'
import { adminApi, type SystemOverview } from '@/lib/api'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { getSystemOverviewErrorMessage } from './system-error'

type StatCard = {
  title: string
  value: number | string
  detail: string
  icon: LucideIcon
}

export default function SystemPage() {
  const { data, error, isError, isLoading, refetch } = useQuery({
    queryKey: ['system-overview'],
    queryFn: adminApi.getSystemOverview,
  })

  const stats = useMemo(() => buildStats(data), [data])

  return (
    <>
      <Header fixed>
        <h1 className='text-lg font-semibold'>系统概览</h1>
      </Header>
      <Main>
        <div className='mb-4 flex flex-col gap-1'>
          <h2 className='text-2xl font-bold tracking-tight'>系统</h2>
          <p className='text-sm text-muted-foreground'>
            {data?.serverTime
              ? `更新于 ${formatDateTime(data.serverTime)}`
              : '系统数据'}
          </p>
        </div>

        {isLoading ? (
          <SystemSkeleton />
        ) : isError ? (
          <SystemErrorState error={error} onRetry={() => void refetch()} />
        ) : (
          <SystemDashboard data={data} stats={stats} />
        )}
      </Main>
    </>
  )
}

function SystemErrorState({
  error,
  onRetry,
}: {
  error: unknown
  onRetry: () => void
}) {
  return (
    <Card>
      <CardContent className='flex flex-col items-start gap-3 py-6'>
        <div className='space-y-1'>
          <div className='font-medium'>加载失败</div>
          <p className='text-sm text-muted-foreground'>
            {getSystemOverviewErrorMessage(error)}
          </p>
        </div>
        <Button variant='outline' size='sm' onClick={onRetry}>
          重试
        </Button>
      </CardContent>
    </Card>
  )
}

function SystemDashboard({
  data,
  stats,
}: {
  data: SystemOverview | undefined
  stats: StatCard[]
}) {
  if (!data) {
    return (
      <Card>
        <CardContent className='py-6 text-sm text-muted-foreground'>
          暂无数据
        </CardContent>
      </Card>
    )
  }

  return (
    <Tabs
      orientation='vertical'
      defaultValue='overview'
      className='flex flex-col gap-4'
    >
      <div className='w-full overflow-x-auto pb-1'>
        <TabsList>
          <TabsTrigger value='overview'>概览</TabsTrigger>
          <TabsTrigger value='activity'>活动</TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value='overview' className='flex flex-col gap-4'>
        <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3'>
          {stats.map((stat) => (
            <SystemStatCard key={stat.title} stat={stat} />
          ))}
        </div>

        <div className='grid grid-cols-1 gap-4 lg:grid-cols-7'>
          <Card className='lg:col-span-4'>
            <CardHeader>
              <CardTitle>增长趋势</CardTitle>
              <CardDescription>最近 7 天</CardDescription>
            </CardHeader>
            <CardContent className='ps-2'>
              <GrowthChart data={data.dailyTrend} />
            </CardContent>
          </Card>

          <Card className='lg:col-span-3'>
            <CardHeader>
              <CardTitle>账号状态</CardTitle>
              <CardDescription>当前用户</CardDescription>
            </CardHeader>
            <CardContent>
              <StatusDistribution
                items={[
                  { label: '启用', value: data.userStatus.active },
                  { label: '禁用', value: data.userStatus.disabled },
                ]}
              />
            </CardContent>
          </Card>
        </div>
      </TabsContent>

      <TabsContent value='activity'>
        <Card>
          <CardHeader>
            <CardTitle>管理操作</CardTitle>
            <CardDescription>最近 7 天</CardDescription>
          </CardHeader>
          <CardContent className='ps-2'>
            <AuditChart data={data.dailyTrend} />
          </CardContent>
        </Card>

      </TabsContent>
    </Tabs>
  )
}

function SystemStatCard({ stat }: { stat: StatCard }) {
  const Icon = stat.icon

  return (
    <Card>
      <CardHeader className='flex flex-row items-center justify-between pb-2'>
        <CardTitle className='text-sm font-medium'>{stat.title}</CardTitle>
        <Icon className='h-4 w-4 text-muted-foreground' />
      </CardHeader>
      <CardContent>
        <div className='text-2xl font-bold'>{stat.value}</div>
        <p className='text-xs text-muted-foreground'>{stat.detail}</p>
      </CardContent>
    </Card>
  )
}

function GrowthChart({ data }: { data: SystemOverview['dailyTrend'] }) {
  return (
    <ResponsiveContainer width='100%' height={350}>
      <BarChart data={data}>
        <XAxis
          dataKey='label'
          stroke='var(--muted-foreground)'
          fontSize={12}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          direction='ltr'
          stroke='var(--muted-foreground)'
          fontSize={12}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
        />
        <Bar
          dataKey='users'
          fill='currentColor'
          radius={[4, 4, 0, 0]}
          className='fill-primary'
        />
      </BarChart>
    </ResponsiveContainer>
  )
}

function AuditChart({ data }: { data: SystemOverview['dailyTrend'] }) {
  return (
    <ResponsiveContainer width='100%' height={350}>
      <AreaChart data={data}>
        <XAxis
          dataKey='label'
          stroke='var(--muted-foreground)'
          fontSize={12}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          stroke='var(--muted-foreground)'
          fontSize={12}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
        />
        <Area
          type='monotone'
          dataKey='auditLogs'
          stroke='var(--primary)'
          fill='var(--primary)'
          fillOpacity={0.15}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}

function StatusDistribution({
  items,
}: {
  items: Array<{ label: string; value: number }>
}) {
  const total = items.reduce((sum, item) => sum + item.value, 0)

  return (
    <div className='flex flex-col gap-4'>
      {items.map((item) => {
        const percent = total > 0 ? Math.round((item.value / total) * 100) : 0

        return (
          <div key={item.label} className='flex flex-col gap-2'>
            <div className='flex items-center justify-between gap-3 text-sm'>
              <span className='font-medium'>{item.label}</span>
              <div className='flex items-center gap-2'>
                <span className='tabular-nums text-muted-foreground'>
                  {item.value}
                </span>
                <Badge variant='secondary'>{percent}%</Badge>
              </div>
            </div>
            <div className='h-2 overflow-hidden rounded-full bg-muted'>
              <div
                className='h-full bg-primary'
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

function SystemSkeleton() {
  return (
    <div className='flex flex-col gap-4'>
      <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3'>
        {Array.from({ length: 3 }, (_, index) => (
          <Card key={index}>
            <CardHeader className='pb-2'>
              <Skeleton className='h-4 w-20' />
            </CardHeader>
            <CardContent className='flex flex-col gap-2'>
              <Skeleton className='h-8 w-16' />
              <Skeleton className='h-3 w-28' />
            </CardContent>
          </Card>
        ))}
      </div>
      <div className='grid grid-cols-1 gap-4 lg:grid-cols-7'>
        <Card className='lg:col-span-4'>
          <CardHeader>
            <Skeleton className='h-5 w-24' />
          </CardHeader>
          <CardContent>
            <Skeleton className='h-[350px] w-full' />
          </CardContent>
        </Card>
        <Card className='lg:col-span-3'>
          <CardHeader>
            <Skeleton className='h-5 w-24' />
          </CardHeader>
          <CardContent className='flex flex-col gap-4'>
            <Skeleton className='h-10 w-full' />
            <Skeleton className='h-10 w-full' />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function buildStats(data: SystemOverview | undefined): StatCard[] {
  return [
    {
      title: '用户',
      value: data?.counts.users ?? '-',
      detail: `${data?.userStatus.active ?? 0} 个启用`,
      icon: Users,
    },
    {
      title: '审计日志',
      value: data?.counts.auditLogs ?? '-',
      detail: '累计管理记录',
      icon: FileText,
    },
    {
      title: '服务器时间',
      value: data?.serverTime ? formatTime(data.serverTime) : '-',
      detail: data?.serverTime ? formatDate(data.serverTime) : '未同步',
      icon: Clock,
    },
  ]
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString('zh-CN')
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString('zh-CN')
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  })
}
