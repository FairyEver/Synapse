import { Link, useSearch } from '@tanstack/react-router'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { buildAuthRedirectSearch, normalizeAuthRedirect } from '../auth-redirect-search'
import { AuthLayout } from '../auth-layout'
import { ForgotPasswordForm } from './components/forgot-password-form'

export function ForgotPassword() {
  const { redirect } = useSearch({ from: '/(auth)/forgot-password' })
  const redirectTo = normalizeAuthRedirect(redirect)

  return (
    <AuthLayout>
      <Card className='w-full max-w-sm gap-4 sm:min-w-sm'>
        <CardHeader>
          <CardTitle className='text-lg'>找回密码</CardTitle>
          <CardDescription>输入注册邮箱申请重置密码。</CardDescription>
        </CardHeader>
        <CardContent>
          <ForgotPasswordForm redirectTo={redirectTo} />
        </CardContent>
        <CardFooter>
          <p className='mx-auto px-8 text-center text-sm text-muted-foreground'>
            想起密码？{' '}
            <Link
              to='/sign-in'
              search={buildAuthRedirectSearch(redirectTo)}
              className='underline underline-offset-4 hover:text-primary'
            >
              登录
            </Link>
          </p>
        </CardFooter>
      </Card>
    </AuthLayout>
  )
}
