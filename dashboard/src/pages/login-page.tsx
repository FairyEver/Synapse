import { type FormEvent, useState } from 'react';
import { Navigate, useNavigate } from 'react-router';

import { BrandIcon } from '@/components/brand-icon';
import { LoginForm } from '@/components/login-form';
import { useAuth } from '@/hooks/use-auth';
import { ApiError } from '@/lib/api';

export function LoginPage() {
  const { isAuthenticated, login, session } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (isAuthenticated) {
    return (
      <Navigate to={session?.role === 'user' ? '/me' : '/system'} replace />
    );
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      const nextSession = await login({ email, password });
      navigate(nextSession.role === 'admin' ? '/system' : '/me', {
        replace: true,
      });
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
