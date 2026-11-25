import { useEffect, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { Button, Card, Checkbox, Input, Label, Tabs, TextArea, TextField, toast } from '@heroui/react'
import { ArrowLeft, Copy, Plus, RefreshCw } from 'lucide-react'
import {
  STATE_SYNC_MAX_DOCS_CAP,
  STATE_SYNC_TTL_DEFAULT_SECONDS,
  STATE_SYNC_TTL_MAX_SECONDS,
  STATE_SYNC_TTL_MIN_SECONDS,
} from '@synapse/shared/state-sync-contracts'
import { ServerDataTable } from '@/components/data-table'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { RelativeTime } from '@/components/relative-time'
import { useAuthStore } from '@/stores/auth-store'
import { formatTtlSeconds, type StateSyncSpaceSummary } from './state-sync-api'
import { StateSyncDebugger } from './state-sync-debugger'
import { StateSyncDialogs } from './state-sync-dialogs'
import { StateSyncExamples } from './state-sync-examples'
import { StateSyncTokens } from './state-sync-tokens'
import { useStateSync, type StateSyncModel } from './use-state-sync'

const noPageChange = () => undefined

async function copySpaceId(id: string) {
  try {
    await navigator.clipboard.writeText(id)
    toast.success('已复制空间 ID')
  } catch {
    toast.danger('复制失败，请手动复制')
  }
}

export default function StateSyncPage() {
  const session = useAuthStore((s) => s.auth.user?.sessionId ?? 'anonymous')
  return <StateSyncWorkspace key={session} />
}

function StateSyncWorkspace() {
  const m = useStateSync()
  const space = m.detail.data
  const title = space?.name ?? '状态同步'

  return (
    <>
      <Header>
        {m.selectedId && (
          <Button variant='ghost' isIconOnly aria-label='返回空间列表' onPress={() => m.select(null)}>
            <ArrowLeft />
          </Button>
        )}
        <h1 className='min-w-0 truncate' title={title}>{title}</h1>
      </Header>
      <Main className='min-w-0'>
        {!m.selectedId ? (
          <SpaceList model={m} />
        ) : (
          <div className='space-y-4'>
            {m.detail.isLoading && <div className='text-sm text-muted'>加载中...</div>}
            {m.detail.error && (
              <div className='flex items-center gap-3'>
                <span className='text-sm text-danger'>
                  {m.detail.error instanceof Error ? m.detail.error.message : '加载同步空间失败'}
                </span>
                <Button variant='secondary' onPress={() => void m.detail.refetch()}>重试</Button>
              </div>
            )}
            {space && (
              <>
                <div className='flex flex-wrap items-center justify-between gap-2'>
                  <div className='flex flex-wrap items-center gap-2 text-sm text-muted'>
                    <span className='font-mono'>{space.id}</span>
                    <Button variant='ghost' onPress={() => void copySpaceId(space.id)}>
                      <Copy />
                      复制 ID
                    </Button>
                    <span className='tabular-nums'>默认 TTL：{formatTtlSeconds(space.defaultDocTtlSeconds)}</span>
                    <span className='tabular-nums'>房间配额：{space.docCount} / {space.maxDocs}</span>
                  </div>
                </div>
                <Tabs selectedKey={m.tab} onSelectionChange={(key) => m.setTab(String(key))}>
                  <Tabs.ListContainer className='w-fit max-w-full overflow-x-auto'>
                    <Tabs.List aria-label='状态同步空间管理' className='w-max'>
                      <Tabs.Tab className='whitespace-nowrap' id='debugger'>房间与实时调试<Tabs.Indicator /></Tabs.Tab>
                      <Tabs.Tab className='whitespace-nowrap' id='tokens'>接入凭证<Tabs.Indicator /></Tabs.Tab>
                      <Tabs.Tab className='whitespace-nowrap' id='examples'>接入与 SDK 示例<Tabs.Indicator /></Tabs.Tab>
                      <Tabs.Tab className='whitespace-nowrap' id='settings'>设置<Tabs.Indicator /></Tabs.Tab>
                    </Tabs.List>
                  </Tabs.ListContainer>
                  <Tabs.Panel id='debugger'>
                    <StateSyncDebugger key={space.id} model={m} space={space} />
                  </Tabs.Panel>
                  <Tabs.Panel id='tokens'>
                    <StateSyncTokens model={m} spaceId={space.id} />
                  </Tabs.Panel>
                  <Tabs.Panel id='examples'>
                    <StateSyncExamples spaceId={space.id} />
                  </Tabs.Panel>
                  <Tabs.Panel id='settings'>
                    <StateSyncSettings model={m} space={space} />
                  </Tabs.Panel>
                </Tabs>
              </>
            )}
          </div>
        )}
        <StateSyncDialogs key={JSON.stringify(m.dialog)} model={m} />
      </Main>
    </>
  )
}

function SpaceList({ model: m }: { model: StateSyncModel }) {
  const columns: ColumnDef<StateSyncSpaceSummary>[] = [
    {
      id: 'name',
      header: '空间名称',
      enableSorting: false,
      cell: ({ row }) => (
        <Button variant='ghost' className='max-w-xs justify-start' onPress={() => m.select(row.original.id)}>
          <span className='truncate'>{row.original.name}</span>
        </Button>
      ),
    },
    {
      id: 'id',
      header: '空间 ID',
      enableSorting: false,
      cell: ({ row }) => (
        <div className='flex items-center gap-1'>
          <span className='font-mono text-xs text-muted'>{row.original.id}</span>
          <Button
            size='sm'
            variant='ghost'
            isIconOnly
            aria-label='复制空间 ID'
            onPress={() => void copySpaceId(row.original.id)}
          >
            <Copy className='size-3.5' />
          </Button>
        </div>
      ),
    },
    {
      id: 'docCount',
      header: '活跃房间',
      meta: { className: 'text-right tabular-nums' },
      enableSorting: false,
      cell: ({ row }) => row.original.docCount,
    },
    {
      id: 'onlineCount',
      header: '当前在线',
      meta: { className: 'text-right tabular-nums' },
      enableSorting: false,
      cell: ({ row }) => row.original.onlineCount,
    },
    {
      id: 'tokenCount',
      header: '有效凭证',
      meta: { className: 'text-right tabular-nums' },
      enableSorting: false,
      cell: ({ row }) => row.original.tokenCount,
    },
    {
      id: 'defaultDocTtlSeconds',
      header: '默认 TTL',
      meta: { className: 'tabular-nums' },
      enableSorting: false,
      cell: ({ row }) => formatTtlSeconds(row.original.defaultDocTtlSeconds),
    },
    {
      id: 'createdAt',
      header: '创建时间',
      enableSorting: false,
      cell: ({ row }) => <RelativeTime value={row.original.createdAt} />,
    },
    {
      id: 'actions',
      header: '操作',
      enableSorting: false,
      enableHiding: false,
      cell: ({ row }) => (
        <Button
          size='sm'
          variant='danger-soft'
          onPress={() => m.setDialog({ kind: 'deleteSpaceFromList', space: row.original })}
        >
          删除
        </Button>
      ),
    },
  ]

  const rows = m.spaces.data?.data ?? []

  return (
    <ServerDataTable
      columns={columns}
      data={rows}
      isLoading={m.spaces.isLoading}
      error={m.spaces.error}
      onRetry={() => void m.spaces.refetch()}
      emptyMessage='暂无同步空间'
      page={1}
      pageSize={50}
      total={rows.length}
      onPageChange={noPageChange}
      onPageSizeChange={noPageChange}
      showPagination={false}
      clampPage={false}
      toolbar={
        <div className='flex flex-wrap items-center justify-end gap-2'>
          <Button variant='secondary' onPress={() => void m.spaces.refetch()}><RefreshCw />刷新</Button>
          <Button onPress={() => m.setDialog({ kind: 'createSpace' })}><Plus />创建空间</Button>
        </div>
      }
    />
  )
}

function StateSyncSettings({ model: m, space }: { model: StateSyncModel; space: StateSyncSpaceSummary }) {
  const [name, setName] = useState(space.name)
  const [description, setDescription] = useState(space.description)
  const [neverExpire, setNeverExpire] = useState(space.defaultDocTtlSeconds === null)
  const [ttlSecondsText, setTtlSecondsText] = useState(
    String(space.defaultDocTtlSeconds ?? STATE_SYNC_TTL_DEFAULT_SECONDS),
  )
  const [maxDocsText, setMaxDocsText] = useState(String(space.maxDocs))

  useEffect(() => {
    setName(space.name)
    setDescription(space.description)
    setNeverExpire(space.defaultDocTtlSeconds === null)
    setTtlSecondsText(String(space.defaultDocTtlSeconds ?? STATE_SYNC_TTL_DEFAULT_SECONDS))
    setMaxDocsText(String(space.maxDocs))
  }, [space.id, space.name, space.description, space.defaultDocTtlSeconds, space.maxDocs])

  function handleSave() {
    const trimmedName = name.trim()
    if (!trimmedName) {
      toast.danger('请输入空间名称')
      return
    }
    let defaultDocTtlSeconds: number | null = null
    if (!neverExpire) {
      const parsedTtl = Number(ttlSecondsText.trim())
      if (
        !Number.isInteger(parsedTtl)
        || parsedTtl < STATE_SYNC_TTL_MIN_SECONDS
        || parsedTtl > STATE_SYNC_TTL_MAX_SECONDS
      ) {
        toast.danger(`默认 TTL 须为 ${STATE_SYNC_TTL_MIN_SECONDS} 至 ${STATE_SYNC_TTL_MAX_SECONDS} 秒之间的整数`)
        return
      }
      defaultDocTtlSeconds = parsedTtl
    }
    const parsedMaxDocs = Number(maxDocsText.trim())
    if (!Number.isInteger(parsedMaxDocs) || parsedMaxDocs < 1 || parsedMaxDocs > STATE_SYNC_MAX_DOCS_CAP) {
      toast.danger(`最大房间数须为 1 至 ${STATE_SYNC_MAX_DOCS_CAP} 之间的整数`)
      return
    }
    m.updateSpace.mutate({
      id: space.id,
      body: {
        name: trimmedName,
        description: description.trim(),
        defaultDocTtlSeconds,
        maxDocs: parsedMaxDocs,
      },
    })
  }

  return (
    <div className='max-w-2xl space-y-4'>
      <Card className='shadow-none'>
        <Card.Header>
          <Card.Title className='text-base'>基础信息与配额</Card.Title>
        </Card.Header>
        <Card.Content className='space-y-4'>
          <TextField value={name} onChange={setName} isRequired>
            <Label>空间名称</Label>
            <Input variant='secondary' aria-label='空间名称' />
          </TextField>
          <TextField value={description} onChange={setDescription}>
            <Label>用途说明</Label>
            <TextArea variant='secondary' aria-label='用途说明' rows={4} />
          </TextField>
          <Checkbox variant='secondary' isSelected={neverExpire} onChange={setNeverExpire}>
            <Checkbox.Content>
              <Checkbox.Control><Checkbox.Indicator /></Checkbox.Control>
              <Label>默认房间永不过期</Label>
            </Checkbox.Content>
          </Checkbox>
          {!neverExpire && (
            <TextField value={ttlSecondsText} onChange={setTtlSecondsText}>
              <Label>默认房间 TTL（秒）</Label>
              <Input variant='secondary' aria-label='默认房间 TTL（秒）' inputMode='numeric' />
            </TextField>
          )}
          <TextField value={maxDocsText} onChange={setMaxDocsText}>
            <Label>最大房间数（1–500）</Label>
            <Input variant='secondary' aria-label='最大房间数' inputMode='numeric' />
          </TextField>
        </Card.Content>
        <Card.Footer className='flex justify-end'>
          <Button
            isPending={m.updateSpace.isPending}
            isDisabled={!name.trim()}
            onPress={handleSave}
          >
            保存更改
          </Button>
        </Card.Footer>
      </Card>

      <Card className='shadow-none'>
        <Card.Header>
          <Card.Title className='text-base'>危险操作</Card.Title>
          <Card.Description>删除同步空间后将立即踢断全部连接并销毁所有房间与空间凭证。</Card.Description>
        </Card.Header>
        <Card.Footer>
          <Button variant='danger-soft' onPress={() => m.setDialog({ kind: 'deleteSpace' })}>删除空间</Button>
        </Card.Footer>
      </Card>
    </div>
  )
}
