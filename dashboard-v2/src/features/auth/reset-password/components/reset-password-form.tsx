import { Button, toast } from '@heroui/react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { userAuthApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { PasswordInput } from '@/components/password-input';
import { TextField, Label, FieldError } from '@heroui/react';
import { zodResolver } from '../../zod-resolver';
const formSchema = z
    .object({
    password: z.string().min(8, '密码至少 8 个字符'),
    confirmPassword: z.string().min(1, '请再次输入密码'),
})
    .refine((data) => data.password === data.confirmPassword, {
    message: '两次输入的密码不一致',
    path: ['confirmPassword'],
});
type ResetPasswordFormProps = React.HTMLAttributes<HTMLFormElement> & {
    token: string;
    onComplete: () => void;
};
export function ResetPasswordForm({ className, onComplete, token, ...props }: ResetPasswordFormProps) {
    const [isLoading, setIsLoading] = useState(false);
    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema),
        defaultValues: { password: '', confirmPassword: '' },
    });
    async function onSubmit(data: z.infer<typeof formSchema>) {
        setIsLoading(true);
        try {
            await userAuthApi.resetPassword({ token, password: data.password });
            form.reset();
            toast.success('密码已更新');
            onComplete();
        }
        catch (err: unknown) {
            const message = err instanceof Error ? err.message : '重设失败';
            toast.danger(message);
        }
        finally {
            setIsLoading(false);
        }
    }
    return <form noValidate onSubmit={form.handleSubmit(onSubmit)} className={cn('grid gap-5', className)} {...props}>
      <TextField isInvalid={Boolean(form.formState.errors.password)}><Label htmlFor='auth-password'>新密码</Label><PasswordInput variant="secondary" id='auth-password' autoComplete='new-password' {...form.register('password')} value={form.watch('password')}/><FieldError>{form.formState.errors.password?.message}</FieldError></TextField>
      <TextField isInvalid={Boolean(form.formState.errors.confirmPassword)}><Label htmlFor='auth-confirmPassword'>确认密码</Label><PasswordInput variant="secondary" id='auth-confirmPassword' autoComplete='new-password' {...form.register('confirmPassword')} value={form.watch('confirmPassword')}/><FieldError>{form.formState.errors.confirmPassword?.message}</FieldError></TextField>
      <Button type='submit' isPending={isLoading} isDisabled={isLoading} fullWidth>更新密码</Button>
    </form>;
}
