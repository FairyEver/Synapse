import * as React from "react"
import { type VariantProps } from "class-variance-authority"
import { AlertDialog as AlertDialogPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { Button, buttonVariants } from "@/components/ui/button"
import { track, mergeRefs } from "@/lib/ui-tracking"

const AlertDialogTrackContext = React.createContext<React.MutableRefObject<string | undefined> | null>(null)

function AlertDialog({
  "data-track": dataTrack,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Root> & {
  "data-track"?: string
}) {
  const titleRef = React.useRef<string | undefined>(undefined)
  return (
    <AlertDialogTrackContext.Provider value={titleRef}>
      <AlertDialogPrimitive.Root
        data-slot="alert-dialog"
        onOpenChange={(open) => {
          track({ component: "alert-dialog", name: dataTrack ?? titleRef.current ?? "alert-dialog", action: open ? "open" : "close", eventKey: dataTrack })
          onOpenChange?.(open)
        }}
        {...props}
      />
    </AlertDialogTrackContext.Provider>
  )
}

function AlertDialogTrigger({
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Trigger>) {
  return <AlertDialogPrimitive.Trigger data-slot="alert-dialog-trigger" {...props} />
}

function AlertDialogPortal({
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Portal>) {
  return <AlertDialogPrimitive.Portal data-slot="alert-dialog-portal" {...props} />
}

function AlertDialogOverlay({
  className,
  onPointerDown,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Overlay>) {
  return (
    <AlertDialogPrimitive.Overlay
      data-slot="alert-dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-black/10 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:duration-200 data-open:ease-out data-open:fade-in-0 data-closed:animate-out data-closed:duration-150 data-closed:ease-in data-closed:fade-out-0",
        className,
      )}
      onPointerDown={(event) => {
        onPointerDown?.(event)
        event.preventDefault()
      }}
      {...props}
    />
  )
}

function AlertDialogContent({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Content>) {
  return (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      <AlertDialogPrimitive.Content
        data-slot="alert-dialog-content"
        className={cn(
          "fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-2 rounded-lg bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10 outline-none sm:max-w-sm data-open:animate-in data-open:duration-200 data-open:ease-out data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:duration-150 data-closed:ease-in data-closed:fade-out-0 data-closed:zoom-out-95",
          className,
        )}
        {...props}
      />
    </AlertDialogPortal>
  )
}

function AlertDialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-header"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  )
}

function AlertDialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-footer"
      className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}
      {...props}
    />
  )
}

function AlertDialogTitle({
  className,
  ref,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Title>) {
  const titleRef = React.useContext(AlertDialogTrackContext)
  const innerRef = React.useRef<HTMLHeadingElement>(null)
  React.useEffect(() => {
    if (titleRef) titleRef.current = innerRef.current?.textContent?.trim()
  })
  return (
    <AlertDialogPrimitive.Title
      ref={mergeRefs(ref, innerRef)}
      data-slot="alert-dialog-title"
      className={cn("font-heading text-base leading-none font-medium", className)}
      {...props}
    />
  )
}

function AlertDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Description>) {
  return (
    <AlertDialogPrimitive.Description
      data-slot="alert-dialog-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

function AlertDialogAction({
  className,
  variant,
  size,
  "data-track": dataTrack,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Action> &
  VariantProps<typeof buttonVariants> & {
    "data-track"?: string
  }) {
  return (
    <AlertDialogPrimitive.Action asChild>
      <Button
        variant={variant}
        size={size}
        className={className}
        data-track={dataTrack}
        {...props}
      />
    </AlertDialogPrimitive.Action>
  )
}

function AlertDialogCancel({
  className,
  "data-track": dataTrack,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Cancel> & {
  "data-track"?: string
}) {
  return (
    <AlertDialogPrimitive.Cancel asChild>
      <Button
        variant="outline"
        className={className}
        data-track={dataTrack}
        {...props}
      />
    </AlertDialogPrimitive.Cancel>
  )
}

export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogTitle,
  AlertDialogTrigger,
}
