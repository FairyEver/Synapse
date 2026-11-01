import { consoleHref } from '@/lib/console-href';
import { Link as HeroLink } from '@heroui/react';
import { Button, Input, toast } from '@heroui/react';
import { useState } from 'react';
import { normalizeUserHandle, userHandleMaxLength } from '@synapse/shared';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { ApiError, userAuthApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { PasswordInput } from '@/components/password-input';
import { TextField, Label, FieldError } from '@heroui/react';
import { buildAuthRedirectSearch } from '../../auth-redirect-search';
import { zodResolver } from '../../zod-resolver';
const duplicateEmailMessage = '邮箱已注册。';
const formSchema = z
    .object({
    email: z.email({ error: () => '请输入有效的邮箱地址' }),
    handle: z.string().trim().min(1, '请输入用户名').max(userHandleMaxLength, `用户名不能超过 ${userHandleMaxLength} 个字符`),
    password: z.string().min(8, '密码至少 8 个字符'),
    confirmPassword: z.string().min(1, '请再次输入密码'),
})
    .refine((data) => data.password === data.confirmPassword, {
    message: '两次输入的密码不一致',
    path: ['confirmPassword'],
})
    .refine((data) => {
    try {
        normalizeUserHandle(data.handle);
        return true;
    }
    catch {
        return false;
    }
}, {
    message: '只能使用小写字母、数字和连字符，并以字母或数字开头和结尾。',
    path: ['handle'],
});
export function SignUpForm({ className, redirectTo, ...props }: React.HTMLAttributes<HTMLFormElement> & {
    redirectTo?: string;
}) {
    const [isLoading, setIsLoading] = useState(false);
    const [registeredEmail, setRegisteredEmail] = useState<string | null>(null);
    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            email: '',
            handle: '',
            password: '',
            confirmPassword: '',
        },
    });
    async function onSubmit(data: z.infer<typeof formSchema>) {
        setIsLoading(true);
        try {
            await userAuthApi.register({
                email: data.email,
                handle: normalizeUserHandle(data.handle),
                password: data.password,
            });
            setRegisteredEmail(data.email);
            form.reset();
            toast.success('账号已创建');
        }
        catch (err: unknown) {
            if (err instanceof ApiError &&
                err.status === 400 &&
                err.message === duplicateEmailMessage) {
                form.setError('email', {
                    type: 'server',
                    message: duplicateEmailMessage,
                }, { shouldFocus: true });
                return;
            }
            if (err instanceof ApiError && err.status === 400 && err.message.includes('用户名')) {
                form.setError('handle', {
                    type: 'server',
                    message: err.message,
                }, { shouldFocus: true });
                return;
            }
            const message = err instanceof Error ? err.message : '注册失败';
            toast.danger(message);
        }
        finally {
            setIsLoading(false);
        }
    }
    if (registeredEmail) {
        return (<div className='flex flex-col gap-4'>
        <p className='text-sm text-muted'>
          {registeredEmail} 已创建，可以登录 Synapse。
        </p>
        <HeroLink href={consoleHref('/sign-in', { search: buildAuthRedirectSearch(redirectTo) })}>去登录</HeroLink>
      </div>);
    }
    return <form noValidate onSubmit={form.handleSubmit(onSubmit)} className={cn('grid gap-5', className)} {...props}>
      <TextField isInvalid={Boolean(form.formState.errors.email)}><Label htmlFor='auth-email'>邮箱</Label><Input variant="secondary" id='auth-email' type='email' inputMode='email' autoCapitalize='none' autoCorrect='off' spellCheck={false} autoComplete='email' {...form.register('email')} value={form.watch('email')}/><FieldError>{form.formState.errors.email?.message}</FieldError></TextField>
      <TextField isInvalid={Boolean(form.formState.errors.handle)}><Label htmlFor='auth-handle'>用户名</Label><Input variant="secondary" id='auth-handle' type='text' autoComplete='username' {...form.register('handle')} value={form.watch('handle')}/><FieldError>{form.formState.errors.handle?.message}</FieldError></TextField>
      <TextField isInvalid={Boolean(form.formState.errors.password)}><Label htmlFor='auth-password'>密码</Label><PasswordInput variant="secondary" id='auth-password' autoComplete='new-password' {...form.register('password')} value={form.watch('password')}/><FieldError>{form.formState.errors.password?.message}</FieldError></TextField>
      <TextField isInvalid={Boolean(form.formState.errors.confirmPassword)}><Label htmlFor='auth-confirmPassword'>确认密码</Label><PasswordInput variant="secondary" id='auth-confirmPassword' autoComplete='new-password' {...form.register('confirmPassword')} value={form.watch('confirmPassword')}/><FieldError>{form.formState.errors.confirmPassword?.message}</FieldError></TextField>
      <Button type='submit' isPending={isLoading} isDisabled={isLoading} fullWidth>创建账号</Button>
    </form>;
}
