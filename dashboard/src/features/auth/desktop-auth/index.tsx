import { useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useNavigate } from '@tanstack/react-router'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth-store'
import { dashboardApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { AuthLayout } from '../auth-layout'

const desktopClientId = 'synapse-desktop'
const desktopRedirectUri = 'synapse://auth/desktop/callback'
const pkceChallengeMethod = 'S256' as const

type DesktopAuthSearch = {
  client_id?: string
  redirect_uri?: string
  response_type?: string
  state?: string
  code_challenge?: string
  code_challenge_method?: string
}

type DesktopAuthProps = {
  search: DesktopAuthSearch
}

type AuthorizeState =
  | { status: 'idle' }
  | { status: 'opening'; deepLinkUrl?: string }
  | { status: 'opened'; deepLinkUrl: string }
  | { status: 'error'; message: string; deepLinkUrl?: string }

function buildDesktopAuthErrorCallbackUrl(state: string, error: string) {
  const query = new URLSearchParams({ error, state })
  return `${desktopRedirectUri}?${query.toString()}`
}

function buildDesktopAuthRedirect(search: DesktopAuthSearch) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(search)) {
    if (value) query.set(key, value)
  }
  const suffix = query.toString()
  return suffix ? `/auth/desktop?${suffix}` : '/auth/desktop'
}

function validateDesktopAuthSearch(search: DesktopAuthSearch) {
  if (
    search.client_id !== desktopClientId ||
    search.redirect_uri !== desktopRedirectUri ||
    search.response_type !== 'code' ||
    search.code_challenge_method !== pkceChallengeMethod ||
    !search.state ||
    search.state.trim().length < 16 ||
    !search.code_challenge ||
    search.code_challenge.trim().length < 16
  ) {
    return null
  }
  return {
    clientId: search.client_id,
    redirectUri: search.redirect_uri,
    state: search.state.trim(),
    codeChallenge: search.code_challenge.trim(),
    codeChallengeMethod: pkceChallengeMethod,
  }
}

export function DesktopAuth({ search }: DesktopAuthProps) {
  const navigate = useNavigate()
  const { auth } = useAuthStore()
  const [authorizeState, setAuthorizeState] = useState<AuthorizeState>({
    status: 'idle',
  })
  const [retryKey, setRetryKey] = useState(0)
  const [isSwitchingAccount, setIsSwitchingAccount] = useState(false)
  const issuedKeyRef = useRef('')
  const unsupportedAccountRef = useRef('')
  const input = useMemo(() => validateDesktopAuthSearch(search), [search])
  const redirect = useMemo(() => buildDesktopAuthRedirect(search), [search])
  const deepLinkUrl =
    authorizeState.status === 'opening' ||
    authorizeState.status === 'opened' ||
    authorizeState.status === 'error'
      ? authorizeState.deepLinkUrl
      : undefined

  useEffect(() => {
    if (!input || !auth.isAuthenticated || !auth.user) return
    if (auth.user.role !== 'user') return

    const issueKey = `${auth.user.sessionId}:${input.state}:${input.codeChallenge}:${retryKey}`
    if (issuedKeyRef.current === issueKey) return
    issuedKeyRef.current = issueKey
    setAuthorizeState({ status: 'opening' })

    let cancelled = false
    void dashboardApi
      .authorizeDesktopLogin(input)
      .then((result) => {
        if (cancelled) return
        window.location.href = result.deepLinkUrl
        setAuthorizeState({ status: 'opened', deepLinkUrl: result.deepLinkUrl })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        const message = error instanceof Error ? error.message : '打开失败'
        setAuthorizeState({ status: 'error', message })
      })

    return () => {
      cancelled = true
      if (issuedKeyRef.current === issueKey) {
        issuedKeyRef.current = ''
      }
    }
  }, [auth.isAuthenticated, auth.user, input, retryKey])

  useEffect(() => {
    if (!input || !auth.isAuthenticated || !auth.user) return
    if (auth.user.role === 'user') return
    const callbackUrl = buildDesktopAuthErrorCallbackUrl(
      input.state,
      'unsupported_account'
    )
    const marker = `${auth.user.sessionId}:${callbackUrl}`
    if (unsupportedAccountRef.current === marker) return
    unsupportedAccountRef.current = marker
    window.location.href = callbackUrl
  }, [auth.isAuthenticated, auth.user, input])

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

  if (!input) {
    return (
      <AuthLayout>
        <DesktopAuthCard title='登录请求无效'>
          <p className='text-sm text-destructive'>请从 Synapse 客户端重新登录。</p>
        </DesktopAuthCard>
      </AuthLayout>
    )
  }

  if (!auth.isAuthenticated) {
    return <Navigate to='/sign-in' search={{ redirect }} replace />
  }

  if (auth.user?.role !== 'user') {
    return (
      <AuthLayout>
        <DesktopAuthCard title='账号不支持'>
          <div className='flex flex-col gap-4'>
            <p className='text-sm text-muted-foreground'>请使用普通用户账号登录。</p>
            <Button disabled={isSwitchingAccount} onClick={switchAccount}>
              {isSwitchingAccount ? <Loader2 className='animate-spin' /> : null}
              切换账号
            </Button>
          </div>
        </DesktopAuthCard>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout>
      <DesktopAuthCard title='打开 Synapse'>
        <div className='flex flex-col gap-4'>
          <DesktopAuthStatus state={authorizeState} />
          <Button
            disabled={authorizeState.status === 'opening' && !deepLinkUrl}
            onClick={() => {
              if (authorizeState.status === 'error') {
                setRetryKey((value) => value + 1)
                return
              }
              if (deepLinkUrl) {
                window.location.href = deepLinkUrl
              }
            }}
          >
            {authorizeState.status === 'opening' ? (
              <Loader2 className='animate-spin' />
            ) : null}
            {authorizeState.status === 'error'
              ? '重试'
              : authorizeState.status === 'opened'
                ? '再次打开'
                : '打开'}
          </Button>
        </div>
      </DesktopAuthCard>
    </AuthLayout>
  )
}

function DesktopAuthStatus({ state }: { state: AuthorizeState }) {
  if (state.status === 'error') {
    return <p className='text-sm text-destructive'>{state.message}</p>
  }

  return (
    <p className='text-sm text-muted-foreground'>
      {state.status === 'opened' ? '已发送到 Synapse。' : '正在打开 Synapse。'}
    </p>
  )
}

function DesktopAuthCard({
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
