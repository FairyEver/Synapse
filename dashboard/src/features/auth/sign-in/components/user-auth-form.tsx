import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { Loader2, LogIn } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { useAuthStore } from '@/stores/auth-store'
import { dashboardApi } from '@/lib/api'
import { resolveDashboardRedirectForRole } from '@/lib/dashboard-role'
import { cn } from '@/lib/utils'
import { PasswordInput } from '@/components/password-input'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { zodResolver } from '../../zod-resolver'

const formSchema = z.object({
  email: z.email({ error: () => '请输入有效的邮箱地址' }),
  password: z.string().min(1, '请输入密码'),
})

type UserAuthFormProps = React.HTMLAttributes<HTMLFormElement> & {
  redirectTo?: string
}

export function UserAuthForm({
  className,
  redirectTo,
  ...props
}: UserAuthFormProps) {
  const [isLoading, setIsLoading] = useState(false)
  const navigate = useNavigate()
  const { auth } = useAuthStore()

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { email: '', password: '' },
  })

  async function onSubmit(data: z.infer<typeof formSchema>) {
    setIsLoading(true)
    try {
      const session = await dashboardApi.login(data)
      auth.setUser(session)
      toast.success(`欢迎回来，${session.email}`)
      await navigate({
        to: resolveDashboardRedirectForRole(session.role, redirectTo),
        replace: true,
      })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '登录失败'
      toast.error(message)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className={cn('grid gap-3', className)}
        {...props}
      >
        <FormField
          control={form.control}
          name='email'
          render={({ field }) => (
            <FormItem>
              <FormLabel>邮箱</FormLabel>
              <FormControl>
                <Input
                  autoComplete='email'
                  placeholder='name@example.com'
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name='password'
          render={({ field }) => (
            <FormItem>
              <div className='flex items-center justify-between gap-2'>
                <FormLabel>密码</FormLabel>
                <Link
                  to='/forgot-password'
                  className='text-sm font-medium text-muted-foreground hover:opacity-75'
                >
                  忘记密码？
                </Link>
              </div>
              <FormControl>
                <PasswordInput
                  autoComplete='current-password'
                  placeholder='请输入密码'
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button className='mt-2' disabled={isLoading}>
          {isLoading ? <Loader2 className='animate-spin' /> : <LogIn />}
          登录
        </Button>
      </form>
    </Form>
  )
}
