import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import type { SkillRepositoryForkInput } from '@synapse/shared'
import { skillRepositoryApi } from './skill-repository-api'
import { skillRepositoryKeys } from './use-skill-repository'

export function useSkillRepositoryActions(repositoryId: string) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const forkMutation = useMutation({
    mutationFn: (input: SkillRepositoryForkInput = {}) => skillRepositoryApi.fork(repositoryId, input),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: skillRepositoryKeys.mine() })
      toast('Fork 已创建')
      await navigate({ to: '/skill-repositories/$repositoryId', params: { repositoryId: result.repository.id } })
    },
    onError: (error) => {
      toast(error instanceof Error ? error.message : 'Fork 失败')
    },
  })

  const installMutation = useMutation({
    mutationFn: () => skillRepositoryApi.createInstallSession(repositoryId),
    onSuccess: (session) => {
      window.location.href = session.deepLinkUrl
    },
    onError: (error) => {
      toast(error instanceof Error ? error.message : '安装失败')
    },
  })

  return {
    forkRepository: forkMutation.mutateAsync,
    createInstallSession: installMutation.mutateAsync,
    states: {
      forking: forkMutation.isPending,
      installing: installMutation.isPending,
    },
  }
}
