import { forwardRef } from "react"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

type DataTableCellChoiceOption = { value: string; label: string }

type DataTableCellChoiceCommonProps = {
  options: readonly (string | DataTableCellChoiceOption)[]
  placeholder?: string
  disabled?: boolean
  onFocus?: () => void
  className?: string
}

type DataTableCellChoiceSingleProps = DataTableCellChoiceCommonProps & {
  multiple?: false
  value: string
  onChange: (value: string) => void
}

type DataTableCellChoiceMultipleProps = DataTableCellChoiceCommonProps & {
  multiple: true
  value: readonly string[]
  onChange: (value: string[]) => void
}

type DataTableCellChoiceProps =
  | DataTableCellChoiceSingleProps
  | DataTableCellChoiceMultipleProps

function normalizeOption(option: string | DataTableCellChoiceOption): DataTableCellChoiceOption {
  return typeof option === "string" ? { value: option, label: option } : option
}

const DATA_TABLE_CELL_CHOICE_CONTENT_MAX_HEIGHT =
  "min(300px, var(--radix-dropdown-menu-content-available-height))"

const DataTableCellChoice = forwardRef<HTMLButtonElement, DataTableCellChoiceProps>(
  function DataTableCellChoice(props, ref) {
    const { options, placeholder = "选择...", disabled, onFocus, className } = props
    const normalizedOptions = options.map(normalizeOption)

    let display = placeholder
    if (props.multiple) {
      if (props.value.length > 0) {
        display = props.value.join(", ")
      }
    } else if (props.value) {
      display = props.value
    }

    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={disabled}>
          <button
            ref={ref}
            type="button"
            data-slot="data-table-cell-choice"
            onFocus={onFocus}
            className={cn(
              "block w-full appearance-none border-0 bg-transparent p-0 text-left disabled:cursor-not-allowed disabled:opacity-50",
              className,
            )}
          >
            <span className="block w-full min-w-0 max-w-full truncate p-0 text-xs text-primary outline-none">
              {display}
            </span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="w-48"
          style={{ maxHeight: DATA_TABLE_CELL_CHOICE_CONTENT_MAX_HEIGHT }}
        >
          {props.multiple
            ? normalizedOptions.map((opt) => {
                const checked = props.value.includes(opt.value)
                return (
                  <DropdownMenuCheckboxItem
                    key={opt.value}
                    checked={checked}
                    onSelect={(event) => event.preventDefault()}
                    onCheckedChange={() => {
                      const next = checked
                        ? props.value.filter((v) => v !== opt.value)
                        : [...props.value, opt.value]
                      props.onChange(next)
                    }}
                  >
                    {opt.label}
                  </DropdownMenuCheckboxItem>
                )
              })
            : normalizedOptions.map((opt) => (
                <DropdownMenuItem
                  key={opt.value}
                  onSelect={() => props.onChange(opt.value)}
                >
                  {opt.label}
                </DropdownMenuItem>
              ))}
        </DropdownMenuContent>
      </DropdownMenu>
    )
  },
)

DataTableCellChoice.displayName = "DataTableCellChoice"

export { DataTableCellChoice }
export type { DataTableCellChoiceOption, DataTableCellChoiceProps }
