import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Loader2, RotateCcw } from 'lucide-react'
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
import { zodResolver } from '../../zod-resolver'
import { buildAuthRedirectSearch } from '../../auth-redirect-search'

const formSchema = z
  .object({
    password: z.string().min(8, '密码至少 8 个字符'),
    confirmPassword: z.string().min(1, '请再次输入密码'),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: '两次输入的密码不一致',
    path: ['confirmPassword'],
  })

type ResetPasswordFormProps = React.HTMLAttributes<HTMLFormElement> & {
  token: string
  redirectTo?: string
}

export function ResetPasswordForm({
  className,
  redirectTo,
  token,
  ...props
}: ResetPasswordFormProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [isComplete, setIsComplete] = useState(false)

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { password: '', confirmPassword: '' },
  })

  async function onSubmit(data: z.infer<typeof formSchema>) {
    setIsLoading(true)
    try {
      await userAuthApi.resetPassword({ token, password: data.password })
      setIsComplete(true)
      form.reset()
      toast.success('密码已更新')
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '重设失败'
      toast.error(message)
    } finally {
      setIsLoading(false)
    }
  }

  if (isComplete) {
    return (
      <div className='flex flex-col gap-4'>
        <p className='text-sm text-muted-foreground'>密码已更新。</p>
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
          name='password'
          render={({ field }) => (
            <FormItem>
              <FormLabel>新密码</FormLabel>
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
          {isLoading ? <Loader2 className='animate-spin' /> : <RotateCcw />}
          更新密码
        </Button>
      </form>
    </Form>
  )
}
