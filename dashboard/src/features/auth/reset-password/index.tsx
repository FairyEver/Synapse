import { useState } from 'react'
import { Link, useSearch } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { userAuthApi } from '@/lib/api'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { buildAuthRedirectSearch, normalizeAuthRedirect } from '../auth-redirect-search'
import { AuthLayout } from '../auth-layout'
import { ResetPasswordForm } from './components/reset-password-form'

export function ResetPassword() {
  const { token, redirect } = useSearch({ from: '/(auth)/reset-password' })
  const redirectTo = normalizeAuthRedirect(redirect)
  const [isComplete, setIsComplete] = useState(false)
  const validation = useQuery({
    queryKey: ['password-reset-token', token],
    queryFn: () => userAuthApi.validatePasswordResetToken(token!),
    enabled: Boolean(token),
    retry: false,
  })
  const isInvalid = !token || validation.data?.valid === false
  const title = isComplete
    ? '密码已更新'
    : isInvalid
      ? '链接已失效'
      : validation.isError
        ? '无法验证链接'
        : '重设密码'
  const description = isComplete
    ? undefined
    : isInvalid
      ? '请联系管理员重新生成重置链接。'
      : validation.isError
        ? '请检查网络后重试。'
        : '输入新密码完成重设。'

  return (
    <AuthLayout>
      <Card className='w-full max-w-sm gap-4 sm:min-w-sm'>
        <CardHeader>
          <CardTitle className='text-lg'>{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </CardHeader>
        <CardContent>
          {isComplete ? (
            <Button asChild className='w-full'>
              <Link to='/sign-in' search={buildAuthRedirectSearch(redirectTo)}>
                去登录
              </Link>
            </Button>
          ) : isInvalid ? null : validation.isPending ? (
            <div className='grid gap-3' aria-label='正在验证链接'>
              <Skeleton className='h-4 w-16' />
              <Skeleton className='h-9 w-full' />
              <Skeleton className='h-4 w-16' />
              <Skeleton className='h-9 w-full' />
              <Skeleton className='h-9 w-full' />
            </div>
          ) : validation.isError ? (
            <Button variant='outline' className='w-full' onClick={() => void validation.refetch()}>
              重试
            </Button>
          ) : validation.data?.valid ? (
            <ResetPasswordForm token={token} onComplete={() => setIsComplete(true)} />
          ) : (
            <Skeleton className='h-9 w-full' />
          )}
        </CardContent>
        {!isComplete ? <CardFooter>
          <p className='mx-auto px-8 text-center text-sm text-muted-foreground'>
            返回{' '}
            <Link
              to='/sign-in'
              search={buildAuthRedirectSearch(redirectTo)}
              className='underline underline-offset-4 hover:text-primary'
            >
              登录
            </Link>
          </p>
        </CardFooter> : null}
      </Card>
    </AuthLayout>
  )
}
