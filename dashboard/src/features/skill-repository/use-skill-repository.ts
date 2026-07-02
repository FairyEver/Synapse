import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  SkillRepositoryFileDeleteInput,
  SkillRepositoryFileRenameInput,
  SkillRepositoryFileUploadInput,
  SkillRepositoryPublicListInput,
  SkillRepositoryTextSaveInput,
  SkillRepositoryUpdateInput,
} from '@synapse/shared'
import { skillRepositoryApi } from './skill-repository-api'
import { buildSkillRepositoryBrowser } from './skill-repository-view-model'

export const skillRepositoryKeys = {
  all: ['skill-repositories'] as const,
  mine: () => [...skillRepositoryKeys.all, 'mine'] as const,
  publicList: (input: SkillRepositoryPublicListInput) => [...skillRepositoryKeys.all, 'public', input] as const,
  detail: (repositoryId: string) => [...skillRepositoryKeys.all, repositoryId] as const,
  publicDetail: (ownerHandle: string, repositoryName: string) => [...skillRepositoryKeys.all, 'by-path', ownerHandle, repositoryName] as const,
  fileContent: (repositoryId: string, path: string | null) => [...skillRepositoryKeys.detail(repositoryId), 'file-content', path] as const,
  publicFileContent: (ownerHandle: string, repositoryName: string, path: string | null) => [
    ...skillRepositoryKeys.publicDetail(ownerHandle, repositoryName),
    'file-content',
    path,
  ] as const,
}

export function useSkillRepositoryList() {
  return useQuery({
    queryKey: skillRepositoryKeys.mine(),
    queryFn: skillRepositoryApi.listMine,
  })
}

export function usePublicSkillRepositoryList(input: SkillRepositoryPublicListInput) {
  return useQuery({
    queryKey: skillRepositoryKeys.publicList(input),
    queryFn: () => skillRepositoryApi.listPublic(input),
  })
}

export function usePublicSkillRepository(ownerHandle: string, repositoryName: string) {
  const [currentPath, setCurrentPath] = useState('')
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null)

  const detailQuery = useQuery({
    queryKey: skillRepositoryKeys.publicDetail(ownerHandle, repositoryName),
    queryFn: () => skillRepositoryApi.getByPath(ownerHandle, repositoryName),
  })

  const fileContentQuery = useQuery({
    queryKey: skillRepositoryKeys.publicFileContent(ownerHandle, repositoryName, selectedFilePath),
    queryFn: () => skillRepositoryApi.getFileContentByPath(ownerHandle, repositoryName, selectedFilePath!),
    enabled: Boolean(selectedFilePath),
  })

  const browser = useMemo(() => (
    detailQuery.data ? buildSkillRepositoryBrowser(detailQuery.data.repository, currentPath) : null
  ), [currentPath, detailQuery.data])

  return {
    currentPath,
    setCurrentPath,
    selectedFilePath,
    setSelectedFilePath,
    detailQuery,
    fileContentQuery,
    browser,
  }
}

export function useSkillRepository(repositoryId: string) {
  const queryClient = useQueryClient()
  const [currentPath, setCurrentPath] = useState('')
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null)

  const detailQuery = useQuery({
    queryKey: skillRepositoryKeys.detail(repositoryId),
    queryFn: () => skillRepositoryApi.get(repositoryId),
  })

  const fileContentQuery = useQuery({
    queryKey: skillRepositoryKeys.fileContent(repositoryId, selectedFilePath),
    queryFn: () => skillRepositoryApi.getFileContent(repositoryId, selectedFilePath!),
    enabled: Boolean(selectedFilePath),
  })

  const browser = useMemo(() => (
    detailQuery.data ? buildSkillRepositoryBrowser(detailQuery.data, currentPath) : null
  ), [currentPath, detailQuery.data])

  const invalidateDetail = async () => {
    await queryClient.invalidateQueries({ queryKey: skillRepositoryKeys.detail(repositoryId) })
    await queryClient.invalidateQueries({ queryKey: skillRepositoryKeys.mine() })
  }

  const updateMutation = useMutation({
    mutationFn: (input: SkillRepositoryUpdateInput) => skillRepositoryApi.update(repositoryId, input),
    onSuccess: async () => { await invalidateDetail() },
  })

  const deleteRepositoryMutation = useMutation({
    mutationFn: () => skillRepositoryApi.remove(repositoryId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: skillRepositoryKeys.mine() })
    },
  })

  const saveTextMutation = useMutation({
    mutationFn: (input: SkillRepositoryTextSaveInput) => skillRepositoryApi.saveTextFile(repositoryId, input),
    onSuccess: async () => {
      await invalidateDetail()
      if (selectedFilePath) {
        await queryClient.invalidateQueries({ queryKey: skillRepositoryKeys.fileContent(repositoryId, selectedFilePath) })
      }
    },
  })

  const uploadMutation = useMutation({
    mutationFn: (input: SkillRepositoryFileUploadInput) => skillRepositoryApi.uploadFile(repositoryId, input),
    onSuccess: async () => { await invalidateDetail() },
  })

  const renameMutation = useMutation({
    mutationFn: (input: SkillRepositoryFileRenameInput) => skillRepositoryApi.renameFile(repositoryId, input),
    onSuccess: async (_result, input) => {
      if (selectedFilePath === input.fromPath) setSelectedFilePath(input.toPath)
      await invalidateDetail()
    },
  })

  const deleteFileMutation = useMutation({
    mutationFn: (input: SkillRepositoryFileDeleteInput) => skillRepositoryApi.deleteFile(repositoryId, input),
    onSuccess: async (_result, input) => {
      if (selectedFilePath === input.path) setSelectedFilePath(null)
      await invalidateDetail()
    },
  })

  const reloadSelectedFile = async () => {
    const result = await fileContentQuery.refetch()
    const data = result.data
    return {
      text: data?.text ?? '',
      baseVersionId: data?.file.sha256 ?? '',
    }
  }

  const saveSelectedText = async (input: { readonly text: string; readonly baseVersionId: string }) => {
    if (!selectedFilePath) return { baseVersionId: input.baseVersionId }
    const result = await saveTextMutation.mutateAsync({
      path: selectedFilePath,
      text: input.text,
      expectedSha256: input.baseVersionId,
    })
    const nextFile = result.files.find((file) => file.path === selectedFilePath)
    return { baseVersionId: nextFile?.sha256 ?? input.baseVersionId }
  }

  return {
    currentPath,
    setCurrentPath,
    selectedFilePath,
    setSelectedFilePath,
    detailQuery,
    fileContentQuery,
    browser,
    updateRepository: updateMutation.mutateAsync,
    deleteRepository: deleteRepositoryMutation.mutateAsync,
    uploadFile: uploadMutation.mutateAsync,
    renameFile: renameMutation.mutateAsync,
    deleteFile: deleteFileMutation.mutateAsync,
    reloadSelectedFile,
    saveSelectedText,
    states: {
      updating: updateMutation.isPending,
      deletingRepository: deleteRepositoryMutation.isPending,
      savingText: saveTextMutation.isPending,
      uploading: uploadMutation.isPending,
      renaming: renameMutation.isPending,
      deletingFile: deleteFileMutation.isPending,
      reloadingFile: fileContentQuery.isFetching,
    },
  }
}
