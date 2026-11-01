import { TextField } from '@heroui/react';
import { Button, Input, Label, Modal, toast } from '@heroui/react';
import { Copy, Loader2 } from 'lucide-react';
import type { AdminUserRow, PasswordResetLinkResult } from '@/lib/api';
import { formatExactDateTime } from '@/components/relative-time';
type UserPasswordResetLinkDialogProps = {
    open: boolean;
    user: AdminUserRow | null;
    result?: PasswordResetLinkResult;
    isPending: boolean;
    onGenerate: () => void;
    onOpenChange: (open: boolean) => void;
};
export function UserPasswordResetLinkDialog({ open, user, result, isPending, onGenerate, onOpenChange, }: UserPasswordResetLinkDialogProps) {
    async function copyLink() {
        if (!result)
            return;
        try {
            await navigator.clipboard.writeText(result.resetUrl);
            toast.success('链接已复制');
        }
        catch {
            toast.danger('复制失败，请手动复制');
        }
    }
    return (<Modal.Backdrop isOpen={open} onOpenChange={onOpenChange}>
      <Modal.Container><Modal.Dialog className='sm:max-w-md'><Modal.CloseTrigger />
        <Modal.Header>
          <Modal.Heading>
            {result ? '重置链接已生成' : '生成重置链接'}
          </Modal.Heading>
          <p>
            {result
            ? `发送给 ${user?.email ?? '该用户'}。关闭后无法再次查看。`
            : `${user?.email ?? '该用户'} 的链接将在 30 分钟后失效。生成后，之前未使用的链接将失效。`}
          </p>
        </Modal.Header><Modal.Body>
        {result ? (<div className='grid gap-3'>
            <TextField className='grid gap-2'>
              <Label htmlFor='password-reset-link'>重置链接</Label>
              <Input variant="secondary" id='password-reset-link' readOnly value={result.resetUrl} onFocus={(event) => event.currentTarget.select()}/>
            </TextField>
            <p className='text-sm text-muted'>
              有效至 {formatExactDateTime(new Date(result.expiresAt))}
            </p>
          </div>) : null}
        </Modal.Body><Modal.Footer>
          <Button variant='outline' isDisabled={isPending} onPress={() => onOpenChange(false)}>
            {result ? '关闭' : '取消'}
          </Button>
          {result ? (<Button onPress={() => void copyLink()}>
              <Copy />
              复制链接
            </Button>) : (<Button isDisabled={isPending} onPress={onGenerate}>
              {isPending ? <Loader2 className='animate-spin'/> : null}
              {isPending ? '生成中' : '生成链接'}
            </Button>)}
        </Modal.Footer>
      </Modal.Dialog></Modal.Container>
    </Modal.Backdrop>);
}
