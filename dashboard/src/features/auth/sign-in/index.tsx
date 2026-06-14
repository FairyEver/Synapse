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
import { UserAuthForm } from './components/user-auth-form'

export function SignIn() {
  const { redirect } = useSearch({ from: '/(auth)/sign-in' })
  const redirectTo = normalizeAuthRedirect(redirect)

  return (
    <AuthLayout>
      <Card className='w-full max-w-sm gap-4 sm:min-w-sm'>
        <CardHeader>
          <CardTitle className='text-lg'>登录</CardTitle>
          <CardDescription>输入邮箱和密码登录 Synapse。</CardDescription>
        </CardHeader>
        <CardContent>
          <UserAuthForm redirectTo={redirectTo} />
        </CardContent>
        <CardFooter>
          <p className='px-8 text-center text-sm text-muted-foreground'>
            没有账号？{' '}
            <Link
              to='/sign-up'
              search={buildAuthRedirectSearch(redirectTo)}
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
