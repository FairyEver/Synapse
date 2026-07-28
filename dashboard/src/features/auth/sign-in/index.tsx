import { Link, useSearch } from '@tanstack/react-router'
import {
  Card,
  CardContent,
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
      <Card className='w-full max-w-sm gap-5 border-0 bg-transparent py-0 shadow-none sm:min-w-sm sm:gap-4 sm:border sm:bg-card sm:py-6 sm:shadow-sm'>
        <CardHeader className='px-0 sm:px-6'>
          <CardTitle className='text-lg'>登录</CardTitle>
        </CardHeader>
        <CardContent className='px-0 sm:px-6'>
          <UserAuthForm redirectTo={redirectTo} />
        </CardContent>
        <CardFooter className='justify-center px-0 sm:px-6'>
          <p className='text-center text-sm text-muted-foreground'>
            没有账号？{' '}
            <Link
              to='/sign-up'
              search={buildAuthRedirectSearch(redirectTo)}
              className='inline-flex min-h-11 items-center underline underline-offset-4 hover:text-primary sm:min-h-0'
            >
              创建账号
            </Link>
          </p>
        </CardFooter>
      </Card>
    </AuthLayout>
  )
}
