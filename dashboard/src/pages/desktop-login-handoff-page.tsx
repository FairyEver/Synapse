import { useEffect, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router';

import { BrandIcon } from '@/components/brand-icon';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/hooks/use-auth';
import { dashboardApi } from '@/lib/api';

const desktopLoginCodeRequests = new Map<string, Promise<string>>();

export function DesktopLoginHandoffPage() {
  const { isAuthenticated, isLoading, session } = useAuth();
  const [searchParams] = useSearchParams();
  const state = (searchParams.get('state') ?? '').trim();
  const isValidState = state.length >= 16;
  const [deepLinkUrl, setDeepLinkUrl] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isValidState || isLoading || !isAuthenticated || !session) return;

    setError('');

    void issueDesktopLoginCodeOnce(state)
      .then((nextDeepLinkUrl) => {
        setDeepLinkUrl(nextDeepLinkUrl);
        window.location.href = nextDeepLinkUrl;
      })
      .catch((nextError) => {
        setError(nextError instanceof Error ? nextError.message : '打开失败');
      });
  }, [isAuthenticated, isLoading, isValidState, session, state]);

  if (!isValidState) {
    return (
      <main className="flex min-h-svh items-center justify-center bg-muted p-6">
        <div className="w-full max-w-sm">
          <ErrorState message="登录请求无效" />
        </div>
      </main>
    );
  }

  if (isLoading) {
    return (
      <main className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">
        加载中
      </main>
    );
  }

  if (!isAuthenticated || !session) {
    return (
      <Navigate
        to={`/login?client=desktop&state=${encodeURIComponent(state)}`}
        replace
      />
    );
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted p-6">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="flex items-center justify-center gap-2">
            <BrandIcon className="size-6 rounded-md" />
            <CardTitle>打开 Synapse</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button
            disabled={!deepLinkUrl}
            onClick={() => {
              window.location.href = deepLinkUrl;
            }}
          >
            打开
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}

function issueDesktopLoginCodeOnce(state: string) {
  const existingRequest = desktopLoginCodeRequests.get(state);
  if (existingRequest) return existingRequest;

  const request = dashboardApi
    .issueDesktopLoginCode({ state })
    .then((result) => result.deepLinkUrl)
    .catch((error) => {
      desktopLoginCodeRequests.delete(state);
      throw error;
    });

  desktopLoginCodeRequests.set(state, request);
  return request;
}

function ErrorState({ message }: { message: string }) {
  return (
    <Card>
      <CardContent>
        <p className="text-sm text-destructive">{message}</p>
      </CardContent>
    </Card>
  );
}
