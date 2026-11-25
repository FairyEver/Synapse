import { useEffect, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { Button, Card, Input, Label, Tabs, TextArea, TextField, toast } from '@heroui/react'
import { ArrowLeft, Copy, Plus, RefreshCw } from 'lucide-react'
import { ServerDataTable } from '@/components/data-table'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { RelativeTime } from '@/components/relative-time'
import { useAuthStore } from '@/stores/auth-store'
import type { ChannelSummary } from './channel-api'
import { ChannelDebugger } from './channel-debugger'
import { ChannelDialogs } from './channel-dialogs'
import { ChannelExamples } from './channel-examples'
import { ChannelRetained } from './channel-retained'
import { ChannelTokens } from './channel-tokens'
import { useChannels, type ChannelsModel } from './use-channels'

const noPageChange = () => undefined

export default function ChannelsPage() {
  const session = useAuthStore((s) => s.auth.user?.sessionId ?? 'anonymous')
  return <ChannelsWorkspace key={session} />
}

function ChannelsWorkspace() {
  const m = useChannels()
  const channel = m.detail.data
  const title = channel?.name ?? '频道'

  return (
    <>
      <Header>
        {m.selectedId && (
          <Button variant='ghost' isIconOnly aria-label='返回频道列表' onPress={() => m.select(null)}>
            <ArrowLeft />
          </Button>
        )}
        <h1 className='min-w-0 truncate' title={title}>{title}</h1>
      </Header>
      <Main className='min-w-0'>
        {!m.selectedId ? (
          <ChannelList model={m} />
        ) : (
          <div className='space-y-4'>
            {m.detail.isLoading && <div className='text-sm text-muted'>加载中...</div>}
            {m.detail.error && (
              <div className='flex items-center gap-3'>
                <span className='text-sm text-danger'>
                  {m.detail.error instanceof Error ? m.detail.error.message : '加载频道失败'}
                </span>
                <Button variant='secondary' onPress={() => void m.detail.refetch()}>重试</Button>
              </div>
            )}
            {channel && (
              <>
                <div className='flex flex-wrap items-center justify-between gap-2'>
                  <div className='flex flex-wrap items-center gap-2 text-sm text-muted'>
                    <span className='font-mono'>{channel.id}</span>
                    <Button
                      size='sm'
                      variant='ghost'
                      onPress={() => {
                        void navigator.clipboard.writeText(channel.id)
                        toast.success('已复制频道 ID')
                      }}
                    >
                      <Copy />
                      复制 ID
                    </Button>
                  </div>
                </div>
                <Tabs selectedKey={m.tab} onSelectionChange={(key) => m.setTab(String(key))}>
                  <Tabs.ListContainer className='w-fit max-w-full overflow-x-auto'>
                    <Tabs.List aria-label='频道管理' className='w-max'>
                      <Tabs.Tab className='whitespace-nowrap' id='debugger'>实时调试台<Tabs.Indicator /></Tabs.Tab>
                      <Tabs.Tab className='whitespace-nowrap' id='tokens'>接入凭证<Tabs.Indicator /></Tabs.Tab>
                      <Tabs.Tab className='whitespace-nowrap' id='retained'>Retain 状态<Tabs.Indicator /></Tabs.Tab>
                      <Tabs.Tab className='whitespace-nowrap' id='examples'>接入示例<Tabs.Indicator /></Tabs.Tab>
                      <Tabs.Tab className='whitespace-nowrap' id='settings'>设置<Tabs.Indicator /></Tabs.Tab>
                    </Tabs.List>
                  </Tabs.ListContainer>
                  <Tabs.Panel id='debugger'>
                    <ChannelDebugger key={channel.id} channelId={channel.id} />
                  </Tabs.Panel>
                  <Tabs.Panel id='tokens'>
                    <ChannelTokens model={m} channelId={channel.id} />
                  </Tabs.Panel>
                  <Tabs.Panel id='retained'>
                    <ChannelRetained model={m} channelId={channel.id} />
                  </Tabs.Panel>
                  <Tabs.Panel id='examples'>
                    <ChannelExamples channelId={channel.id} />
                  </Tabs.Panel>
                  <Tabs.Panel id='settings'>
                    <ChannelSettings model={m} channel={channel} />
                  </Tabs.Panel>
                </Tabs>
              </>
            )}
          </div>
        )}
        <ChannelDialogs key={JSON.stringify(m.dialog)} model={m} />
      </Main>
    </>
  )
}

function ChannelList({ model: m }: { model: ChannelsModel }) {
  const columns: ColumnDef<ChannelSummary>[] = [
    {
      id: 'name',
      header: '频道名称',
      enableSorting: false,
      cell: ({ row }) => (
        <Button variant='ghost' className='max-w-xs justify-start' onPress={() => m.select(row.original.id)}>
          <span className='truncate'>{row.original.name}</span>
        </Button>
      ),
    },
    {
      id: 'id',
      header: '频道 ID',
      enableSorting: false,
      cell: ({ row }) => (
        <div className='flex items-center gap-1'>
          <span className='font-mono text-xs text-muted'>{row.original.id}</span>
          <Button
            size='sm'
            variant='ghost'
            isIconOnly
            aria-label='复制频道 ID'
            onPress={() => {
              void navigator.clipboard.writeText(row.original.id)
              toast.success('已复制频道 ID')
            }}
          >
            <Copy className='size-3.5' />
          </Button>
        </div>
      ),
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
      id: 'createdAt',
      header: '创建时间',
      enableSorting: false,
      cell: ({ row }) => <RelativeTime value={row.original.createdAt} />,
    },
  ]

  const rows = m.channels.data?.data ?? []

  return (
    <ServerDataTable
      columns={columns}
      data={rows}
      isLoading={m.channels.isLoading}
      error={m.channels.error}
      onRetry={() => void m.channels.refetch()}
      emptyMessage='暂无频道'
      page={1}
      pageSize={50}
      total={rows.length}
      onPageChange={noPageChange}
      onPageSizeChange={noPageChange}
      showPagination={false}
      clampPage={false}
      toolbar={
        <div className='flex flex-wrap items-center justify-end gap-2'>
          <Button variant='secondary' onPress={() => void m.channels.refetch()}><RefreshCw />刷新</Button>
          <Button onPress={() => m.setDialog({ kind: 'create' })}><Plus />创建频道</Button>
        </div>
      }
    />
  )
}

function ChannelSettings({ model: m, channel }: { model: ChannelsModel; channel: ChannelSummary }) {
  const [name, setName] = useState(channel.name)
  const [description, setDescription] = useState(channel.description)

  useEffect(() => {
    setName(channel.name)
    setDescription(channel.description)
  }, [channel.id, channel.name, channel.description])

  return (
    <div className='max-w-2xl space-y-4'>
      <Card className='shadow-none'>
        <Card.Header>
          <Card.Title className='text-base'>基础信息</Card.Title>
        </Card.Header>
        <Card.Content className='space-y-4'>
          <TextField value={name} onChange={setName} isRequired>
            <Label>频道名称</Label>
            <Input variant='secondary' />
          </TextField>
          <TextField value={description} onChange={setDescription}>
            <Label>用途说明</Label>
            <TextArea variant='secondary' rows={4} />
          </TextField>
        </Card.Content>
        <Card.Footer className='flex justify-end'>
          <Button
            isPending={m.updateChannel.isPending}
            isDisabled={!name.trim()}
            onPress={() => m.updateChannel.mutate({ id: channel.id, body: { name: name.trim(), description: description.trim() } })}
          >
            保存更改
          </Button>
        </Card.Footer>
      </Card>

      <Card className='shadow-none'>
        <Card.Header>
          <Card.Title className='text-base'>危险操作</Card.Title>
          <Card.Description>删除频道后将立即踢断全部连接并销毁凭证与 Retain 状态。</Card.Description>
        </Card.Header>
        <Card.Footer>
          <Button variant='danger-soft' onPress={() => m.setDialog({ kind: 'deleteChannel' })}>删除频道</Button>
        </Card.Footer>
      </Card>
    </div>
  )
}
