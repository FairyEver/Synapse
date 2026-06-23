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
import { SignUpForm } from './components/sign-up-form'

export function SignUp() {
  const { redirect } = useSearch({ from: '/(auth)/sign-up' })
  const redirectTo = normalizeAuthRedirect(redirect)

  return (
    <AuthLayout>
      <Card className='w-full max-w-sm gap-4 sm:min-w-sm'>
        <CardHeader>
          <CardTitle className='text-lg'>创建账号</CardTitle>
          <CardDescription>输入邮箱和密码创建账号。</CardDescription>
        </CardHeader>
        <CardContent>
          <SignUpForm redirectTo={redirectTo} />
        </CardContent>
        <CardFooter>
          <p className='px-8 text-center text-sm text-muted-foreground'>
            已有账号？{' '}
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
