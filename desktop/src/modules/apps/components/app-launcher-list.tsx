import { ChevronRight, List, Pin, Search, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "@/components/ui/context-menu"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { ScrollArea } from "@/components/ui/scroll-area"
import { appCategories, systemAppPresentation, type AppCategoryId } from "../app-presentation"
import { REQUIRED_DOCK_APP_ID } from "../dock"
import type { SynapseSystemAppId, SynapseSystemAppManifest } from "../types"
import { DockAppMenuItems } from "./dock-app-menu-items"

type AppLauncherListProps = {
  readonly apps: readonly SynapseSystemAppManifest[]
  readonly focusAppId?: SynapseSystemAppId | null
  readonly pinnedAppIds: readonly SynapseSystemAppId[]
  readonly disabled?: boolean
  readonly onOpenApp: (appId: SynapseSystemAppId) => void
  readonly onPinApp: (appId: SynapseSystemAppId) => void
  readonly onUnpinApp: (appId: SynapseSystemAppId) => void
  readonly onManageDock: () => void
}

type FilterId = "all" | "pinned" | AppCategoryId

export function AppLauncherList({
  apps,
  focusAppId,
  pinnedAppIds,
  disabled = false,
  onOpenApp,
  onPinApp,
  onUnpinApp,
  onManageDock,
}: AppLauncherListProps) {
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<FilterId>("all")
  const searchRef = useRef<HTMLInputElement>(null)
  const focusTargetRef = useRef<HTMLButtonElement>(null)
  const pinnedFilterRef = useRef<HTMLButtonElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (focusAppId) {
      (focusTargetRef.current ?? searchRef.current)?.focus()
    }
  }, [focusAppId])

  const needle = query.trim().toLowerCase()
  const appsById = new Map(apps.map((app) => [app.id, app]))
  const pinned = new Set(pinnedAppIds)
  const matches = (app: SynapseSystemAppManifest) => app.name.toLowerCase().includes(needle)
  const pinnedApps = pinnedAppIds.flatMap((id) => {
    const app = appsById.get(id)
    return app ? [app] : []
  })
  const categories = appCategories.map((category) => ({
    ...category,
    apps: apps.filter((app) => systemAppPresentation[app.id].category === category.id),
  }))
  const filters = [
    { id: "all", name: "全部应用", icon: List, count: apps.length },
    { id: "pinned", name: "已固定", icon: Pin, count: pinnedApps.length },
    ...categories.map(({ id, name, icon, apps }) => ({ id, name, icon, count: apps.length })),
  ] as const
  const groups = (filter === "pinned"
    ? [{ id: "pinned", name: "Dock", apps: pinnedApps }]
    : categories.filter((category) => filter === "all" || category.id === filter))
    .map((group) => ({ ...group, apps: group.apps.filter(matches) }))
    .filter((group) => group.apps.length > 0)
  const resultCount = groups.reduce((count, group) => count + group.apps.length, 0)

  const updateQuery = (nextQuery: string) => {
    setQuery(nextQuery)
    if (viewportRef.current) viewportRef.current.scrollTop = 0
  }

  const unpin = (appId: SynapseSystemAppId) => {
    if (disabled) return
    if (filter === "pinned") pinnedFilterRef.current?.focus()
    onUnpinApp(appId)
  }

  return (
    <div className="@container/launcher flex h-full min-h-0 flex-col bg-background">
      <h1 className="sr-only">应用中心</h1>
      <div className="flex min-h-0 flex-1 flex-col @xl/launcher:flex-row">
        <aside className="flex min-h-0 shrink-0 flex-col border-b border-border bg-sidebar @xl/launcher:w-44 @xl/launcher:border-r @xl/launcher:border-b-0">
          <div className="shrink-0 px-2 pt-2">
            <InputGroup>
              <InputGroupAddon><Search aria-hidden="true" /></InputGroupAddon>
              <InputGroupInput
                ref={searchRef}
                type="search"
                aria-label="搜索应用"
                placeholder="搜索应用"
                value={query}
                className="[&::-webkit-search-cancel-button]:hidden"
                onChange={(event) => updateQuery(event.target.value)}
              />
              {query && (
                <InputGroupAddon align="inline-end">
                  <InputGroupButton
                    size="icon-xs"
                    aria-label="清除搜索"
                    onClick={() => {
                      updateQuery("")
                      searchRef.current?.focus()
                    }}
                  >
                    <X aria-hidden="true" />
                  </InputGroupButton>
                </InputGroupAddon>
              )}
            </InputGroup>
          </div>
          <nav
            aria-label="应用分类"
            className="flex min-h-0 gap-1 overflow-x-auto p-2 @xl/launcher:flex-col @xl/launcher:overflow-y-auto"
          >
            {filters.map(({ id, name, icon: Icon, count }) => (
              <Button
                key={id}
                ref={id === "pinned" ? pinnedFilterRef : undefined}
                variant="ghost"
                type="button"
                aria-label={name}
                aria-pressed={filter === id}
                className="justify-start gap-2 aria-pressed:bg-selected aria-pressed:hover:bg-selected"
                onClick={() => {
                  setFilter(id)
                  if (viewportRef.current) viewportRef.current.scrollTop = 0
                }}
              >
                <Icon aria-hidden="true" className="text-muted-foreground" />
                {name}
                <span aria-hidden="true" className="ml-auto hidden text-xs tabular-nums text-muted-foreground @xl/launcher:inline">{count}</span>
              </Button>
            ))}
          </nav>
        </aside>

        <ScrollArea viewportRef={viewportRef} className="min-w-0 flex-1">
          <div className="mx-auto max-w-4xl px-4 pb-6 @xl/launcher:px-6">
            <p role="status" className="sr-only">
              {resultCount} 个应用
            </p>
            {resultCount === 0 && (
              <p className="py-10 text-center text-sm text-muted-foreground">
                {needle ? "未找到匹配的应用" : filter === "pinned" ? "暂无固定应用" : "暂无应用"}
              </p>
            )}
            {groups.map(({ id, name, apps }) => (
              <section key={id} className="mt-4">
                <h2 className="px-2 pb-1 text-xs font-medium text-muted-foreground">{name}</h2>
                <ul className="divide-y divide-border/60">
                  {apps.map((app) => {
                    const Icon = systemAppPresentation[app.id].icon
                    const isPinned = pinned.has(app.id)
                    const removable = app.id !== REQUIRED_DOCK_APP_ID
                    const canTogglePin = removable && (isPinned || app.dock.pinnable !== false)
                    const pinLabel = isPinned ? "从 Dock 移除" : "固定到 Dock"
                    return (
                      <li key={app.id} className="group/app-row flex min-h-10 items-center gap-1">
                        <ContextMenu>
                          <ContextMenuTrigger asChild>
                            <Button
                              ref={app.id === focusAppId ? focusTargetRef : undefined}
                              type="button"
                              variant="ghost"
                              data-track="app-launcher.open"
                              className="h-auto min-h-10 min-w-0 flex-1 justify-start gap-3 px-2 py-2 text-left whitespace-normal"
                              onClick={() => onOpenApp(app.id)}
                            >
                              <Icon aria-hidden="true" className="size-4.5 text-muted-foreground" strokeWidth={1.75} />
                              <span className="min-w-0 wrap-anywhere">{app.name}</span>
                              <ChevronRight aria-hidden="true" className="ml-auto text-muted-foreground opacity-0 group-hover/app-row:opacity-100 group-focus-within/app-row:opacity-100" />
                            </Button>
                          </ContextMenuTrigger>
                          <ContextMenuContent collisionPadding={12}>
                            <DockAppMenuItems
                              appId={app.id}
                              pinned={isPinned}
                              removable={removable}
                              includePinAction={canTogglePin}
                              itemKind="context"
                              onOpen={onOpenApp}
                              onPin={(appId) => { if (!disabled) onPinApp(appId) }}
                              onUnpin={unpin}
                              onManageDock={onManageDock}
                            />
                          </ContextMenuContent>
                        </ContextMenu>
                        {canTogglePin && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={isPinned ? `从 Dock 移除${app.name}` : `固定${app.name}到 Dock`}
                            aria-disabled={disabled}
                            title={pinLabel}
                            data-pinned={isPinned}
                            className="text-muted-foreground aria-disabled:opacity-50 data-[pinned=true]:bg-muted data-[pinned=true]:text-foreground"
                            onClick={() => {
                              if (disabled) return
                              if (isPinned) unpin(app.id)
                              else onPinApp(app.id)
                            }}
                          >
                            <Pin aria-hidden="true" />
                          </Button>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </section>
            ))}
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
