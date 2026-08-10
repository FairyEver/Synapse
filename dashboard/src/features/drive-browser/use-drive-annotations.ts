import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  DriveAnnotationCommentUpdateInput,
  DriveAnnotationCreateInput,
  DriveAnnotationAnchorUpdateInput,
  DriveAnnotationReplyInput,
  DriveAnnotationThreadDto,
} from '@synapse/shared'
import { driveAnnotationApi } from '@/lib/api'

export type DriveAnnotationContext =
  | { readonly context: 'owner'; readonly itemId: string }
  | { readonly context: 'share'; readonly shareId: string; readonly itemId?: string | null; readonly canComment?: boolean }

export function driveAnnotationsQueryKey(input: DriveAnnotationContext) {
  return input.context === 'owner'
    ? ['drive-annotations', 'owner', input.itemId] as const
    : ['drive-annotations', 'share', input.shareId, input.itemId ?? null] as const
}

export function useDriveAnnotations(input: DriveAnnotationContext | null | undefined) {
  const queryClient = useQueryClient()
  const queryKey = input ? driveAnnotationsQueryKey(input) : ['drive-annotations', 'disabled'] as const
  const query = useQuery({
    queryKey,
    enabled: Boolean(input),
    queryFn: () => {
      if (!input) return Promise.resolve([] as DriveAnnotationThreadDto[])
      return input.context === 'owner'
        ? driveAnnotationApi.listOwner(input.itemId)
        : driveAnnotationApi.listShare(input.shareId, input.itemId)
    },
  })
  const invalidate = async () => {
    if (!input) return
    await queryClient.invalidateQueries({ queryKey })
  }
  const createMutation = useMutation({
    mutationFn: (body: DriveAnnotationCreateInput) => {
      if (!input) throw new Error('Drive annotation context is missing.')
      return input.context === 'owner'
        ? driveAnnotationApi.createOwner(input.itemId, body)
        : driveAnnotationApi.createShare(input.shareId, input.itemId, body)
    },
    onSuccess: invalidate,
  })
  const replyMutation = useMutation({
    mutationFn: (variables: { readonly threadId: string } & DriveAnnotationReplyInput) => {
      if (!input) throw new Error('Drive annotation context is missing.')
      const { threadId, ...body } = variables
      return input.context === 'owner'
        ? driveAnnotationApi.replyOwner(input.itemId, threadId, body)
        : driveAnnotationApi.replyShare(input.shareId, input.itemId, threadId, body)
    },
    onSuccess: invalidate,
  })
  const updateMutation = useMutation({
    mutationFn: (variables: { readonly commentId: string } & DriveAnnotationCommentUpdateInput) => {
      if (!input) throw new Error('Drive annotation context is missing.')
      const { commentId, ...body } = variables
      return input.context === 'owner'
        ? driveAnnotationApi.updateOwnerComment(input.itemId, commentId, body)
        : driveAnnotationApi.updateShareComment(input.shareId, input.itemId, commentId, body)
    },
    onSuccess: invalidate,
  })
  const deleteCommentMutation = useMutation({
    mutationFn: (commentId: string) => {
      if (!input) throw new Error('Drive annotation context is missing.')
      return input.context === 'owner'
        ? driveAnnotationApi.deleteOwnerComment(input.itemId, commentId)
        : driveAnnotationApi.deleteShareComment(input.shareId, input.itemId, commentId)
    },
    onSuccess: invalidate,
  })
  const updateAnchorMutation = useMutation({
    mutationFn: (variables: { readonly threadId: string } & DriveAnnotationAnchorUpdateInput) => {
      if (!input) throw new Error('Drive annotation context is missing.')
      const { threadId, ...body } = variables
      return input.context === 'owner'
        ? driveAnnotationApi.updateOwnerAnchor(input.itemId, threadId, body)
        : driveAnnotationApi.updateShareAnchor(input.shareId, input.itemId, threadId, body)
    },
    onSuccess: invalidate,
  })

  return {
    threads: query.data ?? [] satisfies readonly DriveAnnotationThreadDto[],
    loading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    refresh: query.refetch,
    createThread: createMutation.mutateAsync,
    creatingThread: createMutation.isPending,
    reply: replyMutation.mutateAsync,
    replying: replyMutation.isPending,
    updateComment: updateMutation.mutateAsync,
    updatingComment: updateMutation.isPending,
    deleteComment: deleteCommentMutation.mutateAsync,
    deletingComment: deleteCommentMutation.isPending,
    updateAnchor: updateAnchorMutation.mutateAsync,
    updatingAnchor: updateAnchorMutation.isPending,
  }
}
