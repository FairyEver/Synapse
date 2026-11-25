import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Card, Checkbox, Chip, Input, Label, ListBox, Select, TextArea, TextField, toast } from '@heroui/react'
import { ChevronDown, ChevronRight, Pause, Play, Plug, Plus, RefreshCw, Send, Trash2, Unplug } from 'lucide-react'
import {
  STATE_SYNC_CUSTOM_DOC_ID_REGEX,
  STATE_SYNC_TTL_MAX_SECONDS,
  STATE_SYNC_TTL_MIN_SECONDS,
  applyStateSyncMutation,
  isPlainObject,
  parseStateSyncPath,
  type StateSyncMutationOp,
  type StateSyncPresenceMember,
} from '@synapse/shared/state-sync-contracts'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { CloudModal } from '@/features/cloud-tables/cloud-table-controls'
import {
  buildStateSyncWsUrl,
  formatExpiryCountdown,
  stateSyncApi,
  type StateSyncDocSummary,
  type StateSyncSpaceSummary,
} from './state-sync-api'
import type { StateSyncModel } from './use-state-sync'

type DebugLogItem = {
  id: string
  kind: 'mutation' | 'presence' | 'error' | 'system'
  rev?: number
  op?: string
  path?: string
  summary: string
  payloadText?: string
  at: string
}

const MAX_DEBUG_LOGS = 200

const roleLabels: Record<string, string> = {
  read: '仅读',
  write: '读写',
  create_write: '建房并读写',
}

const opOptions: { key: StateSyncMutationOp; name: string }[] = [
  { key: 'set', name: 'set（覆盖写入）' },
  { key: 'patch', name: 'patch（合并对象）' },
  { key: 'delete', name: 'delete（删除节点）' },
]

function applySnapshotList(
  snapshots: Array<{ path: string; exists: boolean; value: unknown }>,
): Record<string, unknown> {
  let root: Record<string, unknown> = {}
  for (const snap of snapshots) {
    if (snap.path === '/') {
      root = snap.exists && isPlainObject(snap.value) ? structuredClone(snap.value) : {}
      continue
    }
    if (!snap.exists) {
      const res = applyStateSyncMutation(root, { op: 'delete', path: snap.path })
      if (res.ok) root = res.nextRoot
    } else {
      const res = applyStateSyncMutation(root, { op: 'set', path: snap.path, value: snap.value })
      if (res.ok) root = res.nextRoot
    }
  }
  return root
}

export function StateSyncDebugger({
  model,
  space,
}: {
  model: StateSyncModel
  space: StateSyncSpaceSummary
}) {
  const wsRef = useRef<WebSocket | null>(null)
  const connectAttemptRef = useRef(0)
  const pausedRef = useRef(false)

  const [selectedDocId, setSelectedDocId] = useState<string | null>(null)
  const [status, setStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected')
  const [docData, setDocData] = useState<Record<string, unknown>>({})
  const [docRev, setDocRev] = useState<number>(0)
  const [docExpiresAt, setDocExpiresAt] = useState<string | null>(null)
  const [presence, setPresence] = useState<StateSyncPresenceMember[]>([])
  const [logs, setLogs] = useState<DebugLogItem[]>([])
  const [paused, setPaused] = useState(false)
  const [filter, setFilter] = useState('')
  const [nowMs, setNowMs] = useState(() => Date.now())

  // Mutation form state
  const [mutatePath, setMutatePath] = useState('/score')
  const [mutateOp, setMutateOp] = useState<StateSyncMutationOp>('set')
  const [mutateValueText, setMutateValueText] = useState('100')
  const [expectedRevText, setExpectedRevText] = useState('')
  const [mutating, setMutating] = useState(false)

  // Create / delete room dialogs
  const [createRoomOpen, setCreateRoomOpen] = useState(false)
  const [newDocId, setNewDocId] = useState('')
  const [newInitialData, setNewInitialData] = useState('{}')
  const [newNeverExpire, setNewNeverExpire] = useState(false)
  const [newTtlText, setNewTtlText] = useState('')
  const [deleteTargetDoc, setDeleteTargetDoc] = useState<StateSyncDocSummary | null>(null)

  useEffect(() => {
    pausedRef.current = paused
  }, [paused])

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])

  function pushLog(entry: Omit<DebugLogItem, 'id' | 'at'>) {
    if (pausedRef.current) return
    const item: DebugLogItem = {
      ...entry,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      at: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
    }
    setLogs((current) => [item, ...current].slice(0, MAX_DEBUG_LOGS))
  }

  function disconnectInternal() {
    connectAttemptRef.current += 1
    const existing = wsRef.current
    wsRef.current = null
    existing?.close(1000, 'debugger disconnect')
    setStatus('disconnected')
    setPresence([])
  }

  async function connectToDoc(docId: string) {
    disconnectInternal()
    const attemptId = connectAttemptRef.current + 1
    connectAttemptRef.current = attemptId
    setStatus('connecting')
    setDocData({})
    setDocRev(0)
    setDocExpiresAt(null)
    setPresence([])
    setLogs([])

    try {
      const { ticket } = await stateSyncApi.issueDebugTicket(space.id, docId)
      if (connectAttemptRef.current !== attemptId) return
      const ws = new WebSocket(buildStateSyncWsUrl(space.id, docId))
      wsRef.current = ws

      ws.onopen = () => {
        if (connectAttemptRef.current !== attemptId || wsRef.current !== ws) return
        ws.send(JSON.stringify({
          type: 'auth',
          token: ticket,
          paths: ['/'],
        }))
      }

      ws.onmessage = (event) => {
        if (connectAttemptRef.current !== attemptId || wsRef.current !== ws) return
        let msg: Record<string, unknown>
        try {
          msg = JSON.parse(String(event.data)) as Record<string, unknown>
        } catch {
          return
        }
        const type = String(msg.type ?? '')
        if (type === 'ready') {
          setStatus('connected')
          const readyRev = typeof msg.rev === 'number' ? msg.rev : 0
          setDocRev(readyRev)
          setDocExpiresAt(typeof msg.expiresAt === 'string' ? msg.expiresAt : null)
          setPresence(Array.isArray(msg.presence) ? (msg.presence as StateSyncPresenceMember[]) : [])
          const snapshots = Array.isArray(msg.snapshots)
            ? (msg.snapshots as Array<{ path: string; exists: boolean; value: unknown }>)
            : []
          setDocData(applySnapshotList(snapshots))
          pushLog({ kind: 'system', rev: readyRev, summary: `已连接房间 ${docId}（隐身观察者，rev ${readyRev}）` })
          return
        }
        if (type === 'mutation') {
          const op = msg.op as StateSyncMutationOp
          const path = typeof msg.path === 'string' ? msg.path : '/'
          const rev = typeof msg.rev === 'number' ? msg.rev : undefined
          const actor = msg.actor as { clientName?: string | null; clientId?: string | null } | undefined
          if (op === 'set' || op === 'patch' || op === 'delete') {
            setDocData((current) => {
              const applied = applyStateSyncMutation(current, { op, path, value: msg.value })
              return applied.ok ? applied.nextRoot : current
            })
          }
          if (rev !== undefined) setDocRev(rev)
          const actorLabel = actor?.clientName || actor?.clientId
          pushLog({
            kind: 'mutation',
            rev,
            op,
            path,
            summary: `${op.toUpperCase()} ${path}${actorLabel ? ` · ${actorLabel}` : ''}`,
            payloadText: op === 'delete' ? undefined : JSON.stringify(msg.value, null, 2),
          })
          return
        }
        if (type === 'snapshot') {
          const path = typeof msg.path === 'string' ? msg.path : '/'
          const exists = Boolean(msg.exists)
          const rev = typeof msg.rev === 'number' ? msg.rev : undefined
          setDocData((current) => {
            if (path === '/') {
              return exists && isPlainObject(msg.value) ? structuredClone(msg.value) : {}
            }
            const applied = applyStateSyncMutation(current, exists
              ? { op: 'set', path, value: msg.value }
              : { op: 'delete', path })
            return applied.ok ? applied.nextRoot : current
          })
          if (rev !== undefined) setDocRev(rev)
          return
        }
        if (type === 'presence.join' && msg.member) {
          const member = msg.member as StateSyncPresenceMember
          setPresence((cur) => [...cur.filter((m) => m.connectionId !== member.connectionId), member])
          pushLog({ kind: 'presence', summary: `上线：${member.clientName ?? member.clientId}（${roleLabels[member.role] ?? member.role}）` })
          return
        }
        if (type === 'presence.update' && msg.member) {
          const member = msg.member as StateSyncPresenceMember
          setPresence((cur) => cur.map((m) => (m.connectionId === member.connectionId ? member : m)))
          pushLog({ kind: 'presence', summary: `状态更新：${member.clientName ?? member.clientId}` })
          return
        }
        if (type === 'presence.leave' && msg.member) {
          const member = msg.member as StateSyncPresenceMember
          setPresence((cur) => cur.filter((m) => m.connectionId !== member.connectionId))
          pushLog({ kind: 'presence', summary: `离线：${member.clientName ?? member.clientId}` })
          return
        }
        if (type === 'error') {
          pushLog({ kind: 'error', summary: `错误 [${String(msg.code ?? 'ERROR')}]：${String(msg.message ?? '')}` })
        }
      }

      ws.onclose = (ev) => {
        if (connectAttemptRef.current !== attemptId || wsRef.current !== ws) return
        if (wsRef.current === ws) wsRef.current = null
        setStatus('disconnected')
        setPresence([])
        pushLog({ kind: 'system', summary: `连接已关闭（code=${ev.code}）` })
      }

      ws.onerror = () => {
        if (connectAttemptRef.current !== attemptId || wsRef.current !== ws) return
        toast.danger('调试台 WebSocket 连接异常')
      }
    } catch (error) {
      if (connectAttemptRef.current !== attemptId) return
      setStatus('disconnected')
      toast.danger(error instanceof Error ? error.message : '获取调试票据失败')
    }
  }

  useEffect(() => () => {
    connectAttemptRef.current += 1
    wsRef.current?.close(1000, 'debugger unmount')
    wsRef.current = null
  }, [space.id])

  function selectRoom(docId: string) {
    setSelectedDocId(docId)
    void connectToDoc(docId)
  }

  function closeCreateRoom() {
    setCreateRoomOpen(false)
    setNewDocId('')
    setNewInitialData('{}')
    setNewNeverExpire(false)
    setNewTtlText('')
  }

  async function handleCreateRoom() {
    const trimmedDocId = newDocId.trim()
    if (trimmedDocId && !STATE_SYNC_CUSTOM_DOC_ID_REGEX.test(trimmedDocId)) {
      toast.danger('自定义房间 ID 须为 3–64 位字母、数字或 . _ : -')
      return
    }
    let initialData: Record<string, unknown> | undefined
    const trimmedJson = newInitialData.trim()
    if (trimmedJson) {
      try {
        const parsed = JSON.parse(trimmedJson) as unknown
        if (!isPlainObject(parsed)) {
          toast.danger('初始数据必须是普通 JSON 对象')
          return
        }
        initialData = parsed
      } catch {
        toast.danger('初始数据必须是合法 JSON')
        return
      }
    }
    let ttlSeconds: number | null | undefined
    if (newNeverExpire) {
      ttlSeconds = null
    } else if (newTtlText.trim()) {
      const parsedTtl = Number(newTtlText.trim())
      if (
        !Number.isInteger(parsedTtl)
        || parsedTtl < STATE_SYNC_TTL_MIN_SECONDS
        || parsedTtl > STATE_SYNC_TTL_MAX_SECONDS
      ) {
        toast.danger(`TTL 须为 ${STATE_SYNC_TTL_MIN_SECONDS} 至 ${STATE_SYNC_TTL_MAX_SECONDS} 秒之间的整数`)
        return
      }
      ttlSeconds = parsedTtl
    }

    try {
      const created = await model.createDoc.mutateAsync({
        spaceId: space.id,
        body: {
          ...(trimmedDocId ? { docId: trimmedDocId } : {}),
          ...(initialData !== undefined ? { initialData } : {}),
          ...(ttlSeconds !== undefined ? { ttlSeconds } : {}),
        },
      })
      closeCreateRoom()
      selectRoom(created.docId)
    } catch {
      // Error toast already surfaced by useStateSync mutation onError.
    }
  }

  async function handleDeleteRoom() {
    if (!deleteTargetDoc) return
    const deletingId = deleteTargetDoc.docId
    try {
      await model.deleteDoc.mutateAsync({ spaceId: space.id, docId: deletingId })
      setDeleteTargetDoc(null)
      if (selectedDocId === deletingId) {
        disconnectInternal()
        setSelectedDocId(null)
        setDocData({})
        setDocRev(0)
        setDocExpiresAt(null)
      }
    } catch {
      // Error toast already surfaced by useStateSync mutation onError.
    }
  }

  async function handleMutateSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedDocId || mutating) return

    const trimmedPath = mutatePath.trim()
    const pathCheck = parseStateSyncPath(trimmedPath)
    if (!pathCheck.ok) {
      toast.danger(pathCheck.message)
      return
    }
    if (mutateOp === 'delete' && pathCheck.normalized === '/') {
      toast.danger('禁止删除根路径 /')
      return
    }

    let parsedValue: unknown
    if (mutateOp !== 'delete') {
      try {
        parsedValue = JSON.parse(mutateValueText)
      } catch {
        toast.danger('JSON 值格式无效')
        return
      }
      if ((mutateOp === 'patch' || pathCheck.normalized === '/') && !isPlainObject(parsedValue)) {
        toast.danger('patch 或根路径写入值必须为普通 JSON 对象')
        return
      }
    }

    let expectedRev: number | undefined
    const trimmedRev = expectedRevText.trim()
    if (trimmedRev) {
      const parsedRev = Number(trimmedRev)
      if (!Number.isInteger(parsedRev) || parsedRev < 0) {
        toast.danger('期望版本须为非负整数')
        return
      }
      expectedRev = parsedRev
    }

    setMutating(true)
    try {
      const result = await stateSyncApi.mutateDoc(space.id, selectedDocId, {
        op: mutateOp,
        path: pathCheck.normalized,
        ...(mutateOp !== 'delete' ? { value: parsedValue } : {}),
        ...(expectedRev !== undefined ? { expectedRev } : {}),
      })
      setDocRev(result.rev)
      if (result.expiresAt !== undefined) setDocExpiresAt(result.expiresAt)
      if (status !== 'connected') {
        setDocData((current) => {
          const applied = applyStateSyncMutation(current, {
            op: mutateOp,
            path: pathCheck.normalized,
            value: parsedValue,
          })
          return applied.ok ? applied.nextRoot : current
        })
        pushLog({
          kind: 'mutation',
          rev: result.rev,
          op: mutateOp,
          path: pathCheck.normalized,
          summary: `${mutateOp.toUpperCase()} ${pathCheck.normalized} · Console`,
          payloadText: mutateOp === 'delete' ? undefined : JSON.stringify(parsedValue, null, 2),
        })
      }
      void model.docs.refetch()
      toast.success(`写入成功（rev ${result.rev}）`)
    } catch (error) {
      const message = error instanceof Error ? error.message : '状态写入失败'
      pushLog({ kind: 'error', summary: `HTTP 写入失败：${message}` })
      toast.danger(message)
    } finally {
      setMutating(false)
    }
  }

  const docs = model.docs.data?.data ?? []

  const visibleLogs = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return logs
    return logs.filter((item) =>
      `${item.op ?? ''} ${item.path ?? ''} ${item.summary} ${item.payloadText ?? ''}`.toLowerCase().includes(q),
    )
  }, [logs, filter])

  return (
    <div className='space-y-4'>
      <div className='grid gap-4 lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)]'>
        <Card className='min-w-0 shadow-none'>
          <Card.Header className='flex flex-row items-center justify-between gap-2'>
            <Card.Title className='text-base'>活跃房间（{docs.length}）</Card.Title>
            <div className='flex items-center gap-1'>
              <Button size='sm' variant='ghost' isIconOnly aria-label='刷新房间列表' onPress={() => void model.docs.refetch()}>
                <RefreshCw />
              </Button>
              <Button size='sm' onPress={() => setCreateRoomOpen(true)}>
                <Plus />
                新建房间
              </Button>
            </div>
          </Card.Header>
          <Card.Content className='space-y-2'>
            {model.docs.isLoading ? (
              <p className='text-sm text-muted'>加载中...</p>
            ) : model.docs.error ? (
              <div className='flex items-center justify-between gap-2 text-sm text-danger'>
                <span>{model.docs.error instanceof Error ? model.docs.error.message : '加载房间失败'}</span>
                <Button size='sm' variant='secondary' onPress={() => void model.docs.refetch()}>重试</Button>
              </div>
            ) : docs.length === 0 ? (
              <p className='py-6 text-center text-sm text-muted'>暂无活跃房间</p>
            ) : (
              <div className='max-h-96 space-y-2 overflow-y-auto'>
                {docs.map((doc) => {
                  const isSelected = selectedDocId === doc.docId
                  return (
                    <div
                      key={doc.docId}
                      className={`rounded-lg border p-2.5 text-sm ${
                        isSelected ? 'border-accent bg-accent-soft' : 'border-border bg-surface-secondary'
                      }`}
                    >
                      <div className='flex items-center justify-between gap-1'>
                        <Button
                          size='sm'
                          variant='ghost'
                          className='min-w-0 flex-1 justify-start px-1 font-mono'
                          onPress={() => selectRoom(doc.docId)}
                        >
                          <span className='truncate'>{doc.docId}</span>
                        </Button>
                        <Button
                          size='sm'
                          variant='ghost'
                          isIconOnly
                          aria-label={`删除房间 ${doc.docId}`}
                          onPress={() => setDeleteTargetDoc(doc)}
                        >
                          <Trash2 className='size-3.5 text-danger' />
                        </Button>
                      </div>
                      <div className='mt-1 flex flex-wrap items-center gap-2 text-xs text-muted tabular-nums'>
                        <span>rev {isSelected && status === 'connected' ? docRev : doc.rev}</span>
                        <span>在线 {isSelected && status === 'connected' ? presence.length : doc.onlineCount}</span>
                        <span>{formatExpiryCountdown(doc.expiresAt, nowMs)}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </Card.Content>
        </Card>

        <div className='min-w-0 space-y-4'>
          <div className='flex flex-wrap items-center justify-between gap-2'>
            <div className='flex flex-wrap items-center gap-2'>
              <Chip variant='soft' color={status === 'connected' ? 'success' : status === 'connecting' ? 'warning' : 'default'}>
                {status === 'connected' ? '调试中（隐身）' : status === 'connecting' ? '连接中' : '未连接'}
              </Chip>
              {selectedDocId && (
                <>
                  <span className='font-mono text-sm'>{selectedDocId}</span>
                  <span className='text-sm text-muted tabular-nums'>rev {docRev}</span>
                  <span className='text-sm text-muted'>{formatExpiryCountdown(docExpiresAt, nowMs)}</span>
                </>
              )}
            </div>
            {selectedDocId && (
              <div className='flex flex-wrap gap-2'>
                {status === 'disconnected' ? (
                  <Button variant='secondary' onPress={() => void connectToDoc(selectedDocId)}>
                    <Plug />
                    连接调试
                  </Button>
                ) : (
                  <Button variant='secondary' onPress={disconnectInternal}>
                    <Unplug />
                    断开连接
                  </Button>
                )}
              </div>
            )}
          </div>

          <div className='grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,240px)]'>
            <Card className='min-w-0 shadow-none'>
              <Card.Header className='flex flex-row items-center justify-between gap-2'>
                <Card.Title className='text-base'>实时 JSON 状态树</Card.Title>
                <span className='font-mono text-xs text-muted tabular-nums'>rev {docRev}</span>
              </Card.Header>
              <Card.Content>
                {!selectedDocId ? (
                  <p className='py-8 text-center text-sm text-muted'>请先从左侧选择或新建一个房间</p>
                ) : (
                  <div className='max-h-80 overflow-auto rounded-lg border border-border bg-surface-secondary p-3 font-mono text-xs'>
                    <JsonTreeNode
                      name='/'
                      path='/'
                      value={docData}
                      depth={0}
                      onSelectPath={(path) => setMutatePath(path)}
                    />
                  </div>
                )}
              </Card.Content>
            </Card>

            <Card className='min-w-0 shadow-none'>
              <Card.Header>
                <Card.Title className='text-base'>在线成员（{presence.length}）</Card.Title>
              </Card.Header>
              <Card.Content className='space-y-2'>
                {presence.length === 0 ? (
                  <p className='text-sm text-muted'>{status === 'connected' ? '暂无在线客户端' : '连接房间后显示在线成员'}</p>
                ) : presence.map((member) => (
                  <div key={member.connectionId} className='rounded-lg border border-border bg-surface-secondary p-2.5 text-sm'>
                    <div className='flex items-center justify-between gap-2'>
                      <span className='truncate font-medium' title={member.clientName ?? member.clientId}>
                        {member.clientName ?? member.clientId}
                      </span>
                      <Chip size='sm' variant='soft'>{roleLabels[member.role] ?? member.role}</Chip>
                    </div>
                    <div className='mt-1 truncate font-mono text-xs text-muted'>{member.clientId}</div>
                    {Object.keys(member.meta).length > 0 && (
                      <div className='mt-1 truncate font-mono text-xs text-muted' title={JSON.stringify(member.meta)}>
                        {JSON.stringify(member.meta)}
                      </div>
                    )}
                  </div>
                ))}
              </Card.Content>
            </Card>
          </div>

          <Card className='shadow-none'>
            <Card.Header>
              <Card.Title className='text-base'>路径状态写入（HTTP PATCH）</Card.Title>
            </Card.Header>
            <Card.Content>
              <form className='space-y-3' onSubmit={(e) => void handleMutateSubmit(e)}>
                <div className='grid gap-3 sm:grid-cols-3'>
                  <TextField value={mutatePath} onChange={setMutatePath} isRequired>
                    <Label>目标路径</Label>
                    <Input
                      variant='secondary'
                      aria-label='目标路径'
                      placeholder='例如 /score 或 /players/p1'
                      autoCorrect='off'
                      autoCapitalize='none'
                      spellCheck={false}
                    />
                  </TextField>
                  <Select
                    variant='secondary'
                    aria-label='变更操作'
                    selectedKey={mutateOp}
                    onSelectionChange={(key) => key !== null && setMutateOp(String(key) as StateSyncMutationOp)}
                  >
                    <Label>操作类型</Label>
                    <Select.Trigger>
                      <Select.Value />
                      <Select.Indicator />
                    </Select.Trigger>
                    <Select.Popover>
                      <ListBox items={opOptions}>
                        {(item) => (
                          <ListBox.Item id={item.key} textValue={item.name}>
                            {item.name}
                            <ListBox.ItemIndicator />
                          </ListBox.Item>
                        )}
                      </ListBox>
                    </Select.Popover>
                  </Select>
                  <TextField value={expectedRevText} onChange={setExpectedRevText}>
                    <Label>期望版本（expectedRev，可选）</Label>
                    <Input
                      variant='secondary'
                      aria-label='期望版本（expectedRev，可选）'
                      inputMode='numeric'
                      placeholder='留空跳过 CAS 校验'
                    />
                  </TextField>
                </div>
                {mutateOp !== 'delete' && (
                  <TextField value={mutateValueText} onChange={setMutateValueText}>
                    <Label>JSON 值</Label>
                    <TextArea
                      variant='secondary'
                      aria-label='JSON 值'
                      rows={3}
                      className='font-mono'
                    />
                  </TextField>
                )}
                <div className='flex justify-end'>
                  <Button type='submit' isDisabled={!selectedDocId || mutating} isPending={mutating}>
                    <Send />
                    提交变更
                  </Button>
                </div>
              </form>
            </Card.Content>
          </Card>

          <Card className='min-w-0 shadow-none'>
            <Card.Header className='flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between'>
              <Card.Title className='text-base'>变更日志</Card.Title>
              <div className='flex flex-wrap items-center gap-2'>
                <Input
                  variant='secondary'
                  aria-label='筛选变更日志'
                  placeholder='按路径或内容筛选'
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
              <div className='max-h-72 space-y-2 overflow-y-auto'>
                {visibleLogs.length === 0 ? (
                  <p className='py-6 text-center text-sm text-muted'>暂无实时变更记录</p>
                ) : visibleLogs.map((item) => (
                  <div key={item.id} className='rounded-lg border border-border bg-surface-secondary p-3 text-sm'>
                    <div className='flex flex-wrap items-center justify-between gap-2'>
                      <span className='font-medium'>{item.summary}</span>
                      <span className='font-mono text-xs text-muted tabular-nums'>
                        {item.rev !== undefined ? `rev ${item.rev} · ` : ''}{item.at}
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
      </div>

      {createRoomOpen && (
        <CloudModal
          title='新建测试房间'
          saveLabel='创建房间'
          pending={model.createDoc.isPending}
          onClose={closeCreateRoom}
          onSave={() => void handleCreateRoom()}
        >
          <TextField value={newDocId} onChange={setNewDocId}>
            <Label>自定义房间 ID（可选）</Label>
            <Input
              variant='secondary'
              aria-label='自定义房间 ID（可选）'
              placeholder='留空由服务端生成随机 ID'
              autoCorrect='off'
              autoCapitalize='none'
              spellCheck={false}
            />
          </TextField>
          <TextField value={newInitialData} onChange={setNewInitialData}>
            <Label>初始 JSON 数据</Label>
            <TextArea
              variant='secondary'
              aria-label='初始 JSON 数据'
              rows={4}
              className='font-mono'
            />
          </TextField>
          <Checkbox variant='secondary' isSelected={newNeverExpire} onChange={setNewNeverExpire}>
            <Checkbox.Content>
              <Checkbox.Control><Checkbox.Indicator /></Checkbox.Control>
              <Label>永不过期（忽略空间默认 TTL）</Label>
            </Checkbox.Content>
          </Checkbox>
          {!newNeverExpire && (
            <TextField value={newTtlText} onChange={setNewTtlText}>
              <Label>过期时间（秒，可选）</Label>
              <Input
                variant='secondary'
                aria-label='过期时间（秒，可选）'
                inputMode='numeric'
                placeholder={space.defaultDocTtlSeconds ? `留空沿用空间默认（${space.defaultDocTtlSeconds} 秒）` : '留空沿用空间默认（永不过期）'}
              />
            </TextField>
          )}
        </CloudModal>
      )}

      <ConfirmDialog
        open={Boolean(deleteTargetDoc)}
        onOpenChange={(open) => !open && setDeleteTargetDoc(null)}
        title='删除房间'
        desc={`删除房间「${deleteTargetDoc?.docId ?? ''}」后将立即踢断该房间的所有在线连接并销毁状态数据，无法恢复。`}
        confirmText='删除'
        destructive
        isLoading={model.deleteDoc.isPending}
        handleConfirm={() => void handleDeleteRoom()}
      />
    </div>
  )
}

function JsonTreeNode({
  name,
  path,
  value,
  depth,
  onSelectPath,
}: {
  name: string
  path: string
  value: unknown
  depth: number
  onSelectPath: (path: string) => void
}) {
  const [expanded, setExpanded] = useState(depth < 3)
  const isObject = value !== null && typeof value === 'object'
  const isArray = Array.isArray(value)
  const entries = isObject
    ? (isArray ? value.map((v, i) => [String(i), v] as const) : Object.entries(value as Record<string, unknown>))
    : []

  if (!isObject) {
    return (
      <div className='flex items-baseline gap-1.5 py-0.5'>
        <button
          type='button'
          className='text-left text-accent hover:underline'
          title={`选中路径 ${path}`}
          onClick={() => onSelectPath(path)}
        >
          {name}:
        </button>
        <span className={typeof value === 'string' ? 'text-success break-all' : 'text-foreground break-all'}>
          {JSON.stringify(value)}
        </span>
      </div>
    )
  }

  const openBracket = isArray ? '[' : '{'
  const closeBracket = isArray ? ']' : '}'

  return (
    <div>
      <div className='flex items-center gap-1 py-0.5'>
        <button
          type='button'
          className='inline-flex items-center text-muted hover:text-foreground'
          aria-label={expanded ? `折叠 ${path}` : `展开 ${path}`}
          aria-expanded={expanded}
          onClick={() => setExpanded((prev) => !prev)}
        >
          {expanded ? <ChevronDown className='size-3.5' /> : <ChevronRight className='size-3.5' />}
        </button>
        <button
          type='button'
          className='text-left font-medium text-accent hover:underline'
          title={`选中路径 ${path}`}
          onClick={() => onSelectPath(path)}
        >
          {name}
        </button>
        <span className='text-muted'>
          {expanded ? openBracket : `${openBracket}${entries.length} 项${closeBracket}`}
        </span>
      </div>
      {expanded && (
        <div>
          <div className='ms-3.5 border-l border-separator ps-2'>
            {entries.length === 0 ? (
              <div className='text-muted'>（空）</div>
            ) : entries.map(([key, childValue]) => {
              const childPath = path === '/' ? `/${key}` : `${path}/${key}`
              return (
                <JsonTreeNode
                  key={childPath}
                  name={key}
                  path={childPath}
                  value={childValue}
                  depth={depth + 1}
                  onSelectPath={onSelectPath}
                />
              )
            })}
          </div>
          <div className='text-muted'>{closeBracket}</div>
        </div>
      )}
    </div>
  )
}
