import { TextField } from '@heroui/react';
import { Button, Input, Label, Modal } from '@heroui/react';
import { useEffect, useState } from 'react';
export const teamNameMaxLength = 30;
type TeamNameDialogProps = {
    open: boolean;
    title: string;
    initialName: string;
    submitText: string;
    isPending: boolean;
    error: string | null;
    onOpenChange: (open: boolean) => void;
    onSubmit: (name: string) => void;
};
export function TeamNameDialog({ open, title, initialName, submitText, isPending, error, onOpenChange, onSubmit, }: TeamNameDialogProps) {
    const [name, setName] = useState(initialName);
    useEffect(() => {
        if (open)
            setName(initialName);
    }, [open, initialName]);
    const trimmedName = name.trim();
    const tooLong = trimmedName.length > teamNameMaxLength;
    const localError = tooLong
        ? `团队名称不能超过 ${teamNameMaxLength} 个字符。`
        : null;
    const message = localError ?? error;
    return (<Modal.Backdrop isOpen={open} onOpenChange={onOpenChange}>
      <Modal.Container><Modal.Dialog className='sm:max-w-md'><Modal.CloseTrigger />
        <Modal.Header>
          <Modal.Heading>{title}</Modal.Heading>
          <p className='sr-only'>{title}。</p>
        </Modal.Header><Modal.Body>
        <TextField className='grid gap-2'>
          <Label htmlFor='team-name'>团队名称</Label>
          <Input id='team-name' value={name} autoComplete='off' aria-invalid={Boolean(message)} onChange={(event) => setName(event.target.value)}/>
          {message ? (<p className='text-sm text-danger'>{message}</p>) : null}
        </TextField>
        </Modal.Body><Modal.Footer>
          <Button variant='outline' onPress={() => onOpenChange(false)}>
            取消
          </Button>
          <Button isDisabled={isPending || !trimmedName || tooLong} onPress={() => onSubmit(trimmedName)}>
            {submitText}
          </Button>
        </Modal.Footer>
      </Modal.Dialog></Modal.Container>
    </Modal.Backdrop>);
}
