import { consoleHref } from '@/lib/console-href';
import { Link as HeroLink } from '@heroui/react';
import { Card } from '@heroui/react';
import { useSearch } from '@tanstack/react-router';
import { buildAuthRedirectSearch, normalizeAuthRedirect } from '../auth-redirect-search';
import { AuthLayout } from '../auth-layout';
import { UserAuthForm } from './components/user-auth-form';
export function SignIn() {
    const { redirect } = useSearch({ from: '/(auth)/sign-in' });
    const redirectTo = normalizeAuthRedirect(redirect);
    return (<AuthLayout>
      <Card className='w-full max-w-sm'>
        <Card.Header>
          <Card.Title className='text-lg'>登录</Card.Title>
        </Card.Header>
        <Card.Content>
          <UserAuthForm redirectTo={redirectTo}/>
        </Card.Content>
        <Card.Footer>
          <p className='text-center text-sm text-muted'>
            没有账号？{' '}
            <HeroLink className='inline-flex min-h-11 items-center underline underline-offset-4 hover:text-accent sm:min-h-0' href={consoleHref('/sign-up', { search: buildAuthRedirectSearch(redirectTo) })}>
              创建账号
            </HeroLink>
          </p>
        </Card.Footer>
      </Card>
    </AuthLayout>);
}
