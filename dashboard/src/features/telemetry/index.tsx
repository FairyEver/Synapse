import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check, ChevronsUpDown } from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts'
import {
  adminApi,
  type AdminUserRow,
  type TelemetryDimension,
  type TelemetryStats,
  type TelemetryStatsOptions,
} from '@/lib/api'
import { cn } from '@/lib/utils'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'

type IdentityFilter = 'all' | 'authenticated' | 'anonymous'
type RangeDays = 7 | 30 | 90 | 180

type Filters = {
  rangeDays: RangeDays
  identity: IdentityFilter
  user: AdminUserRow | null
  moduleId?: string
  eventKey?: string
  appVersion?: string
  platform?: string
  windowType?: string
}

const allValue = '__all__'

export default function TelemetryPage() {
  const [filters, setFilters] = useState<Filters>({
    rangeDays: 30,
    identity: 'all',
    user: null,
  })
  const query = useMemo(() => buildStatsQuery(filters), [filters])
  const { data, error, isError, isLoading, refetch } = useQuery({
    queryKey: ['admin-telemetry', query],
    queryFn: () => adminApi.getTelemetryStats(query),
  })

  return (
    <>
      <Header fixed>
        <h1 className='text-lg font-semibold'>埋点统计</h1>
      </Header>
      <Main className='space-y-4'>
        <TelemetryFilters filters={filters} data={data} onChange={setFilters} />
        {isLoading ? (
          <TelemetrySkeleton />
        ) : isError ? (
          <TelemetryError error={error} onRetry={() => void refetch()} />
        ) : data && data.summary.events > 0 ? (
          <TelemetryDashboard data={data} />
        ) : (
          <Card>
            <CardContent className='py-8 text-sm text-muted-foreground'>
              暂无埋点数据
            </CardContent>
          </Card>
        )}
      </Main>
    </>
  )
}

function TelemetryFilters({
  filters,
  data,
  onChange,
}: {
  filters: Filters
  data?: TelemetryStats
  onChange: React.Dispatch<React.SetStateAction<Filters>>
}) {
  const filterOptions = data?.filterOptions
  return (
    <div className='flex flex-wrap items-center gap-2'>
      <FilterSelect
        ariaLabel='统计范围'
        value={String(filters.rangeDays)}
        options={[
          { value: '7', label: '最近 7 天' },
          { value: '30', label: '最近 30 天' },
          { value: '90', label: '最近 90 天' },
          { value: '180', label: '最近 180 天' },
        ]}
        onChange={(value) => onChange((current) => ({
          ...current,
          rangeDays: Number(value) as RangeDays,
        }))}
      />
      <FilterSelect
        ariaLabel='登录状态'
        value={filters.identity}
        options={[
          { value: 'all', label: '全部身份' },
          { value: 'authenticated', label: '已登录' },
          { value: 'anonymous', label: '匿名' },
        ]}
        onChange={(value) => onChange((current) => ({
          ...current,
          identity: value as IdentityFilter,
          user: value === 'anonymous' ? null : current.user,
        }))}
      />
      <UserFilter
        value={filters.user}
        disabled={filters.identity === 'anonymous'}
        onChange={(user) => onChange((current) => ({
          ...current,
          user,
          identity: user ? 'authenticated' : current.identity,
        }))}
      />
      <DimensionFilter
        label='全部模块'
        value={filters.moduleId}
        options={filterOptions?.modules}
        onChange={(moduleId) => onChange((current) => ({ ...current, moduleId }))}
      />
      <DimensionFilter
        label='全部事件'
        value={filters.eventKey}
        options={filterOptions?.events}
        onChange={(eventKey) => onChange((current) => ({ ...current, eventKey }))}
      />
      <DimensionFilter
        label='全部版本'
        value={filters.appVersion}
        options={filterOptions?.versions}
        onChange={(appVersion) => onChange((current) => ({ ...current, appVersion }))}
      />
      <DimensionFilter
        label='全部平台'
        value={filters.platform}
        options={filterOptions?.platforms}
        onChange={(platform) => onChange((current) => ({ ...current, platform }))}
      />
      <DimensionFilter
        label='全部窗口'
        value={filters.windowType}
        options={filterOptions?.windowTypes}
        onChange={(windowType) => onChange((current) => ({ ...current, windowType }))}
      />
    </div>
  )
}

function FilterSelect({
  ariaLabel,
  value,
  options,
  onChange,
}: {
  ariaLabel: string
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (value: string) => void
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={ariaLabel} size='sm'>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

function DimensionFilter({
  label,
  value,
  options = [],
  onChange,
}: {
  label: string
  value?: string
  options?: TelemetryDimension[]
  onChange: (value: string | undefined) => void
}) {
  const available = value && !options.some((option) => option.value === value)
    ? [{ value, count: 0 }, ...options]
    : options
  return (
    <FilterSelect
      ariaLabel={label}
      value={value ?? allValue}
      options={[
        { value: allValue, label },
        ...available.map((option) => ({ value: option.value, label: option.value })),
      ]}
      onChange={(next) => onChange(next === allValue ? undefined : next)}
    />
  )
}

function UserFilter({
  value,
  disabled,
  onChange,
}: {
  value: AdminUserRow | null
  disabled: boolean
  onChange: (value: AdminUserRow | null) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const { data, isLoading } = useQuery({
    queryKey: ['admin-users-filter', search],
    queryFn: () => adminApi.listUsers({ page: 1, pageSize: 20, search: search || undefined }),
    enabled: open,
  })
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant='outline'
          size='sm'
          role='combobox'
          aria-expanded={open}
          disabled={disabled}
          className='max-w-56 justify-between font-normal'
        >
          <span className='truncate'>{value ? value.handle || value.email : '全部用户'}</span>
          <ChevronsUpDown className='size-4 shrink-0 text-muted-foreground' />
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-72 p-0' align='start'>
        <Command shouldFilter={false}>
          <CommandInput placeholder='搜索用户' value={search} onValueChange={setSearch} />
          <CommandList>
            <CommandEmpty>{isLoading ? '加载中' : '没有匹配用户'}</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value={allValue}
                onSelect={() => {
                  onChange(null)
                  setOpen(false)
                }}
              >
                <Check className={cn('size-4', value ? 'opacity-0' : 'opacity-100')} />
                全部用户
              </CommandItem>
              {data?.data.map((user) => (
                <CommandItem
                  key={user.id}
                  value={user.id}
                  onSelect={() => {
                    onChange(user)
                    setOpen(false)
                  }}
                >
                  <Check className={cn('size-4', value?.id === user.id ? 'opacity-100' : 'opacity-0')} />
                  <span className='min-w-0'>
                    <span className='block truncate'>{user.handle}</span>
                    <span className='block truncate text-xs text-muted-foreground'>{user.email}</span>
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function TelemetryDashboard({ data }: { data: TelemetryStats }) {
  const metrics = [
    { label: '事件', value: formatNumber(data.summary.events) },
    { label: '登录用户', value: formatNumber(data.summary.authenticatedUsers) },
    { label: '匿名客户端', value: formatNumber(data.summary.anonymousClients) },
    { label: '会话', value: formatNumber(data.summary.sessions) },
    { label: '失败率', value: formatPercent(data.summary.failureRate) },
    { label: 'P95 耗时', value: formatDuration(data.summary.p95DurationMs) },
  ]
  const insightMetrics = [
    { label: '日活', value: formatNumber(data.insights.active.dau) },
    { label: '周活', value: formatNumber(data.insights.active.wau) },
    { label: '月活', value: formatNumber(data.insights.active.mau) },
    { label: '活跃粘性', value: formatPercent(data.insights.active.stickiness) },
    { label: '平均会话', value: formatDuration(data.insights.sessions.averageDurationMs) },
    { label: 'P95 会话', value: formatDuration(data.insights.sessions.p95DurationMs) },
    { label: '新身份', value: formatNumber(data.insights.identities.new) },
    { label: '回访身份', value: formatNumber(data.insights.identities.returning) },
  ]
  return (
    <div className='flex flex-col gap-4'>
      <div className='grid overflow-hidden rounded-xl border bg-card sm:grid-cols-2 lg:grid-cols-6'>
        {metrics.map((metric) => (
          <div key={metric.label} className='px-4 py-3 not-last:border-b sm:[&:nth-child(odd)]:border-r lg:border-b-0 lg:not-last:border-r'>
            <div className='text-sm text-muted-foreground'>{metric.label}</div>
            <div className='mt-1 text-xl font-semibold tabular-nums'>{metric.value}</div>
          </div>
        ))}
      </div>

      <div className='grid overflow-hidden rounded-xl border bg-card sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8'>
        {insightMetrics.map((metric) => (
          <div key={metric.label} className='px-4 py-3 not-last:border-b sm:[&:nth-child(odd)]:border-r lg:border-b-0 lg:not-last:border-r'>
            <div className='text-sm text-muted-foreground'>{metric.label}</div>
            <div className='mt-1 text-xl font-semibold tabular-nums'>{metric.value}</div>
          </div>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>事件趋势</CardTitle>
        </CardHeader>
        <CardContent className='ps-2'>
          <ResponsiveContainer width='100%' height={320}>
            <LineChart data={data.trend} margin={{ right: 16 }}>
              <CartesianGrid vertical={false} stroke='var(--border)' />
              <XAxis dataKey='date' tickFormatter={shortDate} stroke='var(--muted-foreground)' fontSize={12} tickLine={false} axisLine={false} />
              <YAxis stroke='var(--muted-foreground)' fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
              <Legend />
              <Line type='monotone' dataKey='events' name='总事件' stroke='var(--primary)' strokeWidth={2} dot={false} />
              <Line type='monotone' dataKey='authenticatedEvents' name='已登录' stroke='var(--foreground)' strokeWidth={2} dot={false} />
              <Line type='monotone' dataKey='anonymousEvents' name='匿名' stroke='var(--muted-foreground)' strokeWidth={2} strokeDasharray='4 4' dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>活跃与失败趋势</CardTitle>
        </CardHeader>
        <CardContent className='ps-2'>
          <ResponsiveContainer width='100%' height={320}>
            <LineChart data={data.trend} margin={{ right: 16 }}>
              <CartesianGrid vertical={false} stroke='var(--border)' />
              <XAxis dataKey='date' tickFormatter={shortDate} stroke='var(--muted-foreground)' fontSize={12} tickLine={false} axisLine={false} />
              <YAxis stroke='var(--muted-foreground)' fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
              <Legend />
              <Line type='monotone' dataKey='activeUsers' name='登录用户' stroke='var(--primary)' strokeWidth={2} dot={false} />
              <Line type='monotone' dataKey='anonymousClients' name='匿名客户端' stroke='var(--foreground)' strokeWidth={2} dot={false} />
              <Line type='monotone' dataKey='failures' name='失败操作' stroke='var(--destructive)' strokeWidth={2} strokeDasharray='4 4' dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <div className='grid gap-4 lg:grid-cols-2'>
        <DimensionChart title='高频模块' items={data.dimensions.modules} />
        <DimensionChart title='高频事件' items={data.dimensions.events} />
        <DimensionChart title='高频动作' items={data.dimensions.actions} />
        <DimensionChart title='操作结果' items={data.dimensions.outcomes} label={outcomeLabel} />
        <DimensionChart title='应用版本' items={data.dimensions.versions} />
        <DimensionChart title='平台' items={data.dimensions.platforms} />
        <DimensionChart title='窗口类型' items={data.dimensions.windowTypes} />
      </div>

      <div className='grid gap-4 lg:grid-cols-2'>
        <AdoptionChart items={data.insights.adoption} />
        <FunnelChart funnels={data.insights.funnels} />
      </div>
      <RetentionChart rows={data.insights.retention} />
    </div>
  )
}

function AdoptionChart({ items }: { items: TelemetryStats['insights']['adoption'] }) {
  const chartData = items.slice(0, 12).map((item) => ({
    ...item,
    label: featureLabel(item.featureKey),
  }))
  return (
    <Card>
      <CardHeader>
        <CardTitle>功能采用</CardTitle>
      </CardHeader>
      <CardContent className='ps-2'>
        {chartData.length > 0 ? (
          <ResponsiveContainer width='100%' height={Math.max(260, chartData.length * 30)}>
            <BarChart data={chartData} layout='vertical' margin={{ left: 8, right: 20 }}>
              <XAxis type='number' hide />
              <YAxis dataKey='label' type='category' width={112} tickLine={false} axisLine={false} fontSize={12} />
              <Bar dataKey='identities' name='使用身份' fill='var(--chart-1)' radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className='py-12 text-center text-sm text-muted-foreground'>暂无采用数据</div>
        )}
      </CardContent>
    </Card>
  )
}

function FunnelChart({ funnels }: { funnels: TelemetryStats['insights']['funnels'] }) {
  const [selected, setSelected] = useState(() => funnels[0]?.funnelKey ?? '')
  const active = funnels.find((funnel) => funnel.funnelKey === selected) ?? funnels[0]
  const chartData = active?.stages.map((stage) => ({
    ...stage,
    label: funnelStageLabel(active.funnelKey, stage.stageKey),
  })) ?? []
  return (
    <Card>
      <CardHeader className='flex-row items-center justify-between gap-3'>
        <CardTitle>关键漏斗</CardTitle>
        {funnels.length > 0 ? (
          <Select value={active?.funnelKey} onValueChange={setSelected}>
            <SelectTrigger size='sm' aria-label='漏斗类型'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {funnels.map((funnel) => (
                  <SelectItem key={funnel.funnelKey} value={funnel.funnelKey}>
                    {funnelLabel(funnel.funnelKey)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        ) : null}
      </CardHeader>
      <CardContent className='ps-2'>
        {chartData.length > 0 ? (
          <ResponsiveContainer width='100%' height={260}>
            <BarChart data={chartData} layout='vertical' margin={{ left: 8, right: 20 }}>
              <XAxis type='number' hide />
              <YAxis dataKey='label' type='category' width={112} tickLine={false} axisLine={false} fontSize={12} />
              <Bar dataKey='identities' name='完成身份' fill='var(--chart-2)' radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className='py-12 text-center text-sm text-muted-foreground'>暂无漏斗数据</div>
        )}
      </CardContent>
    </Card>
  )
}

function RetentionChart({ rows }: { rows: TelemetryStats['insights']['retention'] }) {
  const chartData = rows.map((row) => ({
    ...row,
    day1: nullablePercent(row.day1Rate),
    day7: nullablePercent(row.day7Rate),
    day30: nullablePercent(row.day30Rate),
  }))
  return (
    <Card>
      <CardHeader>
        <CardTitle>身份留存</CardTitle>
      </CardHeader>
      <CardContent className='ps-2'>
        {chartData.length > 0 ? (
          <ResponsiveContainer width='100%' height={320}>
            <LineChart data={chartData} margin={{ right: 16 }}>
              <CartesianGrid vertical={false} stroke='var(--border)' />
              <XAxis dataKey='cohortDate' tickFormatter={shortDate} stroke='var(--muted-foreground)' fontSize={12} tickLine={false} axisLine={false} />
              <YAxis domain={[0, 100]} tickFormatter={(value) => `${value}%`} stroke='var(--muted-foreground)' fontSize={12} tickLine={false} axisLine={false} />
              <Legend />
              <Line type='monotone' dataKey='day1' name='D1' stroke='var(--chart-1)' strokeWidth={2} connectNulls={false} dot={false} />
              <Line type='monotone' dataKey='day7' name='D7' stroke='var(--chart-2)' strokeWidth={2} connectNulls={false} dot={false} />
              <Line type='monotone' dataKey='day30' name='D30' stroke='var(--chart-3)' strokeWidth={2} connectNulls={false} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className='py-12 text-center text-sm text-muted-foreground'>暂无留存数据</div>
        )}
      </CardContent>
    </Card>
  )
}

function DimensionChart({
  title,
  items,
  label = (value) => value,
}: {
  title: string
  items: TelemetryDimension[]
  label?: (value: string) => string
}) {
  const chartData = items.slice(0, 10).map((item) => ({ ...item, label: label(item.value) }))
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className='ps-2'>
        {chartData.length > 0 ? (
          <ResponsiveContainer width='100%' height={Math.max(220, chartData.length * 30)}>
            <BarChart data={chartData} layout='vertical' margin={{ left: 8, right: 20 }}>
              <XAxis type='number' hide />
              <YAxis dataKey='label' type='category' width={112} tickLine={false} axisLine={false} fontSize={12} />
              <Bar dataKey='count' fill='var(--primary)' radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className='py-12 text-center text-sm text-muted-foreground'>暂无数据</div>
        )}
      </CardContent>
    </Card>
  )
}

function TelemetrySkeleton() {
  return (
    <div className='flex flex-col gap-4'>
      <Skeleton className='h-20 w-full' />
      <Skeleton className='h-96 w-full' />
      <div className='grid gap-4 lg:grid-cols-2'>
        <Skeleton className='h-80 w-full' />
        <Skeleton className='h-80 w-full' />
      </div>
    </div>
  )
}

function TelemetryError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <Card>
      <CardContent className='flex items-center justify-between gap-4 py-6'>
        <div>
          <div className='font-medium'>加载失败</div>
          <div className='text-sm text-muted-foreground'>
            {error instanceof Error ? error.message : '统计数据暂时不可用'}
          </div>
        </div>
        <Button variant='outline' size='sm' onClick={onRetry}>重试</Button>
      </CardContent>
    </Card>
  )
}

function buildStatsQuery(filters: Filters): TelemetryStatsOptions {
  const to = new Date()
  const from = new Date(to.getTime() - filters.rangeDays * 24 * 60 * 60 * 1000)
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    timezoneOffsetMinutes: -to.getTimezoneOffset(),
    identity: filters.identity,
    userId: filters.user?.id,
    moduleId: filters.moduleId,
    eventKey: filters.eventKey,
    appVersion: filters.appVersion,
    platform: filters.platform,
    windowType: filters.windowType,
  }
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('zh-CN').format(value)
}

function formatPercent(value: number) {
  return new Intl.NumberFormat('zh-CN', { style: 'percent', maximumFractionDigits: 1 }).format(value)
}

function formatDuration(value: number | null) {
  if (value === null) return '-'
  if (value < 1_000) return `${value} ms`
  return `${(value / 1_000).toFixed(1)} s`
}

function shortDate(value: string) {
  return value.slice(5)
}

function outcomeLabel(value: string) {
  if (value === 'success') return '成功'
  if (value === 'failure') return '失败'
  if (value === 'cancelled') return '取消'
  return value
}

function nullablePercent(value: number | null) {
  return value === null ? null : Math.round(value * 1000) / 10
}

function featureLabel(value: string) {
  const labels: Record<string, string> = {
    'drive.upload': '云盘上传',
    'drive.share': '云盘分享',
    'drive.edit': '云盘编辑',
    'drive.sync': '云盘同步',
    git: 'Git',
    workflow: 'Workflow',
    agent: 'Agent',
    automation: 'Automation',
    terminal: 'Terminal',
    secrets: 'Secrets',
    installers: '安装器',
  }
  return labels[value] ?? value
}

function funnelLabel(value: string) {
  const labels: Record<string, string> = {
    'drive-upload': '云盘上传',
    'drive-share': '云盘分享',
    'drive-edit': '云盘编辑',
    'drive-sync': '云盘同步',
    'git-publish': 'Git 发布',
    'workflow-run': 'Workflow 运行',
    'agent-response': 'Agent 响应',
  }
  return labels[value] ?? value
}

function funnelStageLabel(funnelKey: string, stageKey: string) {
  const labels: Record<string, string> = {
    'drive-upload.start': '开始上传',
    'drive-upload.success': '上传成功',
    'drive-share.open': '打开分享',
    'drive-share.success': '创建成功',
    'drive-edit.open': '打开编辑',
    'drive-edit.save': '保存成功',
    'drive-sync.open': '打开同步',
    'drive-sync.bound': '绑定成功',
    'git-publish.repository': '准备仓库',
    'git-publish.commit': '提交成功',
    'git-publish.push': '推送成功',
    'workflow-run.create': '创建流程',
    'workflow-run.run': '运行成功',
    'agent-response.session': '创建会话',
    'agent-response.message': '发送消息',
    'agent-response.response': '完成响应',
  }
  return labels[`${funnelKey}.${stageKey}`] ?? stageKey
}
