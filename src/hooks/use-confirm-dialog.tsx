import { useCallback, useRef, useState } from "react"
import type { ReactNode } from "react"
import { AlertDialog as AlertDialogPrimitive } from "radix-ui"
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

type ConfirmOptions = {
  title: string
  description?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  variant?: "default" | "destructive"
}

type ConfirmState =
  | {
      isOpen: true
      options: ConfirmOptions
      resolve: (value: boolean) => void
    }
  | {
      isOpen: false
      options: null
      resolve: null
    }

function useConfirmDialog() {
  const [state, setState] = useState<ConfirmState>({
    isOpen: false,
    options: null,
    resolve: null,
  })

  const resolveRef = useRef(state.resolve)
  resolveRef.current = state.resolve

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      setState({
        isOpen: true,
        options,
        resolve,
      })
    })
  }, [])

  const handleConfirm = useCallback(() => {
    resolveRef.current?.(true)
    setState({
      isOpen: false,
      options: null,
      resolve: null,
    })
  }, [])

  const handleCancel = useCallback(() => {
    resolveRef.current?.(false)
    setState({
      isOpen: false,
      options: null,
      resolve: null,
    })
  }, [])

  const handleOpenChange = useCallback((open: boolean) => {
    if (!open) {
      resolveRef.current?.(false)
      setState({
        isOpen: false,
        options: null,
        resolve: null,
      })
    }
  }, [])

  const dialog = state.isOpen ? (
    <AlertDialog open={state.isOpen} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{state.options.title}</AlertDialogTitle>
          {state.options.description ? (
            <AlertDialogDescription>{state.options.description}</AlertDialogDescription>
          ) : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={handleCancel}>
            {state.options.cancelLabel ?? "取消"}
          </AlertDialogCancel>
          <AlertDialogPrimitive.AlertDialogAction asChild>
            <Button
              onClick={handleConfirm}
              variant={state.options.variant === "destructive" ? "destructive" : "default"}
            >
              {state.options.confirmLabel ?? "确认"}
            </Button>
          </AlertDialogPrimitive.AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  ) : null

  return { confirm, dialog }
}

export { useConfirmDialog }
export type { ConfirmOptions }
