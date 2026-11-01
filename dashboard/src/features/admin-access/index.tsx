import { Button, Card, FieldError, Form, Label, TextField } from '@heroui/react'
import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Loader2, LogIn } from 'lucide-react'
import { Controller, useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@/features/auth/zod-resolver'
import { AuthLayout } from '@/features/auth/auth-layout'
import { adminApi, ApiError } from '@/lib/api'
import { normalizeAdminRedirect } from '@/lib/admin-redirect'
import { useAdminAuthStore } from '@/stores/admin-auth-store'
import { PasswordInput } from '@/components/password-input'

const schema = z.object({ accessSecret: z.string().min(1, '密钥无效') })
const invalidSecretStatuses = new Set([400, 401])

function operationalErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 403) return '请求来源无效，请检查管理后台地址或代理配置。'
    if (error.status >= 500) return '认证服务暂时不可用，请稍后重试。'
    return '暂时无法进入管理界面，请重试。'
  }
  return '无法连接认证服务，请检查网络后重试。'
}

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
    form.clearErrors()
    try {
      const session = await adminApi.unlock(input.accessSecret)
      setSession(session)
      await navigate({ to: normalizeAdminRedirect(redirectTo) ?? '/system', replace: true })
    } catch (error: unknown) {
      if (error instanceof ApiError && invalidSecretStatuses.has(error.status)) {
        form.setError('accessSecret', { type: 'server', message: '密钥无效' })
      } else {
        form.setError('root', { type: 'server', message: operationalErrorMessage(error) })
      }
    } finally {
      form.setValue('accessSecret', '', { shouldDirty: false, shouldTouch: false })
      setIsLoading(false)
    }
  }

  return (
    <AuthLayout>
      <Card className='w-full max-w-sm'>
        <Card.Header><Card.Title>管理密钥</Card.Title></Card.Header>
        <Card.Content>
          <Form className='grid gap-4' onSubmit={form.handleSubmit(submit)}>
            <Controller control={form.control} name='accessSecret' render={({ field, fieldState }) => (
              <TextField isInvalid={Boolean(fieldState.error)}>
                <Label htmlFor='admin-access-secret'>密钥</Label>
                <PasswordInput variant="secondary" id='admin-access-secret' autoComplete='off' {...field} />
                <FieldError>{fieldState.error?.message}</FieldError>
              </TextField>
            )} />
            {form.formState.errors.root?.message ? (
              <p role='alert' className='text-sm text-danger'>{form.formState.errors.root.message}</p>
            ) : null}
            <Button type='submit' isDisabled={isLoading}>
              {isLoading ? <Loader2 className='animate-spin' /> : <LogIn />}
              进入管理界面
            </Button>
          </Form>
        </Card.Content>
      </Card>
    </AuthLayout>
  )
}
