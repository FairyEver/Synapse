import { useMemo, type HTMLAttributes, type KeyboardEvent, type MouseEvent, type ReactNode, type UIEventHandler } from "react"
import { Plus, Search, type LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import { ScrollArea } from "@/components/ui/scroll-area"
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
} & Omit<HTMLAttributes<HTMLElement>, "children" | "className">

function ModuleSidebar({
  children,
  className,
  "data-layout": dataLayout,
  variant = "card",
  ...asideProps
}: ModuleSidebarProps) {
  return (
    <aside
      {...asideProps}
      data-layout={dataLayout}
      className={cn(
        "flex h-full min-h-0 min-w-0 flex-col gap-2 p-2",
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
  return (
    <ScrollArea
      className={cn("min-h-0 min-w-0 w-full max-w-full flex-1", className)}
      data-track={dataTrack}
      onViewportScroll={onScroll}
    >
      <div className="flex min-w-0 w-full max-w-full flex-col overflow-hidden px-0.5 py-0.5">{children}</div>
    </ScrollArea>
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

type ModuleSidebarGroupProps = {
  readonly actions?: ReactNode
  readonly children: ReactNode
  readonly className?: string
  readonly closedIcon?: LucideIcon
  readonly contentClassName?: string
  readonly headerClassName?: string
  readonly "data-track"?: string
  readonly onOpenChange: (open: boolean) => void
  readonly open: boolean
  readonly openIcon?: LucideIcon
  readonly title: ReactNode
}

function ModuleSidebarGroup({
  actions,
  children,
  className,
  closedIcon: ClosedIcon,
  contentClassName,
  headerClassName,
  "data-track": dataTrack,
  onOpenChange,
  open,
  openIcon: OpenIcon,
  title,
}: ModuleSidebarGroupProps) {
  const Icon = open ? OpenIcon : ClosedIcon

  return (
    <Collapsible open={open} onOpenChange={onOpenChange} data-track={dataTrack} className={cn("grid gap-0.5", className)}>
      <div className={cn("flex h-8 w-full items-center justify-between rounded-lg px-2 transition-colors hover:bg-muted/50", headerClassName)}>
        <CollapsibleTrigger className="flex h-full min-w-0 flex-1 items-center gap-2 text-left text-sm font-medium text-foreground/80 outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50">
          {Icon ? <Icon className="size-4 shrink-0 text-muted-foreground" /> : null}
          <span className="truncate">{title}</span>
        </CollapsibleTrigger>
        {actions ? <div className="ml-1 flex h-full shrink-0 items-center gap-0.5">{actions}</div> : null}
      </div>
      <CollapsibleContent>
        <div className={cn("flex w-full min-w-0 flex-col gap-0.5 pl-3", contentClassName)}>
          {children}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

type ModuleSidebarRowProps = {
  readonly active: boolean
  readonly children: ReactNode
  readonly className?: string
  readonly "data-track"?: string
  readonly icon?: ReactNode
  readonly onDoubleClick?: () => void
  readonly onSelect: () => void
  readonly trailing?: ReactNode
  readonly trackValue: string
}

function ModuleSidebarRow({
  active,
  children,
  className,
  "data-track": dataTrack = "module-sidebar-row-select",
  icon,
  onDoubleClick,
  onSelect,
  trailing,
  trackValue,
}: ModuleSidebarRowProps) {
  function handleSelect(event: MouseEvent<HTMLDivElement> | KeyboardEvent<HTMLDivElement>) {
    track({
      component: "module-sidebar-item",
      name: extractLabel(event.currentTarget) ?? dataTrack,
      action: "select",
      value: trackValue,
    })
    onSelect()
  }

  function handleDoubleClick(event: MouseEvent<HTMLDivElement>) {
    if (event.target instanceof Element && event.target.closest("button")) return
    onDoubleClick?.()
  }

  return (
    <div
      role="button"
      tabIndex={0}
      data-track={dataTrack}
      aria-current={active ? "page" : undefined}
      onClick={handleSelect}
      onDoubleClick={handleDoubleClick}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return
        event.preventDefault()
        handleSelect(event)
      }}
      className={cn(
        "group/item flex h-8 w-full min-w-0 items-center rounded-md px-2 text-sm font-medium text-foreground/80 transition-colors outline-none",
        "hover:bg-muted/60 hover:text-foreground",
        "focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50",
        active && "bg-secondary text-secondary-foreground hover:bg-secondary",
        className,
      )}
    >
      <span className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-xs font-normal">
        {icon}
        <span className="block min-w-0 flex-1 truncate">{children}</span>
      </span>
      {trailing ? (
        <span className="ml-2 flex w-16 shrink-0 items-center justify-end text-right tabular-nums">{trailing}</span>
      ) : null}
    </div>
  )
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
  const mainButton = (
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
        "flex min-w-0 max-w-full flex-1 items-center gap-2 overflow-hidden text-left box-border",
        !disabled && "rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
      )}
    >
      {Icon ? <Icon className="size-4 shrink-0" /> : iconElement ?? null}
      <span className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <span className="block truncate">{children}</span>
        {description ? (
          <span className="block truncate text-xs font-normal text-muted-foreground">
            {description}
          </span>
        ) : null}
      </span>
    </button>
  )

  if (disabled) {
    return (
      <div
        data-track={dataTrack}
        className={cn(
          "flex w-full min-w-0 max-w-full box-border items-center justify-between overflow-hidden rounded-lg px-3 text-sm font-medium text-foreground/80",
          description ? "min-h-11 py-1.5" : "h-8",
          "pointer-events-none opacity-50",
          className,
        )}
      >
        {mainButton}
        {trailing ? <span className="ml-2 shrink-0">{trailing}</span> : null}
      </div>
    )
  }

  return (
    <div
      data-track={dataTrack}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group/item flex w-full min-w-0 max-w-full box-border items-center justify-between overflow-hidden rounded-lg px-3 text-sm font-medium text-foreground/80 transition-colors outline-none",
        description ? "min-h-11 py-1.5" : "h-8",
        "hover:bg-muted/60 hover:text-foreground",
        "focus-within:ring-3 focus-within:ring-inset focus-within:ring-ring/50",
        active && "bg-secondary text-secondary-foreground hover:bg-secondary",
        className,
      )}
    >
      {mainButton}
      {trailing ? <span className="ml-2 shrink-0">{trailing}</span> : null}
    </div>
  )
}

export {
  ModuleSidebar,
  ModuleSidebarGroup,
  ModuleSidebarHeader,
  ModuleSidebarItem,
  ModuleSidebarList,
  ModuleSidebarRow,
}
