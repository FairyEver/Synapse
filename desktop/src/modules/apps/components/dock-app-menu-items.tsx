import type { ReactNode } from "react"
import { ExternalLink, Pin, PinOff, Settings2 } from "lucide-react"
import { ContextMenuItem } from "@/components/ui/context-menu"
import { DropdownMenuItem } from "@/components/ui/dropdown-menu"
import type { SynapseSystemAppId } from "@/modules/apps/types"

type DockAppMenuAction = "open" | "pin" | "unpin" | "manage"

type ResolveDockAppMenuActionsOptions = {
  readonly pinned: boolean
  readonly removable: boolean
  readonly includePinAction?: boolean
  readonly includeManageAction?: boolean
}

type DockAppMenuItemsProps = ResolveDockAppMenuActionsOptions & {
  readonly appId: SynapseSystemAppId
  readonly itemKind: "dropdown" | "context"
  readonly onOpen: (appId: SynapseSystemAppId) => void
  readonly onPin: (appId: SynapseSystemAppId) => void
  readonly onUnpin: (appId: SynapseSystemAppId) => void
  readonly onManageDock: () => void
}

export function resolveDockAppMenuActions({
  includeManageAction = true,
  pinned,
  removable,
  includePinAction = true,
}: ResolveDockAppMenuActionsOptions): DockAppMenuAction[] {
  const actions: DockAppMenuAction[] = ["open"]

  if (includePinAction) {
    if (pinned && removable) {
      actions.push("unpin")
    }
    if (!pinned) {
      actions.push("pin")
    }
  } else if (pinned && removable) {
    actions.push("unpin")
  }

  if (includeManageAction) {
    actions.push("manage")
  }
  return actions
}

function DockAppMenuItems(props: DockAppMenuItemsProps) {
  const actions = resolveDockAppMenuActions(props)

  return (
    <>
      {actions.includes("open") ? (
        <MenuItem itemKind={props.itemKind} onSelect={() => props.onOpen(props.appId)}>
          <ExternalLink data-icon="inline-start" />
          打开
        </MenuItem>
      ) : null}
      {actions.includes("pin") ? (
        <MenuItem itemKind={props.itemKind} onSelect={() => props.onPin(props.appId)}>
          <Pin data-icon="inline-start" />
          固定到 Dock
        </MenuItem>
      ) : null}
      {actions.includes("unpin") ? (
        <MenuItem itemKind={props.itemKind} onSelect={() => props.onUnpin(props.appId)}>
          <PinOff data-icon="inline-start" />
          从 Dock 移除
        </MenuItem>
      ) : null}
      {actions.includes("manage") ? (
        <MenuItem itemKind={props.itemKind} onSelect={props.onManageDock}>
          <Settings2 data-icon="inline-start" />
          管理 Dock
        </MenuItem>
      ) : null}
    </>
  )
}

function MenuItem({
  children,
  itemKind,
  onSelect,
}: {
  readonly children: ReactNode
  readonly itemKind: "dropdown" | "context"
  readonly onSelect: () => void
}) {
  if (itemKind === "dropdown") {
    return (
      <DropdownMenuItem onSelect={onSelect}>
        {children}
      </DropdownMenuItem>
    )
  }

  return (
    <ContextMenuItem onSelect={onSelect}>
      {children}
    </ContextMenuItem>
  )
}

export { DockAppMenuItems }
