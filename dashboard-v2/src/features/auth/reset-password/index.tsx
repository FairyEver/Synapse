import { consoleHref } from '@/lib/console-href';
import { Link as HeroLink } from '@heroui/react';
import { Button, Card, Skeleton } from '@heroui/react';
import { useState } from 'react';
import { useSearch } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { userAuthApi } from '@/lib/api';
import { buildAuthRedirectSearch, normalizeAuthRedirect } from '../auth-redirect-search';
import { AuthLayout } from '../auth-layout';
import { ResetPasswordForm } from './components/reset-password-form';
export function ResetPassword() {
    const { token, redirect } = useSearch({ from: '/(auth)/reset-password' });
    const redirectTo = normalizeAuthRedirect(redirect);
    const [isComplete, setIsComplete] = useState(false);
    const validation = useQuery({
        queryKey: ['password-reset-token', token],
        queryFn: () => userAuthApi.validatePasswordResetToken(token!),
        enabled: Boolean(token),
        retry: false,
    });
    const isInvalid = !token || validation.data?.valid === false;
    const title = isComplete
        ? '密码已更新'
        : isInvalid
            ? '链接已失效'
            : validation.isError
                ? '无法验证链接'
                : '重设密码';
    const description = isComplete
        ? undefined
        : isInvalid
            ? '请联系管理员重新生成重置链接。'
            : validation.isError
                ? '请检查网络后重试。'
                : '输入新密码完成重设。';
    return (<AuthLayout>
      <Card className='w-full max-w-sm'>
        <Card.Header>
          <Card.Title className='text-lg'>{title}</Card.Title>
          {description ? <Card.Description>{description}</Card.Description> : null}
        </Card.Header>
        <Card.Content>
          {isComplete ? (<HeroLink className='w-full' href={consoleHref('/sign-in', { search: buildAuthRedirectSearch(redirectTo) })}>
                去登录
              </HeroLink>) : isInvalid ? null : validation.isPending ? (<div className='grid gap-3' aria-label='正在验证链接'>
              <Skeleton className='h-4 w-16'></Skeleton>
              <Skeleton className='h-9 w-full'></Skeleton>
              <Skeleton className='h-4 w-16'></Skeleton>
              <Skeleton className='h-9 w-full'></Skeleton>
              <Skeleton className='h-9 w-full'></Skeleton>
            </div>) : validation.isError ? (<Button variant="outline" className='w-full' onPress={() => void validation.refetch()}>
              重试
            </Button>) : validation.data?.valid ? (<ResetPasswordForm token={token} onComplete={() => setIsComplete(true)}/>) : (<Skeleton className='h-9 w-full'></Skeleton>)}
        </Card.Content>
        {!isComplete ? <Card.Footer>
          <p className='mx-auto px-8 text-center text-sm text-muted'>
            返回{' '}
            <HeroLink className='underline underline-offset-4 hover:text-accent' href={consoleHref('/sign-in', { search: buildAuthRedirectSearch(redirectTo) })}>
              登录
            </HeroLink>
          </p>
        </Card.Footer> : null}
      </Card>
    </AuthLayout>);
}
