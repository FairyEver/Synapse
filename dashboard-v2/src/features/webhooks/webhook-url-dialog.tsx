import { TextField } from '@heroui/react';
import { Button, Input, Label, Modal, toast } from '@heroui/react';
import { Copy } from 'lucide-react';
type WebhookUrlDialogProps = {
    open: boolean;
    title: string;
    url: string;
    onOpenChange: (open: boolean) => void;
};
export function WebhookUrlDialog({ open, title, url, onOpenChange, }: WebhookUrlDialogProps) {
    async function copyUrl() {
        try {
            await navigator.clipboard.writeText(url);
            toast.success('已复制');
        }
        catch (error) {
            toast.danger(error instanceof Error ? error.message : '复制失败');
        }
    }
    return (<Modal.Backdrop isOpen={open} onOpenChange={onOpenChange}><Modal.Container><Modal.Dialog>
        <Modal.Header>
          <Modal.Heading>{title}</Modal.Heading>
        </Modal.Header>
        <Modal.Body>
          <TextField className='grid gap-2'>
            <Label htmlFor='webhook-url'>URL</Label>
            <Input id='webhook-url' readOnly value={url}></Input>
          </TextField>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline" onPress={() => onOpenChange(false)}>
            关闭
          </Button>
          <Button onPress={() => void copyUrl()}>
            <Copy />
            复制
          </Button>
        </Modal.Footer>
      </Modal.Dialog></Modal.Container></Modal.Backdrop>);
}
