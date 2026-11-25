import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Card, Checkbox, Chip, Input, Label, TextArea, TextField, toast } from '@heroui/react'
import { Pause, Play, Plug, Send, Trash2, Unplug } from 'lucide-react'
import type { ChannelPresenceMember } from '@synapse/shared/channel-contracts'
import { buildChannelWsUrl, channelApi } from './channel-api'

type DebugLogItem = {
  id: string
  kind: 'event' | 'presence' | 'ack' | 'error' | 'system'
  event?: string
  seq?: number
  summary: string
  payloadText?: string
  at: string
}

const MAX_DEBUG_LOGS = 200

const roleLabels: Record<string, string> = {
  subscribe: '仅订阅',
  publish: '仅发布',
  pubsub: '双向',
}

export function ChannelDebugger({ channelId }: { channelId: string }) {
  const wsRef = useRef<WebSocket | null>(null)
  const pausedRef = useRef(false)
  const [status, setStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected')
  const [presence, setPresence] = useState<ChannelPresenceMember[]>([])
  const [logs, setLogs] = useState<DebugLogItem[]>([])
  const [paused, setPaused] = useState(false)
  const [filter, setFilter] = useState('')
  const [eventName, setEventName] = useState('test.ping')
  const [payloadText, setPayloadText] = useState('{"hello":"world"}')
  const [retain, setRetain] = useState(false)
  const [targetClientId, setTargetClientId] = useState('')

  useEffect(() => {
    pausedRef.current = paused
  }, [paused])

  useEffect(() => () => {
    wsRef.current?.close(1000, 'debugger unmount')
    wsRef.current = null
  }, [channelId])

  function pushLog(entry: Omit<DebugLogItem, 'id' | 'at'>) {
    if (pausedRef.current) return
    const item: DebugLogItem = {
      ...entry,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      at: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
    }
    setLogs((current) => [item, ...current].slice(0, MAX_DEBUG_LOGS))
  }

  async function connect() {
    if (status !== 'disconnected') return
    setStatus('connecting')
    try {
      const { ticket } = await channelApi.issueDebugTicket(channelId)
      const ws = new WebSocket(buildChannelWsUrl(channelId))
      wsRef.current = ws

      ws.onopen = () => {
        ws.send(JSON.stringify({
          type: 'auth',
          token: ticket,
          includeRetained: true,
        }))
      }

      ws.onmessage = (event) => {
        let msg: Record<string, unknown>
        try {
          msg = JSON.parse(String(event.data)) as Record<string, unknown>
        } catch {
          return
        }
        const type = String(msg.type ?? '')
        if (type === 'ready') {
          setStatus('connected')
          setPresence(Array.isArray(msg.presence) ? (msg.presence as ChannelPresenceMember[]) : [])
          pushLog({ kind: 'system', summary: `已连接调试台（隐身观察者，latestSeq=${String(msg.latestSeq ?? 0)}）` })
          return
        }
        if (type === 'presence.join' && msg.member) {
          const member = msg.member as ChannelPresenceMember
          setPresence((cur) => [...cur.filter((m) => m.connectionId !== member.connectionId), member])
          pushLog({ kind: 'presence', summary: `上线：${member.clientName ?? member.clientId}（${roleLabels[member.role] ?? member.role}）` })
          return
        }
        if (type === 'presence.update' && msg.member) {
          const member = msg.member as ChannelPresenceMember
          setPresence((cur) => cur.map((m) => (m.connectionId === member.connectionId ? member : m)))
          pushLog({ kind: 'presence', summary: `状态更新：${member.clientName ?? member.clientId}` })
          return
        }
        if (type === 'presence.leave' && msg.member) {
          const member = msg.member as ChannelPresenceMember
          setPresence((cur) => cur.filter((m) => m.connectionId !== member.connectionId))
          pushLog({ kind: 'presence', summary: `离线：${member.clientName ?? member.clientId}` })
          return
        }
        if (type === 'event') {
          const sender = msg.sender as { clientName?: string | null; clientId?: string | null } | undefined
          pushLog({
            kind: 'event',
            event: String(msg.event ?? ''),
            seq: typeof msg.seq === 'number' ? msg.seq : undefined,
            summary: `${String(msg.event ?? '')}${msg.retain ? ' [Retain]' : ''}${msg.targeted ? ' [定向]' : ''}${sender?.clientName || sender?.clientId ? ` · 来自 ${sender.clientName ?? sender.clientId}` : ''}`,
            payloadText: JSON.stringify(msg.payload, null, 2),
          })
          return
        }
        if (type === 'ack') {
          pushLog({ kind: 'ack', summary: `发送回执：seq=${String(msg.seq ?? '-')}, 送达=${String(msg.deliveredCount ?? 0)}` })
          return
        }
        if (type === 'error') {
          pushLog({ kind: 'error', summary: `错误 [${String(msg.code ?? 'ERROR')}]：${String(msg.message ?? '')}` })
        }
      }

      ws.onclose = (ev) => {
        if (wsRef.current === ws) wsRef.current = null
        setStatus('disconnected')
        setPresence([])
        pushLog({ kind: 'system', summary: `连接已关闭（code=${ev.code}）` })
      }

      ws.onerror = () => {
        toast.danger('调试台 WebSocket 连接异常')
      }
    } catch (error) {
      setStatus('disconnected')
      toast.danger(error instanceof Error ? error.message : '获取调试票据失败')
    }
  }

  function disconnect() {
    wsRef.current?.close(1000, 'manual disconnect')
    wsRef.current = null
    setStatus('disconnected')
    setPresence([])
  }

  function sendTestEvent() {
    const ws = wsRef.current
    if (!ws || status !== 'connected') return
    const trimmedEvent = eventName.trim()
    if (!trimmedEvent) {
      toast.danger('请输入事件名')
      return
    }
    let parsedPayload: unknown
    try {
      parsedPayload = JSON.parse(payloadText)
    } catch {
      toast.danger('载荷必须是合法 JSON')
      return
    }
    const trimmedTarget = targetClientId.trim()
    if (retain && trimmedTarget) {
      toast.danger('定向投递不允许同时启用 Retain')
      return
    }
    ws.send(JSON.stringify({
      type: 'publish',
      id: `dbg-${Date.now()}`,
      event: trimmedEvent,
      payload: parsedPayload,
      retain,
      echo: true,
      ...(trimmedTarget ? { targetClientId: trimmedTarget } : {}),
    }))
  }

  const visibleLogs = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return logs
    return logs.filter((item) =>
      `${item.event ?? ''} ${item.summary} ${item.payloadText ?? ''}`.toLowerCase().includes(q),
    )
  }, [logs, filter])

  return (
    <div className='space-y-4'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <div className='flex flex-wrap items-center gap-2'>
          <Chip variant='soft' color={status === 'connected' ? 'success' : status === 'connecting' ? 'warning' : 'default'}>
            {status === 'connected' ? '调试中（隐身）' : status === 'connecting' ? '连接中' : '未连接'}
          </Chip>
          <span className='text-sm text-muted'>在线客户端：{presence.length}</span>
        </div>
        <div className='flex flex-wrap gap-2'>
          {status === 'disconnected' ? (
            <Button onPress={() => void connect()}><Plug />连接调试</Button>
          ) : (
            <Button variant='secondary' onPress={disconnect}><Unplug />断开连接</Button>
          )}
        </div>
      </div>

      <div className='grid gap-4 lg:grid-cols-[minmax(0,260px)_minmax(0,1fr)]'>
        <Card className='shadow-none'>
          <Card.Header>
            <Card.Title className='text-base'>在线成员（{presence.length}）</Card.Title>
          </Card.Header>
          <Card.Content className='space-y-2'>
            {presence.length === 0 ? (
              <p className='text-sm text-muted'>{status === 'connected' ? '暂无在线客户端' : '连接调试台后实时显示在线成员'}</p>
            ) : presence.map((member) => (
              <div key={member.connectionId} className='rounded-lg border border-border bg-surface-secondary p-2.5 text-sm'>
                <div className='flex items-center justify-between gap-2'>
                  <span className='truncate font-medium' title={member.clientName ?? member.clientId}>
                    {member.clientName ?? member.clientId}
                  </span>
                  <Chip size='sm' variant='soft'>{roleLabels[member.role] ?? member.role}</Chip>
                </div>
                <div className='mt-1 truncate font-mono text-xs text-muted'>{member.clientId}</div>
              </div>
            ))}
          </Card.Content>
        </Card>

        <Card className='min-w-0 shadow-none'>
          <Card.Header className='flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between'>
            <Card.Title className='text-base'>实时事件流</Card.Title>
            <div className='flex flex-wrap items-center gap-2'>
              <Input
                variant='secondary'
                aria-label='筛选事件'
                placeholder='按事件名或内容筛选'
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className='w-44'
              />
              <Button size='sm' variant='secondary' onPress={() => setPaused((p) => !p)}>
                {paused ? <Play /> : <Pause />}
                {paused ? '继续' : '暂停'}
              </Button>
              <Button size='sm' variant='ghost' onPress={() => setLogs([])}>
                <Trash2 />
                清空
              </Button>
            </div>
          </Card.Header>
          <Card.Content>
            <div className='max-h-80 space-y-2 overflow-y-auto'>
              {visibleLogs.length === 0 ? (
                <p className='py-8 text-center text-sm text-muted'>暂无实时事件记录</p>
              ) : visibleLogs.map((item) => (
                <div key={item.id} className='rounded-lg border border-border bg-surface-secondary p-3 text-sm'>
                  <div className='flex flex-wrap items-center justify-between gap-2'>
                    <span className='font-medium'>{item.summary}</span>
                    <span className='font-mono text-xs text-muted'>
                      {item.seq !== undefined ? `#${item.seq} · ` : ''}{item.at}
                    </span>
                  </div>
                  {item.payloadText && (
                    <pre className='mt-2 overflow-x-auto whitespace-pre-wrap break-all font-mono text-xs text-muted'>
                      {item.payloadText}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          </Card.Content>
        </Card>
      </div>

      <Card className='shadow-none'>
        <Card.Header>
          <Card.Title className='text-base'>发送测试事件</Card.Title>
        </Card.Header>
        <Card.Content className='space-y-3'>
          <div className='grid gap-3 sm:grid-cols-2'>
            <TextField value={eventName} onChange={setEventName} isRequired>
              <Label>事件名</Label>
              <Input variant='secondary' placeholder='例如 slide.next' />
            </TextField>
            <TextField value={targetClientId} onChange={setTargetClientId}>
              <Label>定向 clientId（可选）</Label>
              <Input variant='secondary' placeholder='留空则广播全频道' />
            </TextField>
          </div>
          <TextField value={payloadText} onChange={setPayloadText}>
            <Label>JSON 载荷</Label>
            <TextArea variant='secondary' rows={3} className='font-mono' />
          </TextField>
          <div className='flex flex-wrap items-center justify-between gap-3'>
            <Checkbox variant='secondary' isSelected={retain} onChange={setRetain} isDisabled={Boolean(targetClientId.trim())}>
              <Checkbox.Content>
                <Checkbox.Control><Checkbox.Indicator /></Checkbox.Control>
                <Label>保留最新状态（Retain）</Label>
              </Checkbox.Content>
            </Checkbox>
            <Button isDisabled={status !== 'connected'} onPress={sendTestEvent}>
              <Send />
              发送事件
            </Button>
          </div>
        </Card.Content>
      </Card>
    </div>
  )
}
