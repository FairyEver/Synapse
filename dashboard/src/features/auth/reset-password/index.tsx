import { Link, useSearch } from '@tanstack/react-router'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { AuthLayout } from '../auth-layout'
import { ResetPasswordForm } from './components/reset-password-form'

export function ResetPassword() {
  const { token } = useSearch({ from: '/(auth)/reset-password' })

  return (
    <AuthLayout>
      <Card className='w-full max-w-sm gap-4 sm:min-w-sm'>
        <CardHeader>
          <CardTitle className='text-lg'>重设密码</CardTitle>
          <CardDescription>输入新密码完成重设。</CardDescription>
        </CardHeader>
        <CardContent>
          {token ? (
            <ResetPasswordForm token={token} />
          ) : (
            <div className='flex flex-col gap-4'>
              <p className='text-sm text-muted-foreground'>链接无效。</p>
              <Button asChild>
                <Link to='/forgot-password'>重新获取链接</Link>
              </Button>
            </div>
          )}
        </CardContent>
        <CardFooter>
          <p className='mx-auto px-8 text-center text-sm text-muted-foreground'>
            返回{' '}
            <Link
              to='/sign-in'
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
