import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { adminApi, type AdminTeamCandidateRow } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useDebouncedValue } from '@/hooks/use-debounced-value'

const candidatePageSize = 50

type AddMembersDialogProps = {
  open: boolean
  teamId: string
  onOpenChange: (open: boolean) => void
}

export function AddMembersDialog({
  open,
  teamId,
  onOpenChange,
}: AddMembersDialogProps) {
  const queryClient = useQueryClient()
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebouncedValue(query)
  const [page, setPage] = useState(1)
  const [candidates, setCandidates] = useState<AdminTeamCandidateRow[]>([])
  const [total, setTotal] = useState(0)
  // 勾选是本地状态：搜索或换页之后已选的人不能丢，所以不在查询结果里找它。
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())

  useEffect(() => {
    if (open) return
    setQuery('')
    setPage(1)
    setCandidates([])
    setTotal(0)
    setPicked(new Set())
  }, [open])

  const candidatesQuery = useQuery({
    queryKey: ['admin-team-candidates', teamId, debouncedQuery.trim(), page],
    queryFn: () =>
      adminApi.listTeamMemberCandidates(teamId, {
        page,
        pageSize: candidatePageSize,
        query: debouncedQuery.trim() || undefined,
      }),
    enabled: open,
  })

  const candidateRows = candidatesQuery.data?.data

  useEffect(() => {
    if (!candidateRows) return
    setTotal(candidatesQuery.data?.total ?? 0)
    setCandidates((current) => {
      if (page === 1) return candidateRows
      const known = new Set(current.map((candidate) => candidate.id))
      return [
        ...current,
        ...candidateRows.filter((candidate) => !known.has(candidate.id)),
      ]
    })
  }, [candidateRows, candidatesQuery.data?.total, page])

  const addMembers = useMutation({
    mutationFn: (userIds: string[]) => adminApi.addTeamMembers(teamId, userIds),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['admin-team-members', teamId] })
      void queryClient.invalidateQueries({ queryKey: ['admin-teams'] })
      void queryClient.invalidateQueries({ queryKey: ['admin-team', teamId] })
      void queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      toast.success(`已添加 ${result.added} 名成员`)
      onOpenChange(false)
    },
    onError: (error: Error) => toast.error(error.message),
  })

  function toggle(id: string, checked: boolean) {
    setPicked((current) => {
      const next = new Set(current)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>添加成员</DialogTitle>
          <DialogDescription className='sr-only'>添加团队成员。</DialogDescription>
        </DialogHeader>
        <div className='grid gap-3'>
          <Input
            value={query}
            placeholder='搜索邮箱或用户名'
            autoComplete='off'
            aria-label='搜索邮箱或用户名'
            onChange={(event) => {
              setQuery(event.target.value)
              // 换搜索词必须回到第一页，否则会先按旧页码去查新词。
              setPage(1)
            }}
          />
          <div className='max-h-72 overflow-y-auto rounded-md border'>
            {candidates.length === 0 ? (
              <p className='px-3 py-6 text-center text-sm text-muted-foreground'>
                {candidatesQuery.isLoading ? '加载中…' : '没有可以添加的用户'}
              </p>
            ) : (
              <div className='flex flex-col py-1'>
                {candidates.map((candidate) => (
                  <div
                    key={candidate.id}
                    className='flex items-center gap-2 px-3 py-1.5'
                  >
                    <Checkbox
                      id={`team-candidate-${candidate.id}`}
                      checked={picked.has(candidate.id)}
                      onCheckedChange={(checked) =>
                        toggle(candidate.id, checked === true)
                      }
                    />
                    <Label
                      htmlFor={`team-candidate-${candidate.id}`}
                      className='flex min-w-0 flex-1 cursor-pointer flex-col items-start gap-0.5 font-normal'
                    >
                      <span className='w-full truncate'>{candidate.email}</span>
                      <span className='w-full truncate text-xs text-muted-foreground'>
                        {candidate.handle}
                        {candidate.status === 'disabled' ? ' · 已禁用' : ''}
                      </span>
                    </Label>
                  </div>
                ))}
              </div>
            )}
          </div>
          {candidates.length < total ? (
            <Button
              variant='outline'
              size='sm'
              disabled={candidatesQuery.isFetching}
              onClick={() => setPage((current) => current + 1)}
            >
              加载更多
            </Button>
          ) : null}
        </div>
        <DialogFooter>
          <span className='me-auto text-sm text-muted-foreground'>
            已选 {picked.size} 人
          </span>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            disabled={picked.size === 0 || addMembers.isPending}
            onClick={() => addMembers.mutate([...picked])}
          >
            添加
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
