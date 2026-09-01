import { forwardRef } from "react"
import type { ComponentProps } from "react"
import { cn } from "@/lib/utils"
import { track } from "@/lib/ui-tracking"

type DataTableCellInputProps = ComponentProps<"input"> & {
  "data-track"?: string
}

const DataTableCellInput = forwardRef<HTMLInputElement, DataTableCellInputProps>(
  ({ className, "data-track": dataTrack, onBlur, onFocus, ...props }, ref) => {
    const trackName = dataTrack ?? props.name ?? "data-table-cell-input"

    return (
      <input
        ref={ref}
        data-slot="data-table-cell-input"
        data-track={dataTrack}
        className={cn(
          "block w-full min-w-0 max-w-full appearance-none rounded-none border-0 bg-transparent p-0 text-xs text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        onFocus={(event) => {
          track({ component: "data-table-cell-input", name: trackName, action: "focus", eventKey: trackName })
          onFocus?.(event)
        }}
        onBlur={(event) => {
          track({ component: "data-table-cell-input", name: trackName, action: "blur", eventKey: trackName })
          onBlur?.(event)
        }}
        {...props}
      />
    )
  },
)

DataTableCellInput.displayName = "DataTableCellInput"

export { DataTableCellInput }
