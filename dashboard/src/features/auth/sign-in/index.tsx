import { useState } from 'react'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { Loader2, LogIn } from 'lucide-react'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth-store'
import { dashboardApi } from '@/lib/api'
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
import { PasswordInput } from '@/components/password-input'

const formSchema = z.object({
  email: z.email({ error: () => '请输入有效的邮箱地址' }),
  password: z.string().min(1, '请输入密码'),
})

export function SignIn() {
  const [isLoading, setIsLoading] = useState(false)
  const navigate = useNavigate()
  const search = useSearch({ strict: false }) as { redirect?: string }
  const { auth } = useAuthStore()

  const form = useForm<z.infer<typeof formSchema>>({
    defaultValues: { email: '', password: '' },
  })

  async function onSubmit(rawData: z.infer<typeof formSchema>) {
    const parsed = formSchema.safeParse(rawData)
    if (!parsed.success) {
      const errors = z.flattenError(parsed.error).fieldErrors
      if (errors.email?.[0]) form.setError('email', { message: errors.email[0] })
      if (errors.password?.[0]) {
        form.setError('password', { message: errors.password[0] })
      }
      return
    }

    setIsLoading(true)
    try {
      const session = await dashboardApi.login(parsed.data)
      auth.setUser(session)
      toast.success(`欢迎回来，${session.email}`)
      const targetPath = search.redirect || '/'
      navigate({ to: targetPath, replace: true })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '登录失败'
      toast.error(message)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className='flex min-h-svh items-center justify-center p-6'>
      <div className='w-full max-w-sm space-y-6'>
        <div className='space-y-2 text-center'>
          <h1 className='text-2xl font-bold'>Synapse Admin</h1>
          <p className='text-muted-foreground'>登录管理后台</p>
        </div>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className='grid gap-4'
          >
            <FormField
              control={form.control}
              name='email'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>邮箱</FormLabel>
                  <FormControl>
                    <Input placeholder='admin@example.com' {...field} />
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
                    <PasswordInput placeholder='请输入密码' {...field} />
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
      </div>
    </div>
  )
}
