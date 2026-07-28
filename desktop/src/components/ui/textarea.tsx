import * as React from "react"

import { cn } from "@/lib/utils"
import { track } from "@/lib/ui-tracking"

function Textarea({
  className,
  "data-track": dataTrack,
  onFocus,
  onBlur,
  rows = 3,
  ...props
}: React.ComponentProps<"textarea"> & {
  "data-track"?: string
}) {
  const label = dataTrack ?? props.placeholder ?? props.name ?? "textarea"
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex w-full min-w-0 rounded-lg border border-input bg-transparent px-3 py-2 text-base transition-colors outline-none select-text cursor-text placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className,
      )}
      rows={rows}
      onFocus={(e) => {
        track({ component: "textarea", name: label, action: "focus" })
        onFocus?.(e)
      }}
      onBlur={(e) => {
        track({ component: "textarea", name: label, action: "blur" })
        onBlur?.(e)
      }}
      {...props}
    />
  )
}

export { Textarea }
