import type { ComponentProps, FormEvent } from 'react';
import { Link } from 'react-router';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface LoginFormProps extends ComponentProps<'div'> {
  readonly email: string;
  readonly error: string;
  readonly isSubmitting: boolean;
  readonly onEmailChange: (value: string) => void;
  readonly onLoginSubmit: (event: FormEvent<HTMLFormElement>) => void;
  readonly onPasswordChange: (value: string) => void;
  readonly password: string;
}

export function LoginForm({
  className,
  email,
  error,
  isSubmitting,
  onEmailChange,
  onLoginSubmit,
  onPasswordChange,
  password,
  ...props
}: LoginFormProps) {
  const hasError = error.length > 0;

  return (
    <div className={cn('flex flex-col gap-6', className)} {...props}>
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-xl">管理后台登录</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onLoginSubmit}>
            <FieldGroup>
              <Field data-invalid={hasError}>
                <FieldLabel htmlFor="email">邮箱</FieldLabel>
                <Input
                  id="email"
                  aria-invalid={hasError}
                  autoComplete="email"
                  onChange={(event) => onEmailChange(event.target.value)}
                  required
                  type="email"
                  value={email}
                />
              </Field>
              <Field data-invalid={hasError}>
                <FieldLabel htmlFor="password">密码</FieldLabel>
                <Input
                  id="password"
                  aria-invalid={hasError}
                  autoComplete="current-password"
                  onChange={(event) => onPasswordChange(event.target.value)}
                  required
                  type="password"
                  value={password}
                />
              </Field>
              {hasError ? <FieldError>{error}</FieldError> : null}
              <Field>
                <Button disabled={isSubmitting} type="submit">
                  {isSubmitting ? '登录中' : '登录'}
                </Button>
                <FieldDescription className="text-center">
                  没有账号？ <Link to="/signup">注册</Link>
                </FieldDescription>
              </Field>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
