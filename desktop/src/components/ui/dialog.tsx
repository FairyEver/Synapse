import * as React from "react"
import { Dialog as DialogPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { XIcon } from "lucide-react"
import { track, mergeRefs } from "@/lib/ui-tracking"

const DialogTrackContext = React.createContext<React.MutableRefObject<string | undefined> | null>(null)

function Dialog({
  "data-track": dataTrack,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root> & {
  "data-track"?: string
}) {
  const titleRef = React.useRef<string | undefined>(undefined)
  return (
    <DialogTrackContext.Provider value={titleRef}>
      <DialogPrimitive.Root
        data-slot="dialog"
        onOpenChange={(open) => {
          track({ component: "dialog", name: dataTrack ?? titleRef.current ?? "dialog", action: open ? "open" : "close", eventKey: dataTrack })
          onOpenChange?.(open)
        }}
        {...props}
      />
    </DialogTrackContext.Provider>
  )
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-black/10 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:duration-200 data-open:ease-out data-open:fade-in-0 data-closed:animate-out data-closed:duration-150 data-closed:ease-in data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
}) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          "fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-2 rounded-lg bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10 outline-none sm:max-w-sm data-open:animate-in data-open:duration-200 data-open:ease-out data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:duration-150 data-closed:ease-in data-closed:fade-out-0 data-closed:zoom-out-95",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close data-slot="dialog-close" asChild>
            <Button
              variant="ghost"
              className="absolute top-2 right-2 z-10"
              size="icon-sm"
            >
              <XIcon />
              <span className="sr-only">关闭</span>
            </Button>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  )
}

function DialogFrame({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-frame"
      className={cn("flex h-full min-h-0 flex-col overflow-hidden", className)}
      {...props}
    />
  )
}

function DialogFrameHeader({
  actions,
  bordered = false,
  center,
  children,
  className,
  description,
  descriptionClassName,
  showCloseButton = true,
  title,
  titleClassName,
  ...props
}: Omit<React.ComponentProps<"div">, "title"> & {
  readonly actions?: React.ReactNode
  readonly bordered?: boolean
  readonly center?: React.ReactNode
  readonly description?: React.ReactNode
  readonly descriptionClassName?: string
  readonly showCloseButton?: boolean
  readonly title?: React.ReactNode
  readonly titleClassName?: string
}) {
  const titleBlock = title || description ? (
    <div className="min-w-0">
      {title ? <DialogTitle className={cn("truncate", titleClassName)}>{title}</DialogTitle> : null}
      {description ? <DialogDescription className={cn("mt-2 truncate", descriptionClassName)}>{description}</DialogDescription> : null}
    </div>
  ) : null
  const rightBlock = actions || showCloseButton ? (
    <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
      {actions}
      {showCloseButton ? (
        <DialogClose asChild>
          <Button type="button" variant="ghost" size="icon-sm">
            <XIcon />
            <span className="sr-only">关闭</span>
          </Button>
        </DialogClose>
      ) : null}
    </div>
  ) : null

  return (
    <div
      data-slot="dialog-frame-header"
      className={cn(
        "shrink-0 px-5 py-4",
        bordered && "border-b",
        center && "grid min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3",
        className
      )}
      {...props}
    >
      {center ? (
        <>
          {titleBlock ?? <div />}
          <div className="min-w-0">{center}</div>
          {rightBlock ?? <div />}
          {children ? <div className="col-span-full">{children}</div> : null}
        </>
      ) : (
        <>
          <div className="flex min-w-0 items-start justify-between gap-3">
            {titleBlock}
            {rightBlock}
          </div>
          {children}
        </>
      )}
    </div>
  )
}

function DialogFrameBody({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-frame-body"
      className={cn("min-h-0 flex-1", className)}
      {...props}
    />
  )
}

function DialogFrameFooter({
  children,
  className,
  showCloseButton = false,
  ...props
}: React.ComponentProps<"div"> & {
  readonly showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-frame-footer"
      className={cn(
        "mx-0 mb-0 shrink-0 flex flex-col-reverse gap-2 rounded-none rounded-b-xl border-t bg-muted/50 px-5 py-4 sm:flex-row sm:items-center sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton ? (
        <DialogClose asChild>
          <Button type="button" variant="outline">关闭</Button>
        </DialogClose>
      ) : null}
    </div>
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">关闭</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({
  className,
  ref,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  const titleRef = React.useContext(DialogTrackContext)
  const innerRef = React.useRef<HTMLHeadingElement>(null)
  React.useEffect(() => {
    if (titleRef) titleRef.current = innerRef.current?.textContent?.trim()
  })
  return (
    <DialogPrimitive.Title
      ref={mergeRefs(ref, innerRef)}
      data-slot="dialog-title"
      className={cn(
        "font-heading text-base leading-none font-medium",
        className
      )}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFrame,
  DialogFrameBody,
  DialogFrameFooter,
  DialogFrameHeader,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
