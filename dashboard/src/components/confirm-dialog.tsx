import { useEffect, useRef, type ComponentProps, type ReactNode } from 'react';
import { AlertDialog, Button } from '@heroui/react';
type ConfirmDialogProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: ReactNode;
    desc: ReactNode;
    cancelBtnText?: string;
    confirmText?: ReactNode;
    destructive?: boolean;
    disabled?: boolean;
    isLoading?: boolean;
    className?: string;
    contentProps?: ComponentProps<typeof AlertDialog.Dialog> & {
        [key: `data-${string}`]: unknown;
    };
    children?: ReactNode;
    onCloseAutoFocus?: (event: Event) => void;
} & ({
    form: string;
    handleConfirm?: undefined;
} | {
    form?: undefined;
    handleConfirm: () => void;
});
/** Business confirmation, shared by account and administrative mutations. */
export function ConfirmDialog({ open, onOpenChange, title, desc, cancelBtnText = '取消', confirmText = '确认', destructive, disabled, isLoading, className, contentProps, children, form, handleConfirm, onCloseAutoFocus }: ConfirmDialogProps) {
    const wasOpen = useRef(false);
    useEffect(() => {
        const closed = wasOpen.current && !open;
        wasOpen.current = open;
        if (!closed || !onCloseAutoFocus)
            return;
        const frame = requestAnimationFrame(() => onCloseAutoFocus(new Event('dialog-closed', { cancelable: true })));
        return () => cancelAnimationFrame(frame);
    }, [open, onCloseAutoFocus]);
    return <AlertDialog.Backdrop isOpen={open} onOpenChange={(next) => {
            if (!isLoading)
                onOpenChange(next);
        }} isDismissable={!isLoading} isKeyboardDismissDisabled={isLoading}>
      <AlertDialog.Container>
        <AlertDialog.Dialog {...contentProps} className={className}>
          <AlertDialog.Header><AlertDialog.Heading>{title}</AlertDialog.Heading></AlertDialog.Header>
          <AlertDialog.Body><div>{desc}</div>{children}</AlertDialog.Body>
          <AlertDialog.Footer>
            <Button variant="tertiary" isDisabled={isLoading} onPress={() => onOpenChange(false)} autoFocus>{cancelBtnText}</Button>
            <Button type={form ? 'submit' : 'button'} form={form} onPress={handleConfirm} variant={destructive ? "danger" : "primary"} isDisabled={disabled || isLoading} isPending={isLoading}>{confirmText}</Button>
          </AlertDialog.Footer>
        </AlertDialog.Dialog>
      </AlertDialog.Container>
    </AlertDialog.Backdrop>;
}
