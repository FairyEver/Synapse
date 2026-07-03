import { useEffect, useState } from 'react'
import {
  normalizeUserHandle,
  userHandleMaxLength,
} from '@synapse/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { dashboardApi } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'

const maxHandleLength = userHandleMaxLength
type HandleError = 'format' | 'unavailable'

function getHandleError(value: string): HandleError | null {
  if (!value) return null
  try {
    normalizeUserHandle(value)
    return null
  } catch (error) {
    if (!(error instanceof Error)) return 'format'
    if (error.message.includes('保留路由') || error.message.includes('Windows')) {
      return 'unavailable'
    }
    return 'format'
  }
}

export function ProfileSettings() {
  const queryClient = useQueryClient()
  const authUser = useAuthStore((state) => state.auth.user)
  const setAuthUser = useAuthStore((state) => state.auth.setUser)
  const [handle, setHandle] = useState('')
  const { data, error, isError, isLoading, refetch } = useQuery({
    queryKey: ['dashboard-me'],
    queryFn: dashboardApi.getMe,
    enabled: authUser?.role === 'user',
  })
  const updateProfile = useMutation({
    mutationFn: dashboardApi.updateMe,
    onSuccess: (nextData) => {
      queryClient.setQueryData(['dashboard-me'], nextData)
      if (authUser?.role === 'user') {
        setAuthUser({
          ...authUser,
          email: nextData.user.email,
          handle: nextData.user.handle,
        })
      }
      toast.success('已保存')
    },
    onError: (mutationError: Error) => toast.error(mutationError.message),
  })

  useEffect(() => {
    if (data) {
      setHandle(data.user.handle ?? '')
    }
  }, [data])

  if (authUser?.role !== 'user') {
    return <div className='text-sm text-muted-foreground'>暂无可配置项</div>
  }

  if (isLoading) {
    return <div className='text-sm text-muted-foreground'>加载中...</div>
  }

  if (isError) {
    return (
      <div className='flex flex-col items-start gap-3'>
        <div className='space-y-1'>
          <div className='font-medium'>加载失败</div>
          <p className='text-sm text-muted-foreground'>
            {error instanceof Error ? error.message : '请求失败'}
          </p>
        </div>
        <Button variant='outline' size='sm' onClick={() => void refetch()}>
          重试
        </Button>
      </div>
    )
  }

  if (!data) return null

  const trimmedHandle = handle.trim().toLowerCase()
  const handleError = getHandleError(trimmedHandle)
  const isInvalid =
    trimmedHandle.length === 0 ||
    handleError !== null
  const hasChanged =
    trimmedHandle !== data.user.handle

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isInvalid || !hasChanged) return
    updateProfile.mutate({
      handle: trimmedHandle,
    })
  }

  return (
    <section className='flex flex-1 flex-col'>
      <div className='flex-none'>
        <h3 className='text-lg font-medium'>个人资料</h3>
      </div>
      <Separator className='my-4 flex-none' />
      <div className='h-full w-full overflow-y-auto pe-4 pb-12'>
        <div className='max-w-xl space-y-6'>
          <div className='grid gap-3 text-sm'>
            <div className='grid gap-1 sm:grid-cols-3 sm:items-center'>
              <span className='text-muted-foreground'>邮箱</span>
              <span className='truncate sm:col-span-2'>{data.user.email}</span>
            </div>
            <div className='grid gap-1 sm:grid-cols-3 sm:items-center'>
              <span className='text-muted-foreground'>状态</span>
              <div className='sm:col-span-2'>
                <Badge
                  variant={data.user.status === 'active' ? 'default' : 'secondary'}
                >
                  {data.user.status === 'active' ? '正常' : '禁用'}
                </Badge>
              </div>
            </div>
          </div>

          <form className='space-y-4' onSubmit={handleSubmit}>
            <div className='space-y-2'>
              <Label htmlFor='user-handle'>用户名</Label>
              <Input
                id='user-handle'
                value={handle}
                maxLength={maxHandleLength}
                onChange={(event) => setHandle(event.target.value)}
              />
              {handleError === 'format' ? (
                <p className='text-sm text-destructive'>只能使用小写字母、数字和连字符，并以字母或数字开头和结尾。</p>
              ) : null}
              {handleError === 'unavailable' ? (
                <p className='text-sm text-destructive'>该用户名不可用。</p>
              ) : null}
            </div>
            <Button
              type='submit'
              disabled={isInvalid || !hasChanged || updateProfile.isPending}
            >
              保存
            </Button>
          </form>
        </div>
      </div>
    </section>
  )
}
