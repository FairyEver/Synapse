import { Button, Input, toast } from '@heroui/react';
import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useAuthStore } from '@/stores/auth-store';
import { dashboardApi } from '@/lib/api';
import { isRootPublicDashboardRedirect, isRootNotificationDashboardRedirect, isRootGameDashboardRedirect } from '@/lib/dashboard-redirect';
import { cn } from '@/lib/utils';
import { PasswordInput } from '@/components/password-input';
import { TextField, Label, FieldError } from '@heroui/react';
import { zodResolver } from '../../zod-resolver';
const formSchema = z.object({
    email: z.email({ error: () => '请输入有效的邮箱地址' }),
    password: z.string().min(1, '请输入密码'),
});
type UserAuthFormProps = React.HTMLAttributes<HTMLFormElement> & {
    redirectTo?: string;
};
export function UserAuthForm({ className, redirectTo, ...props }: UserAuthFormProps) {
    const [isLoading, setIsLoading] = useState(false);
    const navigate = useNavigate();
    const { auth } = useAuthStore();
    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema),
        defaultValues: { email: '', password: '' },
    });
    async function onSubmit(data: z.infer<typeof formSchema>) {
        setIsLoading(true);
        try {
            const session = await dashboardApi.login(data);
            auth.setUser(session);
            toast.success(`欢迎回来，${session.email}`);
            const nextPath = redirectTo || '/settings';
            if (isRootPublicDashboardRedirect(nextPath) || isRootNotificationDashboardRedirect(nextPath) || isRootGameDashboardRedirect(nextPath)) {
                window.location.assign(nextPath);
                return;
            }
            await navigate({
                href: nextPath,
                replace: true,
            });
        }
        catch (err: unknown) {
            const message = err instanceof Error ? err.message : '登录失败';
            toast.danger(message);
        }
        finally {
            setIsLoading(false);
        }
    }
    return <form noValidate onSubmit={form.handleSubmit(onSubmit)} className={cn('grid gap-5', className)} {...props}>
      <TextField isInvalid={Boolean(form.formState.errors.email)}><Label htmlFor='auth-email'>邮箱</Label><Input variant="secondary" id='auth-email' type='email' inputMode='email' autoCapitalize='none' autoCorrect='off' spellCheck={false} autoComplete='email' {...form.register('email')} value={form.watch('email')}/><FieldError>{form.formState.errors.email?.message}</FieldError></TextField>
      <TextField isInvalid={Boolean(form.formState.errors.password)}><Label htmlFor='auth-password'>密码</Label><PasswordInput variant="secondary" id='auth-password' autoComplete='current-password' {...form.register('password')} value={form.watch('password')}/><FieldError>{form.formState.errors.password?.message}</FieldError></TextField>
      <p className='text-sm text-muted'>忘记密码请联系管理员</p>
      <Button type='submit' isPending={isLoading} isDisabled={isLoading} fullWidth>登录</Button>
    </form>;
}
