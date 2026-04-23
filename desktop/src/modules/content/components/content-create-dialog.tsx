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
import { FormDialog } from "@/components/form-dialog"
import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { FieldError } from "@/components/ui/field"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

type ContentCreateDialogLabels = {
  title: { create: string; edit: string }
  discardDescription: string
}

type ContentCreateDialogProps = {
  children: ReactNode
  extraSubmitDisabled?: boolean
  isDiscardConfirmOpen: boolean
  isDuplicateWarningOpen?: boolean
  isSubmitting: boolean
  labels: ContentCreateDialogLabels
  mode: "create" | "edit"
  onDialogOpenChange: (open: boolean) => void
  onDiscard: () => void
  onDiscardConfirmOpenChange: (open: boolean) => void
  onDuplicateWarningContinue?: () => void
  onDuplicateWarningOpenChange?: (open: boolean) => void
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void
  open: boolean
  submitDisabled?: boolean
  submitDisabledReason?: string | null
  submitError: string | null
}

function ContentCreateDialog({
  children,
  extraSubmitDisabled = false,
  isDiscardConfirmOpen,
  isDuplicateWarningOpen = false,
  isSubmitting,
  labels,
  mode,
  onDialogOpenChange,
  onDiscard,
  onDiscardConfirmOpenChange,
  onDuplicateWarningContinue,
  onDuplicateWarningOpenChange,
  onSubmit,
  open,
  submitDisabled = false,
  submitDisabledReason = null,
  submitError,
}: ContentCreateDialogProps) {
  return (
    <>
      <AlertDialog open={isDiscardConfirmOpen} onOpenChange={onDiscardConfirmOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>放弃当前填写内容？</AlertDialogTitle>
            <AlertDialogDescription>
              {labels.discardDescription}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>继续编辑</AlertDialogCancel>
            <AlertDialogAction
              onClick={onDiscard}
            >
              放弃
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {onDuplicateWarningOpenChange ? (
        <AlertDialog open={isDuplicateWarningOpen} onOpenChange={onDuplicateWarningOpenChange}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>名称重复</AlertDialogTitle>
              <AlertDialogDescription>
                当前仓库中已存在同名的内容，继续保存可能导致混淆。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>去修改</AlertDialogCancel>
              <AlertDialogAction onClick={onDuplicateWarningContinue}>
                继续保存
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}

      <Dialog open={open} onOpenChange={onDialogOpenChange}>
        <FormDialog
          title={mode === "create" ? labels.title.create : labels.title.edit}
          contentClassName={mode === "edit" ? "sm:max-w-[850px]" : "sm:max-w-[520px]"}
          footer={(
            <>
              <FieldError className="sm:mr-auto">{submitError}</FieldError>
              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                <Button
                  type="button"
                  variant="outline"
                  disabled={isSubmitting}
                  onClick={() => onDialogOpenChange(false)}
                >
                  取消
                </Button>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span>
                        <Button
                          type="submit"
                          disabled={isSubmitting || extraSubmitDisabled || submitDisabled}
                        >
                          {isSubmitting ? "正在保存..." : mode === "create" ? "保存" : "保存修改"}
                        </Button>
                      </span>
                    </TooltipTrigger>
                    {submitDisabled && submitDisabledReason ? (
                      <TooltipContent>{submitDisabledReason}</TooltipContent>
                    ) : null}
                  </Tooltip>
                </TooltipProvider>
              </div>
            </>
          )}
          onSubmit={onSubmit}
        >
          {children}
        </FormDialog>
      </Dialog>
    </>
  )
}

export { ContentCreateDialog }
export type { ContentCreateDialogLabels }
