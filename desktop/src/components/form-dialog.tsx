import type { FormEventHandler, ReactNode } from "react"

import {
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"

type FormDialogProps = {
  bodyClassName?: string
  children: ReactNode
  contentClassName?: string
  description?: ReactNode
  footer: ReactNode
  onSubmit: FormEventHandler<HTMLFormElement>
  title: ReactNode
}

function FormDialog({
  bodyClassName,
  children,
  contentClassName,
  description,
  footer,
  onSubmit,
  title,
}: FormDialogProps) {
  const contentAccessibilityProps = description ? {} : { "aria-describedby": undefined }

  return (
    <DialogContent
      {...contentAccessibilityProps}
      className={cn("max-h-[calc(100vh-2rem)] overflow-hidden p-0", contentClassName)}
    >
      <form
        className="flex h-full min-h-0 max-h-[calc(100vh-2rem)] flex-col overflow-hidden"
        onSubmit={onSubmit}
      >
        <DialogHeader className="px-5 pt-5">
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>

        <ScrollArea className="min-h-0 flex-1">
          <div className={cn("px-5 py-4", bodyClassName)}>
            {children}
          </div>
        </ScrollArea>

        <DialogFooter className="mx-0 mb-0 shrink-0 flex-col gap-2 rounded-none rounded-b-xl px-5 py-4 sm:flex-row sm:items-center sm:justify-end">
          {footer}
        </DialogFooter>
      </form>
    </DialogContent>
  )
}

export { FormDialog }
