import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useNavigate } from '@tanstack/react-router'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { dashboardApi, userApi } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'
import { AuthLayout } from '../auth-layout'

type TeamInviteProps = {
  token?: string
}

type JoinState =
  | { status: 'idle' }
  | { status: 'joining' }
  | { status: 'joined' }
  | { status: 'error'; message: string }

function buildTeamInviteRedirect(token: string) {
  const query = new URLSearchParams({ token })
  return `/team-invite?${query.toString()}`
}

export function TeamInvite({ token }: TeamInviteProps) {
  const navigate = useNavigate()
  const { auth } = useAuthStore()
  const [joinState, setJoinState] = useState<JoinState>({ status: 'idle' })
  const [retryKey, setRetryKey] = useState(0)
  const [isSwitchingAccount, setIsSwitchingAccount] = useState(false)
  const joinKeyRef = useRef('')
  const inviteToken = token?.trim()
  const redirect = useMemo(
    () => (inviteToken ? buildTeamInviteRedirect(inviteToken) : '/team-invite'),
    [inviteToken]
  )

  useEffect(() => {
    if (!inviteToken || !auth.isAuthenticated || !auth.user) return
    if (auth.user.role !== 'user') return

    const joinKey = `${auth.user.sessionId}:${inviteToken}:${retryKey}`
    if (joinKeyRef.current === joinKey) return
    joinKeyRef.current = joinKey
    setJoinState({ status: 'joining' })

    let cancelled = false
    void userApi
      .joinTeam({ token: inviteToken })
      .then(() => {
        if (cancelled) return
        setJoinState({ status: 'joined' })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        const message = error instanceof Error ? error.message : '加入失败'
        setJoinState({ status: 'error', message })
      })

    return () => {
      cancelled = true
      if (joinKeyRef.current === joinKey) {
        joinKeyRef.current = ''
      }
    }
  }, [auth.isAuthenticated, auth.user, inviteToken, retryKey])

  async function switchAccount() {
    setIsSwitchingAccount(true)
    try {
      await dashboardApi.logout()
      auth.reset()
      await navigate({ to: '/sign-in', search: { redirect }, replace: true })
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '切换失败'
      toast.error(message)
      setIsSwitchingAccount(false)
    }
  }

  if (!inviteToken) {
    return (
      <AuthLayout>
        <TeamInviteCard title='邀请无效'>
          <p className='text-sm text-destructive'>请使用新的邀请链接。</p>
        </TeamInviteCard>
      </AuthLayout>
    )
  }

  if (!auth.isAuthenticated) {
    return <Navigate to='/sign-in' search={{ redirect }} replace />
  }

  if (auth.user?.role !== 'user') {
    return (
      <AuthLayout>
        <TeamInviteCard title='账号不支持'>
          <div className='flex flex-col gap-4'>
            <p className='text-sm text-muted-foreground'>
              请切换账号后加入团队。
            </p>
            <Button disabled={isSwitchingAccount} onClick={switchAccount}>
              {isSwitchingAccount ? <Loader2 className='animate-spin' /> : null}
              切换账号
            </Button>
          </div>
        </TeamInviteCard>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout>
      <TeamInviteCard title='加入团队'>
        <TeamInviteStatus state={joinState} />
        <div className='flex pt-4'>
          {joinState.status === 'joined' ? (
            <Button asChild>
              <Link to='/settings'>进入设置</Link>
            </Button>
          ) : joinState.status === 'error' ? (
            <Button onClick={() => setRetryKey((value) => value + 1)}>
              重试
            </Button>
          ) : (
            <Button disabled>
              <Loader2 className='animate-spin' />
              加入
            </Button>
          )}
        </div>
      </TeamInviteCard>
    </AuthLayout>
  )
}

function TeamInviteStatus({ state }: { state: JoinState }) {
  if (state.status === 'error') {
    return <p className='text-sm text-destructive'>{state.message}</p>
  }

  if (state.status === 'joined') {
    return <p className='text-sm text-muted-foreground'>已加入团队。</p>
  }

  return <p className='text-sm text-muted-foreground'>正在加入团队。</p>
}

function TeamInviteCard({
  children,
  title,
}: {
  children: React.ReactNode
  title: string
}) {
  return (
    <Card className='w-full max-w-sm gap-4 sm:min-w-sm'>
      <CardHeader>
        <CardTitle className='text-lg'>{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}
