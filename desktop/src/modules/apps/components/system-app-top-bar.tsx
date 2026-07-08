import type { ComponentProps, ReactNode } from "react"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

type DataAttributeProps = {
  readonly [key: `data-${string}`]: string | number | boolean | undefined
}

type SystemAppTopBarSlotProps = ComponentProps<"div"> & DataAttributeProps

type SystemAppTopBarProps = ComponentProps<"div"> & {
  readonly left?: ReactNode
  readonly center?: ReactNode
  readonly actions?: ReactNode
  readonly leftSlotProps?: SystemAppTopBarSlotProps
  readonly centerSlotProps?: SystemAppTopBarSlotProps
  readonly actionsSlotProps?: SystemAppTopBarSlotProps
}

type SystemAppTopBarActionsProps = ComponentProps<"div">

type SystemAppTopBarActionButtonProps = Omit<ComponentProps<typeof Button>, "size" | "variant"> & {
  readonly iconOnly?: boolean
  readonly tone?: "default" | "destructive"
  readonly tooltip?: ReactNode
}

function SystemAppTopBar({
  actions,
  actionsSlotProps,
  center,
  centerSlotProps,
  className,
  left,
  leftSlotProps,
  ...props
}: SystemAppTopBarProps) {
  return (
    <div
      data-system-app-top-bar
      className={cn(
        "grid min-h-10 shrink-0 grid-cols-[minmax(0,1fr)_minmax(0,max-content)_minmax(0,1fr)] items-center gap-2 border-b bg-background px-3",
        className,
      )}
      {...props}
    >
      <div
        {...leftSlotProps}
        data-system-app-top-bar-left
        className={cn("flex min-w-0 items-center gap-2", leftSlotProps?.className)}
      >
        {left}
      </div>
      {center ? (
        <div
          {...centerSlotProps}
          data-system-app-top-bar-center
          className={cn("min-w-0 justify-self-center", centerSlotProps?.className)}
        >
          {center}
        </div>
      ) : (
        <div className="min-w-0" aria-hidden="true" />
      )}
      <div
        {...actionsSlotProps}
        data-system-app-top-bar-actions
        className={cn("min-w-0 justify-self-end", actionsSlotProps?.className)}
      >
        {actions ? <SystemAppTopBarActions>{actions}</SystemAppTopBarActions> : null}
      </div>
    </div>
  )
}

function SystemAppTopBarActions({ className, ...props }: SystemAppTopBarActionsProps) {
  return (
    <div
      data-system-app-top-bar-action-group
      className={cn("flex items-center justify-end gap-0 whitespace-nowrap", className)}
      {...props}
    />
  )
}

function SystemAppTopBarActionButton({
  children,
  className,
  iconOnly = false,
  tone = "default",
  tooltip,
  ...props
}: SystemAppTopBarActionButtonProps) {
  const button = (
    <Button
      variant="ghost"
      size={iconOnly ? "icon-sm" : "sm"}
      className={cn(
        "relative after:absolute after:inset-x-0 after:-inset-y-1.5 after:content-['']",
        tone === "destructive"
          && "text-destructive hover:bg-muted hover:text-destructive focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 [&_svg]:text-destructive",
        className,
      )}
      {...props}
    >
      {children}
    </Button>
  )

  if (!tooltip) return button

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          {button}
        </TooltipTrigger>
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export {
  SystemAppTopBar,
  SystemAppTopBarActionButton,
  SystemAppTopBarActions,
}
