import { forwardRef } from "react"
import type { ComponentProps } from "react"
import { cn } from "@/lib/utils"

type DataTableCellInputProps = ComponentProps<"input">

const DataTableCellInput = forwardRef<HTMLInputElement, DataTableCellInputProps>(
  ({ className, ...props }, ref) => {
    return (
      <input
        ref={ref}
        data-slot="data-table-cell-input"
        className={cn(
          "block w-full min-w-0 max-w-full appearance-none rounded-none border-0 bg-transparent p-0 text-xs text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      />
    )
  },
)

DataTableCellInput.displayName = "DataTableCellInput"

export { DataTableCellInput }
