import { isValidElement, useEffect, useMemo, useState } from "react"
import type { ReactNode, RefObject } from "react"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"

type DelayedConfirmAlertDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: ReactNode
  confirmLabel: string
  cancelLabel?: string
  delaySeconds: number
  onConfirm: () => void | Promise<void>
  confirmLoadingLabel?: string
  returnFocusRef?: RefObject<HTMLElement | null>
}

function DelayedConfirmAlertDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = "取消",
  delaySeconds,
  onConfirm,
  confirmLoadingLabel,
  returnFocusRef,
}: DelayedConfirmAlertDialogProps) {
  const [secondsLeft, setSecondsLeft] = useState(delaySeconds)
  const [isConfirming, setIsConfirming] = useState(false)

  useEffect(() => {
    if (!open) {
      setSecondsLeft(delaySeconds)
      return
    }

    setSecondsLeft(delaySeconds)

    const intervalId = window.setInterval(() => {
      setSecondsLeft((currentValue) => {
        if (currentValue <= 1) {
          window.clearInterval(intervalId)
          return 0
        }

        return currentValue - 1
      })
    }, 1000)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [delaySeconds, open])

  const resolvedConfirmLabel = useMemo(
    () => (secondsLeft > 0 ? `${confirmLabel} (${secondsLeft})` : confirmLabel),
    [confirmLabel, secondsLeft],
  )

  const handleConfirm = async () => {
    if (isConfirming) return
    setIsConfirming(true)
    try {
      await onConfirm()
    } finally {
      setIsConfirming(false)
      onOpenChange(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent
        onCloseAutoFocus={returnFocusRef ? (event) => {
          event.preventDefault()
          returnFocusRef.current?.focus()
        } : undefined}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {isValidElement(description) ? (
            <AlertDialogDescription asChild>{description}</AlertDialogDescription>
          ) : (
            <AlertDialogDescription>{description}</AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isConfirming}>{cancelLabel}</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={secondsLeft > 0 || isConfirming}
            onClick={() => {
              void handleConfirm()
            }}
          >
            {isConfirming ? (confirmLoadingLabel ?? "处理中...") : resolvedConfirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export { DelayedConfirmAlertDialog }
