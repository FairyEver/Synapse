import { TextField } from '@heroui/react';
import { Button, Chip, Input, Label, toast } from '@heroui/react';
import { useEffect, useState } from 'react';
import { normalizeUserHandle, normalizeUserNickname, normalizeUserContactEmail, userContactEmailMaxLength, userHandleMaxLength, } from '@synapse/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { dashboardApi } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { PasswordResetSettings } from './password-reset-settings';
const maxHandleLength = userHandleMaxLength;
type HandleError = 'format' | 'unavailable';
function getHandleError(value: string): HandleError | null {
    if (!value)
        return null;
    try {
        normalizeUserHandle(value);
        return null;
    }
    catch (error) {
        if (!(error instanceof Error))
            return 'format';
        if (error.message.includes('保留路由') || error.message.includes('Windows')) {
            return 'unavailable';
        }
        return 'format';
    }
}
function getNicknameError(value: string): string | null {
    try {
        normalizeUserNickname(value);
        return null;
    }
    catch (error) {
        return error instanceof Error ? error.message : '昵称无效。';
    }
}
function getContactEmailError(value: string): string | null {
    try {
        normalizeUserContactEmail(value);
        return null;
    }
    catch (error) {
        return error instanceof Error ? error.message : '联系邮箱无效。';
    }
}
export function ProfileSettings() {
    const queryClient = useQueryClient();
    const authUser = useAuthStore((state) => state.auth.user);
    const setAuthUser = useAuthStore((state) => state.auth.setUser);
    const [handle, setHandle] = useState('');
    const [nickname, setNickname] = useState('');
    const [contactEmail, setContactEmail] = useState('');
    const { data, error, isError, isLoading, refetch } = useQuery({
        queryKey: ['dashboard-me'],
        queryFn: dashboardApi.getMe,
        enabled: Boolean(authUser),
    });
    const updateProfile = useMutation({
        mutationFn: dashboardApi.updateMe,
        onSuccess: (nextData) => {
            queryClient.setQueryData(['dashboard-me'], nextData);
            if (authUser) {
                setAuthUser({
                    ...authUser,
                    email: nextData.user.email,
                    handle: nextData.user.handle,
                });
            }
            toast.success('已保存');
        },
        onError: (mutationError: Error) => toast.danger(mutationError.message),
    });
    useEffect(() => {
        if (data) {
            setHandle(data.user.handle ?? '');
            setNickname(data.user.nickname ?? '');
            setContactEmail(data.user.contactEmail ?? '');
        }
    }, [data]);
    if (isLoading) {
        return <div className='text-sm text-muted'>加载中...</div>;
    }
    if (isError) {
        return (<div className='flex flex-col items-start gap-3'>
        <div className='space-y-1'>
          <div className='font-medium'>加载失败</div>
          <p className='text-sm text-muted'>
            {error instanceof Error ? error.message : '请求失败'}
          </p>
        </div>
        <Button variant="outline" onPress={() => void refetch()}>
          重试
        </Button>
      </div>);
    }
    if (!data)
        return null;
    const trimmedHandle = handle.trim().toLowerCase();
    const handleError = getHandleError(trimmedHandle);
    const isHandleInvalid = trimmedHandle.length === 0 ||
        handleError !== null;
    const handleChanged = trimmedHandle !== data.user.handle;
    const trimmedNickname = nickname.trim();
    // 输入框还是空的（例如刚打开页面、昵称还没从服务端读回来）时不报错，与用户名一致：
    // 空值只让保存按钮不可用，等读者真的填过什么再谈对错。
    const nicknameError = nickname === '' ? null : getNicknameError(trimmedNickname);
    const isNicknameInvalid = trimmedNickname.length === 0 ||
        nicknameError !== null;
    const nicknameChanged = trimmedNickname !== data.user.nickname;
    const contactEmailError = getContactEmailError(contactEmail);
    const nextContactEmail = contactEmail.trim() || null;
    const contactEmailChanged = nextContactEmail !== (data.user.contactEmail ?? null);
    const isInvalid = isHandleInvalid || isNicknameInvalid || contactEmailError !== null;
    const hasChanged = handleChanged || nicknameChanged || contactEmailChanged;
    function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (isInvalid || !hasChanged)
            return;
        updateProfile.mutate({
            ...(handleChanged ? { handle: trimmedHandle } : {}),
            ...(nicknameChanged ? { nickname: trimmedNickname } : {}),
            ...(contactEmailChanged ? { contactEmail: nextContactEmail } : {}),
        });
    }
    return (<section className='flex flex-1 flex-col'>

      <div className='w-full pb-8'>
        <div className='max-w-4xl space-y-8'>
          <div className='grid gap-3 text-sm'>
            <div className='grid gap-1 sm:grid-cols-3 sm:items-center'>
              <span className='text-muted'>登录邮箱</span>
              <span className='truncate sm:col-span-2'>{data.user.email}</span>
            </div>
            <div className='grid gap-1 sm:grid-cols-3 sm:items-center'>
              <span className='text-muted'>状态</span>
              <div className='sm:col-span-2'>
                <Chip variant={data.user.status === "active" ? "soft" : "secondary"}>
                  {data.user.status === 'active' ? '正常' : '禁用'}
                </Chip>
              </div>
            </div>
          </div>

          <form className='space-y-4' onSubmit={handleSubmit}>
            <TextField className='grid gap-3 md:grid-cols-3 md:items-center'>
              <Label htmlFor='user-handle'>用户名</Label>
              <Input className='w-full md:col-span-2' id='user-handle' value={handle} maxLength={maxHandleLength} onChange={(event) => setHandle(event.target.value)}></Input>
              {handleError === 'format' ? (<p className='text-sm text-danger md:col-span-2 md:col-start-2'>只能使用小写字母、数字和连字符，并以字母或数字开头和结尾。</p>) : null}
              {handleError === 'unavailable' ? (<p className='text-sm text-danger md:col-span-2 md:col-start-2'>该用户名不可用。</p>) : null}
            </TextField>
            <TextField className='grid gap-3 md:grid-cols-3 md:items-center'>
              <Label htmlFor='user-nickname'>昵称</Label>
              <Input className='w-full md:col-span-2' id='user-nickname' value={nickname} onChange={(event) => setNickname(event.target.value)}></Input>
              {nicknameError ? (<p className='text-sm text-danger md:col-span-2 md:col-start-2'>{nicknameError}</p>) : null}
            </TextField>
            <TextField className='grid gap-3 md:grid-cols-3 md:items-center'>
              <Label htmlFor='user-contact-email'>联系邮箱</Label>
              <Input className='w-full md:col-span-2' id='user-contact-email' type='email' value={contactEmail} maxLength={userContactEmailMaxLength} onChange={(event) => setContactEmail(event.target.value)}></Input>
              {contactEmailError ? (<p className='text-sm text-danger md:col-span-2 md:col-start-2'>{contactEmailError}</p>) : null}
            </TextField>
            <Button type='submit' isDisabled={isInvalid || !hasChanged || updateProfile.isPending}>
              保存
            </Button>
          </form>

          <PasswordResetSettings />
        </div>
      </div>
    </section>);
}
