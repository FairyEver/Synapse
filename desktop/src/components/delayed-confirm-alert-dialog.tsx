import { isValidElement, useEffect, useMemo, useState } from "react"
import type { ReactNode } from "react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

type DelayedConfirmAlertDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: ReactNode
  confirmLabel: string
  cancelLabel?: string
  delaySeconds: number
  onConfirm: () => void
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
}: DelayedConfirmAlertDialogProps) {
  const [secondsLeft, setSecondsLeft] = useState(delaySeconds)

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

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {isValidElement(description) ? (
            <AlertDialogDescription asChild>{description}</AlertDialogDescription>
          ) : (
            <AlertDialogDescription>{description}</AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            disabled={secondsLeft > 0}
            onClick={onConfirm}
          >
            {resolvedConfirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export { DelayedConfirmAlertDialog }
