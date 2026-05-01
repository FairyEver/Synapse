import { useMemo, useRef, type ReactNode, type UIEventHandler } from "react"
import { Plus, Search, type LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import { cn } from "@/lib/utils"
import {
  debounce,
  extractLabel,
  sanitizeTrackValue,
  track,
} from "@/lib/ui-tracking"

type ModuleSidebarProps = {
  children: ReactNode
  className?: string
  "data-layout"?: string
  variant?: "card" | "bare"
}

function ModuleSidebar({
  children,
  className,
  "data-layout": dataLayout,
  variant = "card",
}: ModuleSidebarProps) {
  return (
    <aside
      data-layout={dataLayout}
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
  searchTrackName?: string
  onAddClick?: () => void
  addDisabled?: boolean
  addTitle?: string
  addTrackName?: string
  actions?: ReactNode
}

function ModuleSidebarHeader({
  searchValue,
  onSearchChange,
  searchPlaceholder,
  searchDisabled,
  searchTrackName,
  onAddClick,
  addDisabled,
  addTitle,
  addTrackName,
  actions,
}: ModuleSidebarHeaderProps) {
  const showSearch = onSearchChange !== undefined
  const logSearchChange = useMemo(
    () => searchTrackName
      ? debounce((value: string) => {
        const sanitizedValue = sanitizeTrackValue(searchTrackName, value)
        track({
          component: "module-sidebar-search",
          name: searchTrackName,
          action: "change",
          value: typeof sanitizedValue === "string" ? sanitizedValue : undefined,
        })
      }, 400)
      : null,
    [searchTrackName],
  )

  return (
    <div className="flex items-center gap-2">
      {showSearch ? (
        <InputGroup className="min-w-0 flex-1">
          <InputGroupInput
            value={searchValue ?? ""}
            disabled={searchDisabled}
            data-track={searchTrackName}
            onChange={(event) => {
              const nextValue = event.target.value
              onSearchChange?.(nextValue)
              logSearchChange?.(nextValue)
            }}
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
          data-track={addTrackName}
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
  "data-track"?: string
  onScroll?: UIEventHandler<HTMLDivElement>
}

function ModuleSidebarList({
  children,
  className,
  "data-track": dataTrack,
  onScroll,
}: ModuleSidebarListProps) {
  const lastScrollTopRef = useRef(0)
  const logScroll = useMemo(
    () => dataTrack
      ? debounce((snapshot: {
        clientHeight: number
        direction: "down" | "up"
        percent: number
        scrollHeight: number
        scrollTop: number
      }) => {
        track({
          component: "module-sidebar-list",
          name: dataTrack,
          action: "scroll",
          value: snapshot.percent,
          metadata: snapshot,
        })
      }, 500)
      : null,
    [dataTrack],
  )

  return (
    <div
      className={cn("min-h-0 flex-1 overflow-y-auto", className)}
      data-track={dataTrack}
      onScroll={(event) => {
        if (dataTrack) {
          const target = event.currentTarget
          const scrollTop = target.scrollTop
          const scrollable = Math.max(1, target.scrollHeight - target.clientHeight)
          const direction = scrollTop >= lastScrollTopRef.current ? "down" : "up"
          lastScrollTopRef.current = scrollTop
          logScroll?.({
            clientHeight: target.clientHeight,
            direction,
            percent: Math.round((scrollTop / scrollable) * 100),
            scrollHeight: target.scrollHeight,
            scrollTop,
          })
        }
        onScroll?.(event)
      }}
    >
      <div className="flex flex-col">{children}</div>
    </div>
  )
}

type ModuleSidebarItemProps = {
  active?: boolean
  disabled?: boolean
  icon?: LucideIcon
  iconElement?: ReactNode
  description?: ReactNode
  onClick?: () => void
  trailing?: ReactNode
  children: ReactNode
  className?: string
  "data-track"?: string
  trackValue?: string | number | boolean
}

function ModuleSidebarItem({
  active,
  disabled,
  icon: Icon,
  iconElement,
  description,
  onClick,
  trailing,
  children,
  className,
  "data-track": dataTrack,
  trackValue,
}: ModuleSidebarItemProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      data-track={dataTrack}
      onClick={(event) => {
        track({
          component: "module-sidebar-item",
          name: dataTrack ?? extractLabel(event.currentTarget) ?? "module-sidebar-item",
          action: "select",
          value: trackValue,
        })
        onClick?.()
      }}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex w-full items-center justify-between rounded-lg px-3 text-sm font-medium text-foreground/80 transition-colors outline-none",
        description ? "min-h-11 py-1.5" : "h-8",
        "hover:bg-muted/60 hover:text-foreground",
        "focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50",
        "disabled:pointer-events-none disabled:opacity-50",
        active && "bg-secondary text-secondary-foreground hover:bg-secondary",
        className,
      )}
    >
      <span className="flex min-w-0 items-center gap-2 text-left">
        {Icon ? <Icon className="size-4 shrink-0" /> : iconElement ?? null}
        <span className="flex min-w-0 flex-col">
          <span className="truncate">{children}</span>
          {description ? (
            <span className="truncate text-xs font-normal text-muted-foreground">
              {description}
            </span>
          ) : null}
        </span>
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
