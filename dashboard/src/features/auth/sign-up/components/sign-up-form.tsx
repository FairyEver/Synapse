import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Loader2, UserPlus } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { userAuthApi } from '@/lib/api'
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
import { buildAuthRedirectSearch } from '../../auth-redirect-search'
import { zodResolver } from '../../zod-resolver'

const formSchema = z
  .object({
    email: z.email({ error: () => '请输入有效的邮箱地址' }),
    password: z.string().min(8, '密码至少 8 个字符'),
    confirmPassword: z.string().min(1, '请再次输入密码'),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: '两次输入的密码不一致',
    path: ['confirmPassword'],
  })

export function SignUpForm({
  className,
  redirectTo,
  ...props
}: React.HTMLAttributes<HTMLFormElement> & { redirectTo?: string }) {
  const [isLoading, setIsLoading] = useState(false)
  const [registeredEmail, setRegisteredEmail] = useState<string | null>(null)

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      email: '',
      password: '',
      confirmPassword: '',
    },
  })

  async function onSubmit(data: z.infer<typeof formSchema>) {
    setIsLoading(true)
    try {
      await userAuthApi.register({
        email: data.email,
        password: data.password,
      })
      setRegisteredEmail(data.email)
      form.reset()
      toast.success('账号已创建')
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '注册失败'
      toast.error(message)
    } finally {
      setIsLoading(false)
    }
  }

  if (registeredEmail) {
    return (
      <div className='flex flex-col gap-4'>
        <p className='text-sm text-muted-foreground'>
          {registeredEmail} 已创建，可以登录 Synapse。
        </p>
        <Button asChild>
          <Link to='/sign-in' search={buildAuthRedirectSearch(redirectTo)}>去登录</Link>
        </Button>
      </div>
    )
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
              <FormLabel>密码</FormLabel>
              <FormControl>
                <PasswordInput
                  autoComplete='new-password'
                  placeholder='至少 8 个字符'
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name='confirmPassword'
          render={({ field }) => (
            <FormItem>
              <FormLabel>确认密码</FormLabel>
              <FormControl>
                <PasswordInput
                  autoComplete='new-password'
                  placeholder='再次输入密码'
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button className='mt-2' disabled={isLoading}>
          {isLoading ? <Loader2 className='animate-spin' /> : <UserPlus />}
          创建账号
        </Button>
      </form>
    </Form>
  )
}
