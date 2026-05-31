import { Link, useSearch } from '@tanstack/react-router'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { normalizeDashboardRedirect } from '@/lib/dashboard-redirect'
import { AuthLayout } from '../auth-layout'
import { UserAuthForm } from './components/user-auth-form'

export function SignIn() {
  const { redirect } = useSearch({ from: '/(auth)/sign-in' })
  const redirectTo = normalizeDashboardRedirect(redirect)

  return (
    <AuthLayout>
      <Card className='w-full max-w-sm gap-4 sm:min-w-sm'>
        <CardHeader>
          <CardTitle className='text-lg'>登录</CardTitle>
          <CardDescription>输入邮箱和密码登录管理后台。</CardDescription>
        </CardHeader>
        <CardContent>
          <UserAuthForm redirectTo={redirectTo} />
        </CardContent>
        <CardFooter>
          <p className='px-8 text-center text-sm text-muted-foreground'>
            没有账号？{' '}
            <Link
              to='/sign-up'
              className='underline underline-offset-4 hover:text-primary'
            >
              创建账号
            </Link>
          </p>
        </CardFooter>
      </Card>
    </AuthLayout>
  )
}
