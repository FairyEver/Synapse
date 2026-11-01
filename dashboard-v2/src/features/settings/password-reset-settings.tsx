import { TextField } from '@heroui/react';
import { Button, Input, Label, Modal, toast } from '@heroui/react';
import { useState } from 'react';
import { Copy, Loader2 } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { dashboardApi, type PasswordResetLinkResult } from '@/lib/api';
import { formatExactDateTime } from '@/components/relative-time';
export function PasswordResetSettings() {
    const [passwordResetLink, setPasswordResetLink] = useState<PasswordResetLinkResult | null>(null);
    const createPasswordResetLink = useMutation({
        mutationFn: dashboardApi.createMyPasswordResetLink,
        onSuccess: setPasswordResetLink,
        onError: (mutationError: Error) => toast.danger(mutationError.message),
    });
    function closeDialog() {
        setPasswordResetLink(null);
        createPasswordResetLink.reset();
    }
    async function copyPasswordResetLink() {
        if (!passwordResetLink)
            return;
        try {
            await navigator.clipboard.writeText(passwordResetLink.resetUrl);
            toast.success('链接已复制');
        }
        catch {
            toast.danger('复制失败，请手动复制');
        }
    }
    return (<>
      <section className='space-y-3'>
        <h3 className='text-lg font-medium'>密码</h3>
        <Button variant="outline" isDisabled={createPasswordResetLink.isPending} onPress={() => createPasswordResetLink.mutate()}>
          {createPasswordResetLink.isPending ? <Loader2 className='animate-spin'/> : null}
          {createPasswordResetLink.isPending ? '生成中' : '生成重置链接'}
        </Button>
      </section>
      <Modal.Backdrop isOpen={Boolean(passwordResetLink)} onOpenChange={(open) => {
            if (!open)
                closeDialog();
        }}><Modal.Container><Modal.Dialog className='sm:max-w-md'>
          <Modal.Header>
            <Modal.Heading>重置链接已生成</Modal.Heading>
            <p>
              重新生成会使旧链接失效，重置密码后需重新登录。关闭后无法再次查看。
            </p>
          </Modal.Header>
          <Modal.Body>
            <div className='grid gap-3'>
              <TextField className='grid gap-2'>
                <Label htmlFor='password-reset-link'>重置链接</Label>
                <Input id='password-reset-link' readOnly value={passwordResetLink?.resetUrl ?? ''} onFocus={(event) => event.currentTarget.select()}></Input>
              </TextField>
              <p className='text-sm text-muted'>
                有效至 {passwordResetLink ? formatExactDateTime(new Date(passwordResetLink.expiresAt)) : ''}
              </p>
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="outline" onPress={closeDialog}>
              关闭
            </Button>
            <Button onPress={() => void copyPasswordResetLink()}>
              <Copy />
              复制链接
            </Button>
          </Modal.Footer>
        </Modal.Dialog></Modal.Container></Modal.Backdrop>
    </>);
}
