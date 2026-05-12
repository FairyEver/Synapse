import type { ReactNode } from "react"
import { Trash2, Copy, Clipboard, Type, Unlink } from "lucide-react"
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
} from "@/components/ui/context-menu"
import { useCanvasActions } from "./canvas-context"

interface NodeContextMenuProps {
  nodeId: string
  nodeType: string
  children: ReactNode
}

export function NodeContextMenu({ nodeId, nodeType, children }: NodeContextMenuProps) {
  const { clipboard, getSelectedNodeIds, copyNodes, pasteNodes, disconnectNodes, deleteNodes, requestRename } = useCanvasActions()

  const resolveTargetIds = (): string[] => {
    const selected = getSelectedNodeIds()
    return selected.includes(nodeId) ? selected : [nodeId]
  }

  const isEndNode = nodeType === "end"
  const isMulti = (() => {
    const selected = getSelectedNodeIds()
    return selected.includes(nodeId) && selected.length > 1
  })()

  return (
    <ContextMenu data-track="workflow-node-context-menu">
      <ContextMenuTrigger asChild>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent>
        {!isMulti && (
          <ContextMenuItem
            data-track="rename"
            onSelect={() => requestRename(nodeId)}
          >
            <Type className="size-4" />
            重命名
          </ContextMenuItem>
        )}
        <ContextMenuItem
          data-track="copy"
          onSelect={() => copyNodes(resolveTargetIds())}
        >
          <Copy className="size-4" />
          复制
          <ContextMenuShortcut>⌘C</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem
          data-track="paste"
          disabled={!clipboard}
          onSelect={() => pasteNodes()}
        >
          <Clipboard className="size-4" />
          粘贴
          <ContextMenuShortcut>⌘V</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          data-track="disconnect"
          onSelect={() => disconnectNodes(resolveTargetIds())}
        >
          <Unlink className="size-4" />
          断开所有连线
        </ContextMenuItem>
        {!isEndNode && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem
              variant="destructive"
              data-track="delete"
              onSelect={() => deleteNodes(resolveTargetIds())}
            >
              <Trash2 className="size-4" />
              删除
              <ContextMenuShortcut>⌫</ContextMenuShortcut>
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}
