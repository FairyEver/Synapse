import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Loader2, LogIn } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@/features/auth/zod-resolver'
import { AuthLayout } from '@/features/auth/auth-layout'
import { adminApi } from '@/lib/api'
import { normalizeAdminRedirect } from '@/lib/admin-redirect'
import { useAdminAuthStore } from '@/stores/admin-auth-store'
import { PasswordInput } from '@/components/password-input'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'

const schema = z.object({ accessSecret: z.string().min(1, '密钥无效') })

export function AdminAccessPage({ redirectTo }: { redirectTo?: string }) {
  const [isLoading, setIsLoading] = useState(false)
  const navigate = useNavigate()
  const setSession = useAdminAuthStore((state) => state.auth.setSession)
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { accessSecret: '' },
  })

  async function submit(input: z.infer<typeof schema>) {
    setIsLoading(true)
    try {
      const session = await adminApi.unlock(input.accessSecret)
      setSession(session)
      await navigate({ to: normalizeAdminRedirect(redirectTo) ?? '/system', replace: true })
    } catch {
      form.setError('accessSecret', { message: '密钥无效' })
    } finally {
      form.setValue('accessSecret', '', { shouldDirty: false, shouldTouch: false })
      setIsLoading(false)
    }
  }

  return (
    <AuthLayout>
      <Card className='w-full max-w-sm gap-5 border-0 bg-transparent py-0 shadow-none sm:min-w-sm sm:gap-4 sm:border sm:bg-card sm:py-6 sm:shadow-sm'>
        <CardHeader className='px-0 sm:px-6'>
          <CardTitle className='text-lg'>管理密钥</CardTitle>
        </CardHeader>
        <CardContent className='px-0 sm:px-6'>
          <Form {...form}>
            <form className='grid gap-4 sm:gap-3' onSubmit={form.handleSubmit(submit)}>
              <FormField
                control={form.control}
                name='accessSecret'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>密钥</FormLabel>
                    <FormControl>
                      <PasswordInput
                        autoComplete='off'
                        className='[&_button]:size-11 [&_input]:h-11 [&_input]:pe-11 sm:[&_button]:size-6 sm:[&_input]:h-9 sm:[&_input]:pe-9'
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button className='mt-2 h-11 sm:h-9' disabled={isLoading}>
                {isLoading ? <Loader2 className='animate-spin' /> : <LogIn />}
                进入管理界面
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </AuthLayout>
  )
}
