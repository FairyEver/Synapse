import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from '@heroui/react'
import type { ChannelRole } from '@synapse/shared/channel-contracts'
import { useAuthStore } from '@/stores/auth-store'
import { channelApi } from './channel-api'

export type ChannelDialogState =
  | null
  | { kind: 'create' }
  | { kind: 'deleteChannel' }

export function useChannels() {
  const session = useAuthStore((s) => s.auth.user?.sessionId ?? 'anonymous')
  const cache = useQueryClient()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [tab, setTab] = useState('debugger')
  const [dialog, setDialog] = useState<ChannelDialogState>(null)

  useEffect(() => () => {
    void cache.cancelQueries({ queryKey: ['channels', session] })
  }, [cache, session])

  const channels = useQuery({
    queryKey: ['channels', session, 'list'],
    queryFn: ({ signal }) => channelApi.list(signal),
  })

  const detail = useQuery({
    queryKey: ['channels', session, 'detail', selectedId],
    queryFn: ({ signal }) => channelApi.get(selectedId!, signal),
    enabled: Boolean(selectedId),
  })

  const tokens = useQuery({
    queryKey: ['channels', session, 'tokens', selectedId],
    queryFn: ({ signal }) => channelApi.listTokens(selectedId!, signal),
    enabled: Boolean(selectedId && tab === 'tokens'),
  })

  const state = useQuery({
    queryKey: ['channels', session, 'state', selectedId],
    queryFn: ({ signal }) => channelApi.getState(selectedId!, signal),
    enabled: Boolean(selectedId && tab === 'retained'),
  })

  const invalidate = () => void cache.invalidateQueries({ queryKey: ['channels', session] })

  const createChannel = useMutation({
    mutationFn: (body: { name: string; description: string }) => channelApi.create(body),
    onSuccess: (created) => {
      setDialog(null)
      setSelectedId(created.id)
      setTab('debugger')
      invalidate()
      toast.success('频道已创建')
    },
    onError: (e: Error) => toast.danger(e.message),
  })

  const updateChannel = useMutation({
    mutationFn: ({ id, body }: { id: string; body: { name?: string; description?: string } }) =>
      channelApi.update(id, body),
    onSuccess: () => {
      invalidate()
      toast.success('设置已保存')
    },
    onError: (e: Error) => toast.danger(e.message),
  })

  const deleteChannel = useMutation({
    mutationFn: (id: string) => channelApi.remove(id),
    onSuccess: () => {
      setDialog(null)
      setSelectedId(null)
      invalidate()
      toast.success('频道已删除')
    },
    onError: (e: Error) => toast.danger(e.message),
  })

  const createToken = useMutation({
    mutationFn: ({ id, body }: { id: string; body: { name: string; role: ChannelRole } }) =>
      channelApi.createToken(id, body),
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast.danger(e.message),
  })

  const revokeToken = useMutation({
    mutationFn: ({ id, tokenId }: { id: string; tokenId: string }) =>
      channelApi.revokeToken(id, tokenId),
    onSuccess: () => {
      invalidate()
      toast.success('凭证已撤销')
    },
    onError: (e: Error) => toast.danger(e.message),
  })

  const clearRetained = useMutation({
    mutationFn: ({ id, event }: { id: string; event: string }) =>
      channelApi.clearRetained(id, event),
    onSuccess: () => {
      invalidate()
      toast.success('已清除状态快照')
    },
    onError: (e: Error) => toast.danger(e.message),
  })

  return {
    selectedId,
    select: (id: string | null) => {
      setSelectedId(id)
      setTab('debugger')
    },
    tab,
    setTab,
    dialog,
    setDialog,
    channels,
    detail,
    tokens,
    state,
    createChannel,
    updateChannel,
    deleteChannel,
    createToken,
    revokeToken,
    clearRetained,
  }
}

export type ChannelsModel = ReturnType<typeof useChannels>
