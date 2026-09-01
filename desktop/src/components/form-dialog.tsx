import type { FormEventHandler, ReactNode } from "react"

import {
  DialogContent,
  DialogFrame,
  DialogFrameBody,
  DialogFrameFooter,
  DialogFrameHeader,
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
      showCloseButton={false}
    >
      <form
        className="h-full min-h-0"
        data-track="form-dialog.submit"
        data-track-native="true"
        onSubmit={onSubmit}
      >
        <DialogFrame className="max-h-[calc(100vh-2rem)]">
          <DialogFrameHeader title={title} description={description} />

          <DialogFrameBody>
            <ScrollArea
              className="h-full min-h-0 min-w-0 max-w-full"
              viewportClassName="min-w-0 max-w-full overflow-x-hidden [&>div]:!block [&>div]:!min-w-0 [&>div]:!max-w-full"
            >
              <div className={cn("px-5 py-4", bodyClassName)}>
                {children}
              </div>
            </ScrollArea>
          </DialogFrameBody>

          <DialogFrameFooter>
            {footer}
          </DialogFrameFooter>
        </DialogFrame>
      </form>
    </DialogContent>
  )
}

export { FormDialog }
