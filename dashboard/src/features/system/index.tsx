import { Button, Card, Chip, ProgressBar, Skeleton, Tabs } from '@heroui/react'
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
      <Card.Content className='flex flex-col items-start gap-3 py-6'>
        <div className='space-y-1'>
          <div className='font-medium'>加载失败</div>
          <p className='text-sm text-muted'>
            {getSystemOverviewErrorMessage(error)}
          </p>
        </div>
        <Button variant='outline' size='sm' onPress={onRetry}>
          重试
        </Button>
      </Card.Content>
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
        <Card.Content className='py-6 text-sm text-muted'>
          暂无数据
        </Card.Content>
      </Card>
    )
  }

  return (
    <Tabs
      defaultSelectedKey='overview'
      className='flex flex-col gap-4'
    >
      <div className='w-full overflow-x-auto pb-1'>
        <Tabs.ListContainer className='w-fit'><Tabs.List aria-label="页面分区">
          <Tabs.Tab id='overview'>概览<Tabs.Indicator /></Tabs.Tab>
          <Tabs.Tab id='activity'>活动<Tabs.Indicator /></Tabs.Tab>
        </Tabs.List></Tabs.ListContainer>
      </div>

      <Tabs.Panel id='overview' className='flex flex-col gap-4'>
        <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3'>
          {stats.map((stat) => (
            <SystemStatCard key={stat.title} stat={stat} />
          ))}
        </div>

        <div className='grid grid-cols-1 gap-4 lg:grid-cols-7'>
          <Card className='lg:col-span-4'>
            <Card.Header>
              <Card.Title>增长趋势</Card.Title>
              <Card.Description>最近 7 天</Card.Description>
            </Card.Header>
            <Card.Content className='ps-2'>
              <GrowthChart data={data.dailyTrend} />
            </Card.Content>
          </Card>

          <Card className='lg:col-span-3'>
            <Card.Header>
              <Card.Title>账号状态</Card.Title>
              <Card.Description>当前用户</Card.Description>
            </Card.Header>
            <Card.Content>
              <StatusDistribution
                items={[
                  { label: '启用', value: data.userStatus.active },
                  { label: '禁用', value: data.userStatus.disabled },
                ]}
              />
            </Card.Content>
          </Card>
        </div>
      </Tabs.Panel>

      <Tabs.Panel id='activity'>
        <Card>
          <Card.Header>
            <Card.Title>管理操作</Card.Title>
            <Card.Description>最近 7 天</Card.Description>
          </Card.Header>
          <Card.Content className='ps-2'>
            <AuditChart data={data.dailyTrend} />
          </Card.Content>
        </Card>

      </Tabs.Panel>
    </Tabs>
  )
}

function SystemStatCard({ stat }: { stat: StatCard }) {
  const Icon = stat.icon

  return (
    <Card>
      <Card.Header className='flex flex-row items-center justify-between pb-2'>
        <Card.Title className='text-sm font-medium'>{stat.title}</Card.Title>
        <Icon className='h-4 w-4 text-muted' />
      </Card.Header>
      <Card.Content>
        <div className='text-2xl font-bold'>{stat.value}</div>
        <p className='text-xs text-muted'>{stat.detail}</p>
      </Card.Content>
    </Card>
  )
}

function GrowthChart({ data }: { data: SystemOverview['dailyTrend'] }) {
  return (
    <ResponsiveContainer width='100%' height={350}>
      <BarChart data={data}>
        <XAxis
          dataKey='label'
          stroke='var(--muted)'
          fontSize={12}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          direction='ltr'
          stroke='var(--muted)'
          fontSize={12}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
        />
        <Bar
          dataKey='users'
          fill='var(--accent)'
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
          stroke='var(--muted)'
          fontSize={12}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          stroke='var(--muted)'
          fontSize={12}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
        />
        <Area
          type='monotone'
          dataKey='auditLogs'
          stroke='var(--accent)'
          fill='var(--accent)'
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
                <span className='tabular-nums text-muted'>
                  {item.value}
                </span>
                <Chip color="default">{percent}%</Chip>
              </div>
            </div>
            <ProgressBar aria-label={`${item.label}占比`} value={percent}>
              <ProgressBar.Track><ProgressBar.Fill /></ProgressBar.Track>
            </ProgressBar>
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
            <Card.Header className='pb-2'>
              <Skeleton className='h-4 w-20' />
            </Card.Header>
            <Card.Content className='flex flex-col gap-2'>
              <Skeleton className='w-16' />
              <Skeleton className='h-3 w-28' />
            </Card.Content>
          </Card>
        ))}
      </div>
      <div className='grid grid-cols-1 gap-4 lg:grid-cols-7'>
        <Card className='lg:col-span-4'>
          <Card.Header>
            <Skeleton className='h-5 w-24' />
          </Card.Header>
          <Card.Content>
            <Skeleton className='h-[350px] w-full' />
          </Card.Content>
        </Card>
        <Card className='lg:col-span-3'>
          <Card.Header>
            <Skeleton className='h-5 w-24' />
          </Card.Header>
          <Card.Content className='flex flex-col gap-4'>
            <Skeleton className='h-10 w-full' />
            <Skeleton className='h-10 w-full' />
          </Card.Content>
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

function formatDate(value: string) {
  return new Date(value).toLocaleDateString('zh-CN')
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  })
}
