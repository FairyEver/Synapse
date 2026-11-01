import { Button, Card, Input, ListBox, Popover, Select, Skeleton, Surface } from '@heroui/react'
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronsUpDown } from 'lucide-react'
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
  Tooltip as ChartTooltip,
} from 'recharts'
import {
  adminApi,
  type AdminUserRow,
  type TelemetryDimension,
  type TelemetryStats,
  type TelemetryStatsOptions,
} from '@/lib/api'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'


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
  browserName?: string
  browserVersion?: string
  osName?: string
  osVersion?: string
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
            <Card.Content className='py-8 text-sm text-muted'>
              暂无埋点数据
            </Card.Content>
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
        label='全部浏览器'
        value={filters.browserName}
        options={filterOptions?.browserNames}
        formatLabel={browserLabel}
        onChange={(browserName) => onChange((current) => ({
          ...current,
          browserName,
          browserVersion: browserName === current.browserName ? current.browserVersion : undefined,
        }))}
      />
      {filters.browserName ? (
        <DimensionFilter
          label='全部浏览器版本'
          value={filters.browserVersion}
          options={filterOptions?.browserVersions}
          onChange={(browserVersion) => onChange((current) => ({ ...current, browserVersion }))}
        />
      ) : null}
      <DimensionFilter
        label='全部系统'
        value={filters.osName}
        options={filterOptions?.osNames}
        formatLabel={operatingSystemLabel}
        onChange={(osName) => onChange((current) => ({
          ...current,
          osName,
          osVersion: osName === current.osName ? current.osVersion : undefined,
        }))}
      />
      {filters.osName ? (
        <DimensionFilter
          label='全部系统版本'
          value={filters.osVersion}
          options={filterOptions?.osVersions}
          onChange={(osVersion) => onChange((current) => ({ ...current, osVersion }))}
        />
      ) : null}
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
    <Select aria-label={ariaLabel} value={value} onChange={(key) => (onChange)(String(key ?? ''))}>
      <Select.Trigger aria-label={ariaLabel} >
        <Select.Value />
      <Select.Indicator /></Select.Trigger>
      <Select.Popover><ListBox>

          {options.map((option) => (
            <ListBox.Item key={option.value} id={option.value}>{option.label}<ListBox.ItemIndicator /></ListBox.Item>
          ))}

      </ListBox></Select.Popover>
    </Select>
  )
}

function DimensionFilter({
  label,
  value,
  options = [],
  formatLabel = (option) => option,
  onChange,
}: {
  label: string
  value?: string
  options?: TelemetryDimension[]
  formatLabel?: (value: string) => string
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
        ...available.map((option) => ({ value: option.value, label: formatLabel(option.value) })),
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
  const selectUser = (key: string | number) => {
    onChange(data?.data.find((item) => item.id === key) ?? null)
    setOpen(false)
  }
  const closeCurrentSelection = (key: string) => {
    if (key === (value?.id ?? allValue)) setOpen(false)
  }
  return (
    <Popover isOpen={open} onOpenChange={setOpen}>
      <Button variant='outline' aria-label='用户筛选' aria-expanded={open} isDisabled={disabled} className='max-w-56'>
        <span className='truncate'>{value ? value.handle || value.email : '全部用户'}</span>
        <ChevronsUpDown className='size-4 shrink-0 text-muted' />
      </Button>
      <Popover.Content className='w-72' placement='bottom start'>
        <Popover.Dialog className='grid gap-2'>
          <Input variant="secondary" aria-label='搜索用户' placeholder='搜索用户' value={search} onChange={(event) => setSearch(event.target.value)} />
          {isLoading ? <p role='status' className='text-sm text-muted'>加载中</p> : null}
          <ListBox aria-label='用户筛选' selectionMode='single' disallowEmptySelection selectedKeys={[value?.id ?? allValue]} onSelectionChange={(keys) => {
            if (keys === 'all') return
            const key = keys.values().next().value
            if (key !== undefined) selectUser(key)
          }}>
            <ListBox.Item id={allValue} textValue='全部用户' onPress={() => closeCurrentSelection(allValue)}>全部用户<ListBox.ItemIndicator /></ListBox.Item>
            {data?.data.map((user) => (
              <ListBox.Item key={user.id} id={user.id} textValue={`${user.handle} ${user.email}`} onPress={() => closeCurrentSelection(user.id)}>
                <span className='min-w-0'>
                  <span className='block truncate'>{user.handle}</span>
                  <span className='block truncate text-xs text-muted'>{user.email}</span>
                </span>
                <ListBox.ItemIndicator />
              </ListBox.Item>
            ))}
          </ListBox>
          {!isLoading && !data?.data.length ? <p className='text-sm text-muted'>没有匹配用户</p> : null}
        </Popover.Dialog>
      </Popover.Content>
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
      <MetricCards metrics={metrics} />
      <MetricCards metrics={insightMetrics} />

      <Card>
        <Card.Header>
          <Card.Title>事件趋势</Card.Title>
        </Card.Header>
        <Card.Content className='ps-2'>
          <ResponsiveContainer width='100%' height={320}>
            <LineChart data={data.trend} margin={{ right: 16 }}>
              <CartesianGrid vertical={false} stroke='var(--separator)' />
              <XAxis dataKey='date' tickFormatter={shortDate} stroke='var(--muted)' fontSize={12} tickLine={false} axisLine={false} />
              <YAxis stroke='var(--muted)' fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
              <Legend />
              <Line type='monotone' dataKey='events' name='总事件' stroke='var(--accent)' strokeWidth={2} dot={false} />
              <Line type='monotone' dataKey='authenticatedEvents' name='已登录' stroke='var(--foreground)' strokeWidth={2} dot={false} />
              <Line type='monotone' dataKey='anonymousEvents' name='匿名' stroke='var(--muted)' strokeWidth={2} strokeDasharray='4 4' dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </Card.Content>
      </Card>

      <Card>
        <Card.Header>
          <Card.Title>活跃与失败趋势</Card.Title>
        </Card.Header>
        <Card.Content className='ps-2'>
          <ResponsiveContainer width='100%' height={320}>
            <LineChart data={data.trend} margin={{ right: 16 }}>
              <CartesianGrid vertical={false} stroke='var(--separator)' />
              <XAxis dataKey='date' tickFormatter={shortDate} stroke='var(--muted)' fontSize={12} tickLine={false} axisLine={false} />
              <YAxis stroke='var(--muted)' fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
              <Legend />
              <Line type='monotone' dataKey='activeUsers' name='登录用户' stroke='var(--accent)' strokeWidth={2} dot={false} />
              <Line type='monotone' dataKey='anonymousClients' name='匿名客户端' stroke='var(--foreground)' strokeWidth={2} dot={false} />
              <Line type='monotone' dataKey='failures' name='失败操作' stroke='var(--danger)' strokeWidth={2} strokeDasharray='4 4' dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </Card.Content>
      </Card>

      <div className='grid gap-4 lg:grid-cols-2'>
        <DimensionChart title='高频模块' items={data.dimensions.modules} />
        <DimensionChart title='高频事件' items={data.dimensions.events} />
        <DimensionChart title='高频动作' items={data.dimensions.actions} />
        <DimensionChart title='操作结果' items={data.dimensions.outcomes} label={outcomeLabel} />
        <DimensionChart title='应用版本' items={data.dimensions.versions} />
        <DimensionChart title='平台' items={data.dimensions.platforms} />
        <DimensionChart title='浏览器（会话）' items={data.dimensions.browserNames} label={browserLabel} />
        <DimensionChart
          title='浏览器版本（会话）'
          items={data.dimensions.browserVersions}
          label={(value) => environmentVersionLabel(value, browserLabel)}
        />
        <DimensionChart title='操作系统（会话）' items={data.dimensions.osNames} label={operatingSystemLabel} />
        <DimensionChart
          title='系统版本（会话）'
          items={data.dimensions.osVersions}
          label={(value) => environmentVersionLabel(value, operatingSystemLabel)}
        />
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

function MetricCards({ metrics }: { metrics: Array<{ label: string; value: string }> }) {
  return <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-4'>
    {metrics.map((metric) => <Card key={metric.label}>
      <Card.Header><Card.Title className='text-sm text-muted'>{metric.label}</Card.Title></Card.Header>
      <Card.Content><p className='text-3xl font-semibold tabular-nums'>{metric.value}</p></Card.Content>
    </Card>)}
  </div>
}

function AdoptionChart({ items }: { items: TelemetryStats['insights']['adoption'] }) {
  const chartData = items.slice(0, 12).map((item) => ({
    ...item,
    label: featureLabel(item.featureKey),
  }))
  return (
    <Card>
      <Card.Header>
        <Card.Title>功能采用</Card.Title>
      </Card.Header>
      <Card.Content className='ps-2'>
        {chartData.length > 0 ? (
          <ResponsiveContainer width='100%' height={Math.max(260, chartData.length * 30)}>
            <BarChart data={chartData} layout='vertical' margin={{ left: 8, right: 20 }}>
              <XAxis type='number' hide />
              <YAxis dataKey='label' type='category' width={112} tickFormatter={dimensionLabel} tickLine={false} axisLine={false} fontSize={12} />
              <ChartTooltip cursor={false} content={<DimensionTooltip />} />
              <Bar dataKey='identities' maxBarSize={24} name='使用身份' fill='var(--accent)' radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className='py-12 text-center text-sm text-muted'>暂无采用数据</div>
        )}
      </Card.Content>
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
      <Card.Header className='flex-row items-center justify-between gap-3'>
        <Card.Title>关键漏斗</Card.Title>
        {funnels.length > 0 ? (
          <Select variant="secondary" aria-label='漏斗类型' value={active?.funnelKey} onChange={(key) => (setSelected)(String(key ?? ''))}>
            <Select.Trigger  aria-label='漏斗类型'>
              <Select.Value />
            <Select.Indicator /></Select.Trigger>
            <Select.Popover><ListBox>

                {funnels.map((funnel) => (
                  <ListBox.Item key={funnel.funnelKey} id={funnel.funnelKey}>
                    {funnelLabel(funnel.funnelKey)}
                  <ListBox.ItemIndicator /></ListBox.Item>
                ))}

            </ListBox></Select.Popover>
          </Select>
        ) : null}
      </Card.Header>
      <Card.Content className='ps-2'>
        {chartData.length > 0 ? (
          <ResponsiveContainer width='100%' height={260}>
            <BarChart data={chartData} layout='vertical' margin={{ left: 8, right: 20 }}>
              <XAxis type='number' hide />
              <YAxis dataKey='label' type='category' width={112} tickFormatter={dimensionLabel} tickLine={false} axisLine={false} fontSize={12} />
              <ChartTooltip cursor={false} content={<DimensionTooltip />} />
              <Bar dataKey='identities' maxBarSize={24} name='完成身份' fill='var(--success)' radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className='py-12 text-center text-sm text-muted'>暂无漏斗数据</div>
        )}
      </Card.Content>
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
      <Card.Header>
        <Card.Title>身份留存</Card.Title>
      </Card.Header>
      <Card.Content className='ps-2'>
        {chartData.length > 0 ? (
          <ResponsiveContainer width='100%' height={320}>
            <LineChart data={chartData} margin={{ right: 16 }}>
              <CartesianGrid vertical={false} stroke='var(--separator)' />
              <XAxis dataKey='cohortDate' tickFormatter={shortDate} stroke='var(--muted)' fontSize={12} tickLine={false} axisLine={false} />
              <YAxis domain={[0, 100]} tickFormatter={(value) => `${value}%`} stroke='var(--muted)' fontSize={12} tickLine={false} axisLine={false} />
              <Legend />
              <Line type='monotone' dataKey='day1' name='D1' stroke='var(--accent)' strokeWidth={2} connectNulls={false} dot={false} />
              <Line type='monotone' dataKey='day7' name='D7' stroke='var(--success)' strokeWidth={2} connectNulls={false} dot={false} />
              <Line type='monotone' dataKey='day30' name='D30' stroke='var(--warning)' strokeWidth={2} connectNulls={false} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className='py-12 text-center text-sm text-muted'>暂无留存数据</div>
        )}
      </Card.Content>
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
      <Card.Header>
        <Card.Title>{title}</Card.Title>
      </Card.Header>
      <Card.Content className='ps-2'>
        {chartData.length > 0 ? (
          <ResponsiveContainer width='100%' height={Math.max(80, chartData.length * 32)}>
            <BarChart data={chartData} layout='vertical' margin={{ left: 8, right: 20 }}>
              <XAxis type='number' hide />
              <YAxis dataKey='label' type='category' width={112} tickFormatter={dimensionLabel} tickLine={false} axisLine={false} fontSize={12} />
              <ChartTooltip cursor={false} content={<DimensionTooltip />} />
              <Bar dataKey='count' maxBarSize={24} fill='var(--accent)' radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className='py-12 text-center text-sm text-muted'>暂无数据</div>
        )}
      </Card.Content>
    </Card>
  )
}

function dimensionLabel(value: string | number): string {
  const label = String(value)
  let result = ''
  let width = 0
  for (const character of label) {
    width += character.codePointAt(0)! > 255 ? 2 : 1
    if (width > 16) return `${result}…`
    result += character
  }
  return label
}

function DimensionTooltip({ active, label, payload }: {
  active?: boolean
  label?: string | number
  payload?: readonly { value?: string | number }[]
}) {
  if (!active || !payload?.length) return null
  return <Surface className='max-w-80 space-y-1 rounded-xl px-3 py-2 shadow-overlay'>
    <p className='break-words text-sm'>{label}</p>
    <p className='text-sm tabular-nums text-muted'>{payload[0].value}</p>
  </Surface>
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
      <Card.Content className='flex items-center justify-between gap-4 py-6'>
        <div>
          <div className='font-medium'>加载失败</div>
          <div className='text-sm text-muted'>
            {error instanceof Error ? error.message : '统计数据暂时不可用'}
          </div>
        </div>
        <Button variant='outline' size='sm' onPress={onRetry}>重试</Button>
      </Card.Content>
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
    browserName: filters.browserName,
    browserVersion: filters.browserVersion,
    osName: filters.osName,
    osVersion: filters.osVersion,
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

function browserLabel(value: string) {
  const labels: Record<string, string> = {
    chrome: 'Chrome',
    chromium: 'Chromium',
    edge: 'Edge',
    firefox: 'Firefox',
    opera: 'Opera',
    safari: 'Safari',
    'samsung-internet': 'Samsung Internet',
    unknown: '未知',
  }
  return labels[value] ?? value
}

function operatingSystemLabel(value: string) {
  const labels: Record<string, string> = {
    android: 'Android',
    chromeos: 'ChromeOS',
    ios: 'iOS',
    linux: 'Linux',
    macos: 'macOS',
    windows: 'Windows',
    'windows-7': 'Windows 7',
    'windows-8': 'Windows 8',
    'windows-8.1': 'Windows 8.1',
    'windows-10': 'Windows 10',
    'windows-10-or-11': 'Windows 10 / 11',
    'windows-11': 'Windows 11',
    unknown: '未知',
  }
  return labels[value] ?? value
}

function environmentVersionLabel(value: string, nameLabel: (name: string) => string) {
  const separator = value.indexOf(':')
  return separator > 0 ? `${nameLabel(value.slice(0, separator))} ${value.slice(separator + 1)}` : value
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
