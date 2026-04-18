import type { FormEventHandler, ReactNode } from "react"

import {
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

type FormDialogProps = {
  children: ReactNode
  contentClassName?: string
  description?: ReactNode
  footer: ReactNode
  onSubmit: FormEventHandler<HTMLFormElement>
  title: ReactNode
}

function FormDialog({
  children,
  contentClassName,
  description,
  footer,
  onSubmit,
  title,
}: FormDialogProps) {
  return (
    <DialogContent
      className={cn("max-h-[calc(100vh-2rem)] overflow-hidden p-0", contentClassName)}
    >
      <form className="flex max-h-[calc(100vh-2rem)] flex-col" onSubmit={onSubmit}>
        <DialogHeader className="px-5 pt-5">
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

        <DialogFooter className="mx-0 mb-0 shrink-0 flex-col gap-3 rounded-none rounded-b-xl px-5 py-4 sm:flex-row sm:items-center sm:justify-end">
          {footer}
        </DialogFooter>
      </form>
    </DialogContent>
  )
}

export { FormDialog }
