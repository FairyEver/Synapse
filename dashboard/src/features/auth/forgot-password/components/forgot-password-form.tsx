import { useState } from 'react'
import { ArrowRight, Loader2 } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { type PasswordResetRequestResult, userAuthApi } from '@/lib/api'
import { cn } from '@/lib/utils'
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
})

export function ForgotPasswordForm({
  className,
  ...props
}: React.HTMLAttributes<HTMLFormElement>) {
  const [isLoading, setIsLoading] = useState(false)
  const [result, setResult] = useState<PasswordResetRequestResult | null>(null)

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { email: '' },
  })

  async function onSubmit(data: z.infer<typeof formSchema>) {
    setIsLoading(true)
    try {
      const nextResult = await userAuthApi.requestPasswordReset(data)
      setResult(nextResult)
      form.reset()
      toast.success('重置请求已提交')
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '提交失败'
      toast.error(message)
    } finally {
      setIsLoading(false)
    }
  }

  if (result) {
    return (
      <div className='flex flex-col gap-4'>
        <p className='text-sm text-muted-foreground'>
          {result.resetUrl ? '重置链接已生成。' : '如果账号存在，请按收到的重置链接继续。'}
        </p>
        {result.resetUrl ? (
          <Button asChild>
            <a href={result.resetUrl}>打开重置链接</a>
          </Button>
        ) : null}
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
        <Button className='mt-2' disabled={isLoading}>
          继续
          {isLoading ? <Loader2 className='animate-spin' /> : <ArrowRight />}
        </Button>
      </form>
    </Form>
  )
}
