import { Button, Card, Spinner } from '@heroui/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate } from '@tanstack/react-router';
import { DESKTOP_CLIENT_ID, DESKTOP_PKCE_CHALLENGE_METHOD, DESKTOP_REDIRECT_URI, } from '@synapse/shared';
import { useAuthStore } from '@/stores/auth-store';
import { dashboardApi, type DesktopAuthorizeInput } from '@/lib/api';
import { AuthLayout } from '../auth-layout';
const protocolFallbackDelayMs = 3500;
const protocolFallbackMessage = '未检测到 Synapse 桌面应用。请确认已安装并允许浏览器打开。';
const invalidRequestError = 'invalid_request';
type DesktopAuthSearch = {
    client_id?: string;
    redirect_uri?: string;
    response_type?: string;
    state?: string;
    code_challenge?: string;
    code_challenge_method?: string;
};
type DesktopAuthProps = {
    search: DesktopAuthSearch;
};
type AuthorizeState = {
    status: 'idle';
} | {
    status: 'opening';
    deepLinkUrl?: string;
} | {
    status: 'opened';
    deepLinkUrl: string;
} | {
    status: 'error';
    message: string;
    deepLinkUrl?: string;
};
function buildDesktopAuthErrorCallbackUrl(state: string, error: string) {
    const query = new URLSearchParams({ error, state });
    return `${DESKTOP_REDIRECT_URI}?${query.toString()}`;
}
export function buildInvalidDesktopAuthCallbackUrl(search: DesktopAuthSearch) {
    const state = search.state?.trim();
    if (!state || state.length < 16)
        return null;
    return buildDesktopAuthErrorCallbackUrl(state, invalidRequestError);
}
function buildDesktopAuthRedirect(search: DesktopAuthSearch) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(search)) {
        if (value)
            query.set(key, value);
    }
    const suffix = query.toString();
    return suffix ? `/auth/desktop?${suffix}` : '/auth/desktop';
}
function validateDesktopAuthSearch(search: DesktopAuthSearch): DesktopAuthorizeInput | null {
    if (search.client_id !== DESKTOP_CLIENT_ID ||
        search.redirect_uri !== DESKTOP_REDIRECT_URI ||
        search.response_type !== 'code' ||
        search.code_challenge_method !== DESKTOP_PKCE_CHALLENGE_METHOD ||
        !search.state ||
        search.state.trim().length < 16 ||
        !search.code_challenge ||
        search.code_challenge.trim().length < 16) {
        return null;
    }
    return {
        clientId: search.client_id,
        redirectUri: search.redirect_uri,
        state: search.state.trim(),
        codeChallenge: search.code_challenge.trim(),
        codeChallengeMethod: DESKTOP_PKCE_CHALLENGE_METHOD,
    };
}
export function DesktopAuth({ search }: DesktopAuthProps) {
    const navigate = useNavigate();
    const { auth } = useAuthStore();
    const [authorizeState, setAuthorizeState] = useState<AuthorizeState>({
        status: 'idle',
    });
    const [retryKey, setRetryKey] = useState(0);
    const issuedKeyRef = useRef('');
    const protocolFallbackCleanupRef = useRef<(() => void) | null>(null);
    const input = useMemo(() => validateDesktopAuthSearch(search), [search]);
    const invalidCallbackUrl = useMemo(() => (input ? null : buildInvalidDesktopAuthCallbackUrl(search)), [input, search]);
    const redirect = useMemo(() => buildDesktopAuthRedirect(search), [search]);
    const deepLinkUrl = authorizeState.status === 'opening' ||
        authorizeState.status === 'opened' ||
        authorizeState.status === 'error'
        ? authorizeState.deepLinkUrl
        : undefined;
    const isOpening = authorizeState.status === 'idle' || authorizeState.status === 'opening';
    function clearProtocolFallback() {
        protocolFallbackCleanupRef.current?.();
        protocolFallbackCleanupRef.current = null;
    }
    function openDeepLink(deepLinkUrl: string) {
        clearProtocolFallback();
        let didLeavePage = false;
        const markLeavePage = () => {
            didLeavePage = true;
        };
        const markHidden = () => {
            if (document.visibilityState === 'hidden')
                didLeavePage = true;
        };
        const timer = window.setTimeout(() => {
            cleanup();
            if (!didLeavePage) {
                setAuthorizeState({
                    status: 'error',
                    message: protocolFallbackMessage,
                    deepLinkUrl,
                });
            }
        }, protocolFallbackDelayMs);
        function cleanup() {
            window.clearTimeout(timer);
            window.removeEventListener('blur', markLeavePage);
            document.removeEventListener('visibilitychange', markHidden);
        }
        window.addEventListener('blur', markLeavePage);
        document.addEventListener('visibilitychange', markHidden);
        window.location.href = deepLinkUrl;
        protocolFallbackCleanupRef.current = cleanup;
    }
    useEffect(() => {
        if (!input || !auth.isAuthenticated || !auth.user)
            return;
        const issueKey = `${auth.user.sessionId}:${input.state}:${input.codeChallenge}:${retryKey}`;
        if (issuedKeyRef.current === issueKey)
            return;
        issuedKeyRef.current = issueKey;
        setAuthorizeState({ status: 'opening' });
        let cancelled = false;
        void dashboardApi
            .authorizeDesktopLogin(input)
            .then((result) => {
            if (cancelled)
                return;
            setAuthorizeState({ status: 'opened', deepLinkUrl: result.deepLinkUrl });
            openDeepLink(result.deepLinkUrl);
        })
            .catch((error: unknown) => {
            if (cancelled)
                return;
            const message = error instanceof Error ? error.message : '打开失败';
            setAuthorizeState({ status: 'error', message });
        });
        return () => {
            cancelled = true;
            clearProtocolFallback();
            if (issuedKeyRef.current === issueKey) {
                issuedKeyRef.current = '';
            }
        };
    }, [auth.isAuthenticated, auth.user, input, retryKey]);
    useEffect(() => {
        if (input || !invalidCallbackUrl)
            return;
        window.location.href = invalidCallbackUrl;
    }, [input, invalidCallbackUrl]);
    if (!input) {
        return (<AuthLayout>
        <DesktopAuthCard title='登录请求无效'>
          <p className='text-sm text-danger'>请从 Synapse 客户端重新登录。</p>
        </DesktopAuthCard>
      </AuthLayout>);
    }
    if (!auth.isAuthenticated) {
        return <Navigate to='/sign-in' search={{ redirect }} replace/>;
    }
    return (<AuthLayout>
      <DesktopAuthCard title='打开 Synapse' actions={<>
          <Button fullWidth isPending={isOpening} isDisabled={isOpening} onPress={() => {
            if (authorizeState.status === 'error') {
                setRetryKey((value) => value + 1);
                return;
            }
            if (deepLinkUrl) {
                setAuthorizeState({ status: 'opened', deepLinkUrl });
                openDeepLink(deepLinkUrl);
            }
        }}>
            {isOpening ? <Spinner color='current' size='sm' /> : null}
            {authorizeState.status === 'error'
            ? '重试打开 Synapse'
            : authorizeState.status === 'opened'
                ? '再次打开 Synapse'
                : '正在打开 Synapse'}
          </Button>
          <Button fullWidth type='button' variant='secondary' onPress={() => navigate({ to: '/settings', replace: true })}>
            返回首页
          </Button>
        </>}>
        <DesktopAuthStatus state={authorizeState}/>
      </DesktopAuthCard>
    </AuthLayout>);
}
function DesktopAuthStatus({ state }: {
    state: AuthorizeState;
}) {
    if (state.status === 'error') {
        return <p role='alert' className='text-sm wrap-anywhere text-danger'>{state.message}</p>;
    }
    return (<p role='status' className='text-sm text-muted'>
      {state.status === 'opened' ? '请在 Synapse 中继续登录。' : '正在打开 Synapse。'}
    </p>);
}
function DesktopAuthCard({ children, title, actions, }: {
    children: React.ReactNode;
    title: string;
    actions?: React.ReactNode;
}) {
    return (<Card className='w-full max-w-sm gap-4'>
      <Card.Header>
        <Card.Title className='text-lg'>{title}</Card.Title>
      </Card.Header>
      <Card.Content>{children}</Card.Content>
      {actions ? <Card.Footer className='flex-col gap-3'>{actions}</Card.Footer> : null}
    </Card>);
}
