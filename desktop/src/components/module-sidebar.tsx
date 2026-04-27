import type { ReactNode } from "react"
import { Plus, Search, type LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import { cn } from "@/lib/utils"

type ModuleSidebarProps = {
  children: ReactNode
  className?: string
  variant?: "card" | "bare"
}

function ModuleSidebar({ children, className, variant = "card" }: ModuleSidebarProps) {
  return (
    <aside
      className={cn(
        "flex h-full min-h-0 flex-col gap-2",
        variant === "card" && "rounded-2xl bg-background p-2 ring-1 ring-foreground/10",
        className,
      )}
    >
      {children}
    </aside>
  )
}

type ModuleSidebarHeaderProps = {
  searchValue?: string
  onSearchChange?: (value: string) => void
  searchPlaceholder?: string
  searchDisabled?: boolean
  onAddClick?: () => void
  addDisabled?: boolean
  addTitle?: string
  actions?: ReactNode
}

function ModuleSidebarHeader({
  searchValue,
  onSearchChange,
  searchPlaceholder,
  searchDisabled,
  onAddClick,
  addDisabled,
  addTitle,
  actions,
}: ModuleSidebarHeaderProps) {
  const showSearch = onSearchChange !== undefined

  return (
    <div className="flex items-center gap-2">
      {showSearch ? (
        <InputGroup className="min-w-0 flex-1">
          <InputGroupInput
            value={searchValue ?? ""}
            disabled={searchDisabled}
            onChange={(event) => onSearchChange?.(event.target.value)}
            placeholder={searchPlaceholder}
          />
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
        </InputGroup>
      ) : null}
      {onAddClick ? (
        <Button
          variant="outline"
          size="icon"
          disabled={addDisabled}
          onClick={onAddClick}
          title={addTitle}
        >
          <Plus />
          <span className="sr-only">{addTitle}</span>
        </Button>
      ) : null}
      {actions}
    </div>
  )
}

type ModuleSidebarListProps = {
  children: ReactNode
  className?: string
}

function ModuleSidebarList({ children, className }: ModuleSidebarListProps) {
  return (
    <div className={cn("min-h-0 flex-1 overflow-y-auto", className)}>
      <div className="flex flex-col">{children}</div>
    </div>
  )
}

type ModuleSidebarItemProps = {
  active?: boolean
  disabled?: boolean
  icon?: LucideIcon
  iconElement?: ReactNode
  onClick?: () => void
  trailing?: ReactNode
  children: ReactNode
  className?: string
}

function ModuleSidebarItem({
  active,
  disabled,
  icon: Icon,
  iconElement,
  onClick,
  trailing,
  children,
  className,
}: ModuleSidebarItemProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-8 w-full items-center justify-between rounded-lg px-3 text-sm font-medium text-foreground/80 transition-colors outline-none",
        "hover:bg-muted/60 hover:text-foreground",
        "focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50",
        "disabled:pointer-events-none disabled:opacity-50",
        active && "bg-secondary text-secondary-foreground hover:bg-secondary",
        className,
      )}
    >
      <span className="flex min-w-0 items-center gap-2 text-left">
        {Icon ? <Icon className="size-4 shrink-0" /> : iconElement ?? null}
        <span className="truncate">{children}</span>
      </span>
      {trailing ? <span className="ml-2 shrink-0">{trailing}</span> : null}
    </button>
  )
}

export {
  ModuleSidebar,
  ModuleSidebarHeader,
  ModuleSidebarItem,
  ModuleSidebarList,
}
