import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import type { ContentStoreDetailDto, ContentStoreType } from '@synapse/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ApiError, dashboardApi } from '@/lib/api'
import { serializeDraftForSave } from './content-store-draft-serialization'
import type { ContentStoreDraftFormState, SkillEditorFile } from './content-store-editor-types'
import { filesFromDraftDtos } from './content-store-file-model'

type UseContentStoreDraftEditorOptions = {
  contentId: string
}

export function useContentStoreDraftEditor({
  contentId,
}: UseContentStoreDraftEditorOptions) {
  const queryClient = useQueryClient()
  const [state, setState] = useState<ContentStoreDraftFormState | null>(null)
  const [revision, setRevision] = useState<number | null>(null)
  const [isDirty, setIsDirty] = useState(false)

  const detailQuery = useQuery({
    queryKey: ['my-content-store-detail', contentId],
    queryFn: () => dashboardApi.getContentStoreDetail(contentId),
  })
  const draftQuery = useQuery({
    queryKey: ['content-store-draft', contentId],
    queryFn: () => dashboardApi.getContentStoreDraft(contentId),
    retry: (failureCount, error) =>
      error instanceof ApiError && error.status === 404
        ? false
        : failureCount < 2,
  })

  useEffect(() => {
    let cancelled = false

    async function initializeFromDraft() {
      if (!detailQuery.data || !draftQuery.data) return
      const files = detailQuery.data.type === 'skill'
        ? await filesFromDraftDtos(draftQuery.data.files)
        : []
      if (cancelled) return
      setState({
        type: detailQuery.data.type,
        title: draftQuery.data.title,
        description: draftQuery.data.description ?? '',
        body: draftQuery.data.body ?? '',
        files,
      })
      setRevision(draftQuery.data.revision)
      setIsDirty(false)
    }

    void initializeFromDraft()
    return () => {
      cancelled = true
    }
  }, [detailQuery.data, draftQuery.data])

  useEffect(() => {
    let cancelled = false

    async function initializeFromDetail() {
      if (!detailQuery.data || draftQuery.isLoading || draftQuery.data) return
      if (!(draftQuery.error instanceof ApiError) || draftQuery.error.status !== 404) return
      const files = detailQuery.data.type === 'skill'
        ? await filesFromDraftDtos(detailQuery.data.files)
        : []
      if (cancelled) return
      setState({
        type: detailQuery.data.type,
        title: detailQuery.data.title,
        description: detailQuery.data.description ?? '',
        body: detailQuery.data.body ?? '',
        files,
      })
      setRevision(0)
      setIsDirty(false)
    }

    void initializeFromDetail()
    return () => {
      cancelled = true
    }
  }, [detailQuery.data, draftQuery.data, draftQuery.error, draftQuery.isLoading])

  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (!isDirty) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isDirty])

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!state || revision === null) throw new Error('草稿未加载')
      return dashboardApi.saveContentStoreDraft(
        contentId,
        serializeDraftForSave({ ...state, baseRevision: revision })
      )
    },
    onSuccess: (draft) => {
      setRevision(draft.revision)
      setIsDirty(false)
      void filesFromDraftDtos(draft.files).then((files) => {
        setState({
          type: state?.type ?? detailQuery.data?.type ?? 'skill',
          title: draft.title,
          description: draft.description ?? '',
          body: draft.body ?? '',
          files,
        })
      })
      void queryClient.invalidateQueries({ queryKey: ['content-store-draft', contentId] })
      void queryClient.invalidateQueries({ queryKey: ['my-content-store-detail', contentId] })
      toast.success('已保存')
    },
    onError: (error) => toast.error(getEditorErrorMessage(error, '保存失败')),
  })

  const publishMutation = useMutation({
    mutationFn: async (publishPublic: boolean) => {
      if (!state || revision === null) throw new Error('草稿未加载')
      const draft = isDirty
        ? await dashboardApi.saveContentStoreDraft(
          contentId,
          serializeDraftForSave({ ...state, baseRevision: revision })
        )
        : null
      const nextRevision = draft?.revision ?? revision
      const version = await dashboardApi.publishContentStoreDraft(contentId, {
        baseRevision: nextRevision,
      })
      if (publishPublic) {
        await dashboardApi.setContentStoreVisibility(contentId, 'public')
      }
      return version
    },
    onSuccess: () => {
      setIsDirty(false)
      void queryClient.invalidateQueries({ queryKey: ['content-store-draft', contentId] })
      void queryClient.invalidateQueries({ queryKey: ['my-content-store-detail', contentId] })
      toast.success('已发布')
    },
    onError: (error) => toast.error(getEditorErrorMessage(error, '发布失败')),
  })

  const visibilityMutation = useMutation({
    mutationFn: (visibility: 'private' | 'public') =>
      dashboardApi.setContentStoreVisibility(contentId, visibility),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['my-content-store-detail', contentId] })
      toast.success('已更新')
    },
    onError: (error) => toast.error(getEditorErrorMessage(error, '更新失败')),
  })

  const actions = useMemo(() => ({
    setTitle: (title: string) => updateState(setState, setIsDirty, { title }),
    setDescription: (description: string) =>
      updateState(setState, setIsDirty, { description }),
    setBody: (body: string) => updateState(setState, setIsDirty, { body }),
    setFiles: (files: SkillEditorFile[]) =>
      updateState(setState, setIsDirty, { files }),
    saveDraft: () => saveMutation.mutateAsync(),
    publishDraft: (publishPublic: boolean) =>
      publishMutation.mutateAsync(publishPublic),
    setVisibility: (visibility: 'private' | 'public') =>
      visibilityMutation.mutateAsync(visibility),
  }), [publishMutation, saveMutation, visibilityMutation])

  return {
    detail: detailQuery.data ?? null,
    state,
    revision,
    isDirty,
    isLoading: detailQuery.isLoading || draftQuery.isLoading || !state,
    error: detailQuery.error ??
      (draftQuery.error instanceof ApiError && draftQuery.error.status !== 404
        ? draftQuery.error
        : null),
    actions,
    isSaving: saveMutation.isPending,
    isPublishing: publishMutation.isPending,
    isSettingVisibility: visibilityMutation.isPending,
  }
}

function updateState(
  setState: Dispatch<SetStateAction<ContentStoreDraftFormState | null>>,
  setIsDirty: Dispatch<SetStateAction<boolean>>,
  patch: Partial<ContentStoreDraftFormState>
) {
  setState((current) => current ? { ...current, ...patch } : current)
  setIsDirty(true)
}

export function detailToVisibility(detail: ContentStoreDetailDto | null) {
  return detail?.visibility ?? 'private'
}

export function getContentStoreTypeOptions(): Array<{ value: ContentStoreType; label: string }> {
  return [
    { value: 'skill', label: 'Skill' },
    { value: 'rule', label: 'Rule' },
    { value: 'prompt', label: 'Prompt' },
  ]
}

function getEditorErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim()
    ? error.message
    : fallback
}
