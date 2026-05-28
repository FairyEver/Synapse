import { type FormEvent, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import type { Location } from 'react-router';

import { BrandIcon } from '@/components/brand-icon';
import { LoginForm } from '@/components/login-form';
import { useAuth } from '@/hooks/use-auth';
import { ApiError } from '@/lib/api';

export function LoginPage() {
  const { isAuthenticated, login, session } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const searchParams = new URLSearchParams(location.search);
  const desktopState =
    searchParams.get('client') === 'desktop' ? searchParams.get('state') : null;
  const desktopReturnPath =
    desktopState && desktopState.trim().length >= 16
      ? `/desktop-login?state=${encodeURIComponent(desktopState.trim())}`
      : null;

  const from = getSafeReturnPath(location, session?.role);

  if (isAuthenticated) {
    return (
      <Navigate
        to={
          (session?.role === 'user' ? desktopReturnPath : null) ??
          from ??
          (session?.role === 'user' ? '/me' : '/system')
        }
        replace
      />
    );
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      const nextSession = await login({ email, password });
      navigate(
        (nextSession.role === 'user' ? desktopReturnPath : null) ??
          getSafeReturnPath(location, nextSession.role) ??
          (nextSession.role === 'admin' ? '/system' : '/me'),
        {
          replace: true,
        },
      );
    } catch (nextError) {
      setError(nextError instanceof ApiError ? nextError.message : '登录失败');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-6 md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex items-center gap-2 self-center font-medium">
          <BrandIcon className="size-6 rounded-md" />
          Synapse
        </div>
        <LoginForm
          email={email}
          error={error}
          isSubmitting={isSubmitting}
          onEmailChange={setEmail}
          onLoginSubmit={onSubmit}
          onPasswordChange={setPassword}
          password={password}
        />
      </div>
    </main>
  );
}

function getSafeReturnPath(
  location: Location,
  role: 'admin' | 'user' | undefined,
) {
  const state = location.state as { from?: Location } | null;
  const pathname = state?.from?.pathname;
  if (!pathname || pathname === '/login' || !pathname.startsWith('/')) {
    return null;
  }
  if (role === 'admin' && !isAdminPath(pathname)) {
    return null;
  }
  if (role === 'user' && !isUserPath(pathname)) {
    return null;
  }
  return `${pathname}${state?.from?.search ?? ''}${state?.from?.hash ?? ''}`;
}

function isAdminPath(pathname: string) {
  return [
    '/system',
    '/users',
    '/teams',
    '/invitations',
    '/audit-logs',
    '/backup',
    '/logs',
  ].includes(pathname);
}

function isUserPath(pathname: string) {
  return pathname === '/me' || pathname === '/settings' || pathname.startsWith('/modules/');
}
