import { type FormEvent, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/hooks/use-auth';
import { userApi } from '@/lib/api';

export function TeamInvitePage() {
  const { isAuthenticated, isLoading, session } = useAuth();
  const [searchParams] = useSearchParams();
  const [token, setToken] = useState(searchParams.get('token') ?? '');
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback('');
    setError('');
    setIsSubmitting(true);

    try {
      await userApi.joinTeam({ token });
      setFeedback('已加入团队');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '加入失败');
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isLoading) {
    return (
      <main className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">
        加载中
      </main>
    );
  }

  if (!isAuthenticated || !session) {
    return <Navigate to="/login" replace />;
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>团队邀请</CardTitle>
          <CardAction>
            <Button asChild variant="link">
              <Link to="/login">登录</Link>
            </Button>
          </CardAction>
        </CardHeader>
        <form onSubmit={onSubmit}>
          <CardContent>
            <div className="flex flex-col gap-6">
              <div className="grid gap-2">
                <Label htmlFor="teamInviteToken">邀请码</Label>
                <Input
                  id="teamInviteToken"
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  required
                />
              </div>
              {feedback ? (
                <p className="text-sm text-muted-foreground">{feedback}</p>
              ) : null}
              {error ? (
                <p className="text-sm text-destructive">{error}</p>
              ) : null}
            </div>
          </CardContent>
          <CardFooter>
            <Button className="w-full" disabled={isSubmitting} type="submit">
              {isSubmitting ? '加入中' : '加入团队'}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </main>
  );
}
