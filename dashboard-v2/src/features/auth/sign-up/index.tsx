import { consoleHref } from '@/lib/console-href';
import { Link as HeroLink } from '@heroui/react';
import { Card } from '@heroui/react';
import { useSearch } from '@tanstack/react-router';
import { buildAuthRedirectSearch, normalizeAuthRedirect } from '../auth-redirect-search';
import { AuthLayout } from '../auth-layout';
import { SignUpForm } from './components/sign-up-form';
export function SignUp() {
    const { redirect } = useSearch({ from: '/(auth)/sign-up' });
    const redirectTo = normalizeAuthRedirect(redirect);
    return (<AuthLayout>
      <Card className='w-full max-w-sm'>
        <Card.Header>
          <Card.Title className='text-lg'>创建账号</Card.Title>
        </Card.Header>
        <Card.Content>
          <SignUpForm redirectTo={redirectTo}/>
        </Card.Content>
        <Card.Footer>
          <p className='px-8 text-center text-sm text-muted'>
            已有账号？{' '}
            <HeroLink className='underline underline-offset-4 hover:text-accent' href={consoleHref('/sign-in', { search: buildAuthRedirectSearch(redirectTo) })}>
              登录
            </HeroLink>
          </p>
        </Card.Footer>
      </Card>
    </AuthLayout>);
}
