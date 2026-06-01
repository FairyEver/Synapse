import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { dashboardApi } from '@/lib/api'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const maxDisplayNameLength = 40

export default function MePage() {
  const queryClient = useQueryClient()
  const [displayName, setDisplayName] = useState('')
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard-me'],
    queryFn: dashboardApi.getMe,
  })
  const updateProfile = useMutation({
    mutationFn: dashboardApi.updateMe,
    onSuccess: (nextData) => {
      queryClient.setQueryData(['dashboard-me'], nextData)
      toast.success('已保存')
    },
    onError: (error: Error) => toast.error(error.message),
  })

  useEffect(() => {
    if (data) setDisplayName(data.user.displayName ?? '')
  }, [data])

  const trimmedDisplayName = displayName.trim()
  const isInvalid =
    trimmedDisplayName.length === 0 ||
    trimmedDisplayName.length > maxDisplayNameLength
  const hasChanged = trimmedDisplayName !== (data?.user.displayName ?? '')

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isInvalid || !hasChanged) return
    updateProfile.mutate({ displayName: trimmedDisplayName })
  }

  return (
    <>
      <Header>
        <h1 className='text-lg font-semibold'>个人中心</h1>
      </Header>
      <Main>
        {isLoading ? (
          <div className='text-muted-foreground'>加载中...</div>
        ) : data ? (
          <div className='grid max-w-lg gap-4'>
            <Card>
              <CardHeader>
                <CardTitle className='text-base'>账户信息</CardTitle>
              </CardHeader>
              <CardContent className='space-y-4'>
                <div className='flex justify-between gap-4'>
                  <span className='text-muted-foreground'>邮箱</span>
                  <span className='truncate'>{data.user.email}</span>
                </div>
                <div className='flex justify-between gap-4'>
                  <span className='text-muted-foreground'>状态</span>
                  <Badge variant={data.user.status === 'active' ? 'default' : 'secondary'}>
                    {data.user.status === 'active' ? '正常' : '禁用'}
                  </Badge>
                </div>
                <form className='space-y-3' onSubmit={handleSubmit}>
                  <div className='space-y-2'>
                    <Label htmlFor='display-name'>昵称</Label>
                    <Input
                      id='display-name'
                      value={displayName}
                      maxLength={maxDisplayNameLength}
                      onChange={(event) => setDisplayName(event.target.value)}
                    />
                  </div>
                  <Button
                    type='submit'
                    disabled={isInvalid || !hasChanged || updateProfile.isPending}
                  >
                    保存
                  </Button>
                </form>
              </CardContent>
            </Card>
            {data.teams.length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle className='text-base'>我的团队</CardTitle>
                </CardHeader>
                <CardContent className='space-y-2'>
                  {data.teams.map((team) => (
                    <div key={team.id} className='flex justify-between gap-4'>
                      <span className='truncate'>{team.name}</span>
                      <Badge variant='outline'>{team.membershipRole}</Badge>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ) : null}
          </div>
        ) : null}
      </Main>
    </>
  )
}
