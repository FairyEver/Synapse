import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { DriveMessageApiContext } from '@/lib/api'
import { trackedDriveMessageApi as api } from './shared/drive-telemetry-api'

export type DriveMessageContext = DriveMessageApiContext

export function driveMessagesQueryKey(context: DriveMessageContext) {
  return context.context === 'owner'
    ? ['drive-messages', 'owner', context.itemId] as const
    : ['drive-messages', 'share', context.shareId, context.itemId ?? null] as const
}

export function useDriveMessages(context: DriveMessageContext | undefined) {
  const client = useQueryClient()
  const queryKey = context ? driveMessagesQueryKey(context) : ['drive-messages', 'disabled'] as const
  const query = useQuery({
    queryKey,
    enabled: Boolean(context),
    refetchOnWindowFocus: true,
    queryFn: () => context ? api.list(context) : Promise.resolve({ itemId: '', canPost: false, messages: [] }),
  })
  const invalidate = () => client.invalidateQueries({ queryKey })
  const create = useMutation({ mutationFn: (body: string) => {
    if (!context) throw new Error('Drive message context is missing.')
    return api.create(context, body)
  }, onSuccess: invalidate })
  const update = useMutation({ mutationFn: (input: { messageId: string; body: string }) => {
    if (!context) throw new Error('Drive message context is missing.')
    return api.update(context, input.messageId, input.body)
  }, onSuccess: invalidate })
  const remove = useMutation({ mutationFn: (messageId: string) => {
    if (!context) throw new Error('Drive message context is missing.')
    return api.delete(context, messageId)
  }, onSuccess: invalidate })
  const reply = useMutation({ mutationFn: (input: { messageId: string; parentCommentId: string | null; body: string }) => {
    if (!context) throw new Error('Drive message context is missing.')
    return api.reply(context, input.messageId, input.parentCommentId, input.body)
  }, onSuccess: invalidate })
  const updateComment = useMutation({ mutationFn: (input: { commentId: string; body: string }) => {
    if (!context) throw new Error('Drive message context is missing.')
    return api.updateComment(context, input.commentId, input.body)
  }, onSuccess: invalidate })
  const deleteComment = useMutation({ mutationFn: (commentId: string) => {
    if (!context) throw new Error('Drive message context is missing.')
    return api.deleteComment(context, commentId)
  }, onSuccess: invalidate })
  return {
    messages: query.data?.messages ?? [],
    canPost: query.data?.canPost ?? false,
    loading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    refresh: query.refetch,
    create: create.mutateAsync,
    update: update.mutateAsync,
    delete: remove.mutateAsync,
    reply: reply.mutateAsync,
    updateComment: updateComment.mutateAsync,
    deleteComment: deleteComment.mutateAsync,
  }
}
