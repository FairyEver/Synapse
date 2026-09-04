import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react"
import { ArrowLeft, X } from "lucide-react"

import { WorkspaceAuxiliaryPanelLayout } from "@/components/workspace-auxiliary-panel-layout"
import { WorkspaceFileTree } from "@/components/workspace-file-tree"
import { Button } from "@/components/ui/button"
import {
  readWorkspacePanelWidth,
  writeWorkspacePanelWidth,
  type WorkspacePanelSizeConstraints,
} from "@/lib/workspace-panel-layout-storage"
import { useDismissOnPointerDownOutside } from "@/hooks/use-dismiss-on-pointer-down-outside"
import { track } from "@/lib/ui-tracking"
import type { WorkspaceFileTreeDataSource } from "@/types/workspace-file-tree"

const FILE_TREE_MIN_WIDTH = 220
const FILE_TREE_DEFAULT_WIDTH = 280
const FILE_TREE_MAX_WIDTH = 480
const MIN_VISIBLE_CONVERSATION_WIDTH = 160
const FILE_TREE_WIDTH_CONSTRAINTS: WorkspacePanelSizeConstraints = {
  defaultSize: FILE_TREE_DEFAULT_WIDTH,
  minSize: FILE_TREE_MIN_WIDTH,
  maxSize: FILE_TREE_MAX_WIDTH,
}

export type AgentWorkspacePanelRequest = {
  readonly panelId: "agent.file-diff"
  readonly payload: {
    readonly checkpointId: string
    readonly fileId?: string
    readonly action?: "review" | "rewind"
  }
}

export type AgentWorkspacePanelRegistration = {
  readonly id: AgentWorkspacePanelRequest["panelId"]
  readonly title: (payload: AgentWorkspacePanelRequest["payload"]) => string
  readonly render: (payload: AgentWorkspacePanelRequest["payload"]) => ReactNode
  readonly isSameTarget: (
    left: AgentWorkspacePanelRequest["payload"],
    right: AgentWorkspacePanelRequest["payload"],
  ) => boolean
}

type AgentWorkspacePanelContextValue = {
  readonly openPanel: (request: AgentWorkspacePanelRequest) => void
  readonly closePanel: () => void
  readonly fileTreeAvailable: boolean
  readonly fileTreeOpen: boolean
  readonly fileTreeTriggerRef: RefObject<HTMLButtonElement | null>
  readonly toggleFileTree: () => void
}

const AgentWorkspacePanelContext = createContext<AgentWorkspacePanelContextValue | null>(null)

type AgentWorkspaceShellProps = {
  readonly children: ReactNode
  readonly conversationKey: string
  readonly mode: "embedded" | "window"
  readonly panels: readonly AgentWorkspacePanelRegistration[]
  readonly fileTreeDataSource?: WorkspaceFileTreeDataSource
}

export function AgentWorkspaceShell({
  children,
  conversationKey,
  mode,
  panels,
  fileTreeDataSource,
}: AgentWorkspaceShellProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const fileTreeOverlayRef = useRef<HTMLDivElement>(null)
  const fileTreeTriggerRef = useRef<HTMLButtonElement>(null)
  const resizeFrameRef = useRef<number | null>(null)
  const [request, setRequest] = useState<AgentWorkspacePanelRequest | null>(null)
  const [fileTreeOpen, setFileTreeOpen] = useState(false)
  const [activeAuxiliary, setActiveAuxiliary] = useState<"leading" | "trailing">("trailing")
  const [availableWidth, setAvailableWidth] = useState<number | null>(null)
  const [fileTreeWidth, setFileTreeWidth] = useState(() => readWorkspacePanelWidth(
    `agent-${mode}-leading`,
    FILE_TREE_WIDTH_CONSTRAINTS,
  ))
  const initialFocusRef = useRef<HTMLButtonElement>(null)
  const fileTreeInitialFocusRef = useRef<HTMLButtonElement>(null)
  const returnFocusElementRef = useRef<HTMLElement | null>(null)
  const returnFocusIdRef = useRef<string | null>(null)
  const fileTreeReturnFocusElementRef = useRef<HTMLElement | null>(null)
  const fileTreeReturnFocusIdRef = useRef<string | null>(null)
  const restoreFocusFrameRef = useRef<number | null>(null)
  const restoreFileTreeFocusFrameRef = useRef<number | null>(null)
  const shouldRestoreFocusRef = useRef(false)
  const shouldRestoreFileTreeFocusRef = useRef(false)
  const openPanel = useCallback((nextRequest: AgentWorkspacePanelRequest) => {
    const registration = panels.find((candidate) => candidate.id === nextRequest.panelId)
    if (!registration) return
    setActiveAuxiliary("trailing")
    if (request?.panelId === nextRequest.panelId
      && registration.isSameTarget(request.payload, nextRequest.payload)) {
      setRequest(nextRequest)
      return
    }
    const activeElement = document.activeElement
    returnFocusElementRef.current = activeElement instanceof HTMLElement ? activeElement : null
    returnFocusIdRef.current = activeElement instanceof HTMLElement && activeElement.id
      ? activeElement.id
      : null
    setRequest(nextRequest)
  }, [panels, request])
  const closePanel = useCallback(() => {
    shouldRestoreFocusRef.current = true
    setRequest(null)
    if (fileTreeOpen) setActiveAuxiliary("leading")
  }, [fileTreeOpen])
  const closeFileTree = useCallback(() => {
    shouldRestoreFileTreeFocusRef.current = true
    setFileTreeOpen(false)
    if (request) setActiveAuxiliary("trailing")
  }, [request])
  const toggleFileTree = useCallback(() => {
    if (!fileTreeDataSource) return
    if (fileTreeOpen) {
      closeFileTree()
      return
    }
    const activeElement = document.activeElement
    fileTreeReturnFocusElementRef.current = activeElement instanceof HTMLElement ? activeElement : null
    fileTreeReturnFocusIdRef.current = activeElement instanceof HTMLElement && activeElement.id
      ? activeElement.id
      : null
    setActiveAuxiliary("leading")
    setFileTreeOpen(true)
  }, [closeFileTree, fileTreeDataSource, fileTreeOpen])
  const contextValue = useMemo<AgentWorkspacePanelContextValue>(() => ({
    openPanel,
    closePanel,
    fileTreeAvailable: Boolean(fileTreeDataSource),
    fileTreeOpen,
    fileTreeTriggerRef,
    toggleFileTree,
  }), [closePanel, fileTreeDataSource, fileTreeOpen, openPanel, toggleFileTree])

  useDismissOnPointerDownOutside(
    fileTreeOpen,
    fileTreeOverlayRef,
    fileTreeTriggerRef,
    closeFileTree,
  )

  useEffect(() => {
    if (restoreFocusFrameRef.current !== null) {
      window.cancelAnimationFrame(restoreFocusFrameRef.current)
      restoreFocusFrameRef.current = null
    }
    shouldRestoreFocusRef.current = false
    returnFocusElementRef.current = null
    returnFocusIdRef.current = null
    fileTreeReturnFocusElementRef.current = null
    fileTreeReturnFocusIdRef.current = null
    setRequest(null)
    setFileTreeOpen(false)
    setActiveAuxiliary("trailing")
  }, [conversationKey])

  useEffect(() => {
    if (request) {
      restoreFocusFrameRef.current = window.requestAnimationFrame(() => {
        restoreFocusFrameRef.current = window.requestAnimationFrame(() => {
          restoreFocusFrameRef.current = null
          initialFocusRef.current?.focus()
        })
      })
      return () => {
        if (restoreFocusFrameRef.current !== null) {
          window.cancelAnimationFrame(restoreFocusFrameRef.current)
          restoreFocusFrameRef.current = null
        }
      }
    }
    if (!shouldRestoreFocusRef.current) return
    shouldRestoreFocusRef.current = false
    const returnFocusElement = returnFocusElementRef.current
    const returnFocusId = returnFocusIdRef.current
    returnFocusElementRef.current = null
    returnFocusIdRef.current = null
    restoreFocusFrameRef.current = window.requestAnimationFrame(() => {
      restoreFocusFrameRef.current = window.requestAnimationFrame(() => {
        restoreFocusFrameRef.current = null
        const target = returnFocusElement?.isConnected
          ? returnFocusElement
          : returnFocusId
            ? document.getElementById(returnFocusId)
            : null
        target?.focus()
      })
    })
  }, [request])

  useEffect(() => {
    if (restoreFileTreeFocusFrameRef.current !== null) {
      window.cancelAnimationFrame(restoreFileTreeFocusFrameRef.current)
      restoreFileTreeFocusFrameRef.current = null
    }
    if (fileTreeOpen) {
      restoreFileTreeFocusFrameRef.current = window.requestAnimationFrame(() => {
        restoreFileTreeFocusFrameRef.current = window.requestAnimationFrame(() => {
          restoreFileTreeFocusFrameRef.current = null
          fileTreeInitialFocusRef.current?.focus()
        })
      })
      return () => {
        if (restoreFileTreeFocusFrameRef.current !== null) {
          window.cancelAnimationFrame(restoreFileTreeFocusFrameRef.current)
          restoreFileTreeFocusFrameRef.current = null
        }
      }
    }
    if (!shouldRestoreFileTreeFocusRef.current) return
    shouldRestoreFileTreeFocusRef.current = false
    const returnFocusElement = fileTreeReturnFocusElementRef.current
    const returnFocusId = fileTreeReturnFocusIdRef.current
    fileTreeReturnFocusElementRef.current = null
    fileTreeReturnFocusIdRef.current = null
    restoreFileTreeFocusFrameRef.current = window.requestAnimationFrame(() => {
      restoreFileTreeFocusFrameRef.current = window.requestAnimationFrame(() => {
        restoreFileTreeFocusFrameRef.current = null
        const target = returnFocusElement?.isConnected
          ? returnFocusElement
          : returnFocusId
            ? document.getElementById(returnFocusId)
            : null
        target?.focus()
      })
    })
  }, [fileTreeOpen])

  useEffect(() => () => {
    if (restoreFocusFrameRef.current !== null) {
      window.cancelAnimationFrame(restoreFocusFrameRef.current)
    }
    if (restoreFileTreeFocusFrameRef.current !== null) {
      window.cancelAnimationFrame(restoreFileTreeFocusFrameRef.current)
    }
    if (resizeFrameRef.current !== null) window.cancelAnimationFrame(resizeFrameRef.current)
  }, [])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return undefined
    const commitWidth = (width: number) => {
      const rounded = Math.round(width)
      setAvailableWidth((current) => current === rounded ? current : rounded)
    }
    commitWidth(container.getBoundingClientRect().width)
    if (typeof ResizeObserver === "undefined") return undefined
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width
      if (typeof width !== "number") return
      if (resizeFrameRef.current !== null) window.cancelAnimationFrame(resizeFrameRef.current)
      resizeFrameRef.current = window.requestAnimationFrame(() => {
        resizeFrameRef.current = null
        commitWidth(width)
      })
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!request && !fileTreeOpen) return undefined
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return
      event.preventDefault()
      if (activeAuxiliary === "leading" && fileTreeOpen) closeFileTree()
      else if (request) closePanel()
      else closeFileTree()
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [activeAuxiliary, closeFileTree, closePanel, fileTreeOpen, request])

  const activeRegistration = request
    ? panels.find((candidate) => candidate.id === request.panelId)
    : undefined
  const panel = request && activeRegistration ? (
    <section className="flex h-full min-h-0 flex-col" aria-label="工作区详情">
      <header className="flex h-10 shrink-0 items-center justify-between border-b px-2">
        <div className="flex min-w-0 items-center">
          <Button
            ref={initialFocusRef}
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={closePanel}
            aria-label="返回对话"
          >
            <ArrowLeft />
          </Button>
          <h2 className="truncate px-1 text-sm font-medium">{activeRegistration.title(request.payload)}</h2>
        </div>
        <Button type="button" variant="ghost" size="icon-sm" onClick={closePanel} aria-label="关闭面板">
          <X />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-hidden">{activeRegistration.render(request.payload)}</div>
    </section>
  ) : undefined
  const fileTree = fileTreeOpen && fileTreeDataSource ? (
    <WorkspaceFileTree
      closeButtonRef={fileTreeInitialFocusRef}
      dataSource={fileTreeDataSource}
      onClose={closeFileTree}
    />
  ) : undefined
  const visibleFileTreeWidth = resolveAgentFileTreeOverlayWidth(availableWidth, fileTreeWidth)
  const handleFileTreeResizeStart = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const startX = event.clientX
    const startWidth = fileTreeOverlayRef.current?.getBoundingClientRect().width ?? fileTreeWidth
    let latestWidth = fileTreeWidth
    const handlePointerMove = (moveEvent: PointerEvent) => {
      latestWidth = Math.min(
        FILE_TREE_MAX_WIDTH,
        Math.max(FILE_TREE_MIN_WIDTH, startWidth + moveEvent.clientX - startX),
      )
      setFileTreeWidth(latestWidth)
    }
    const handlePointerUp = () => {
      window.removeEventListener("pointermove", handlePointerMove)
      window.removeEventListener("pointerup", handlePointerUp)
      writeWorkspacePanelWidth(
        `agent-${mode}-leading`,
        latestWidth,
        FILE_TREE_WIDTH_CONSTRAINTS,
      )
      track({
        component: "agent",
        name: "agent.file_tree.resize",
        action: "resize",
        eventKey: "agent.file_tree.resize",
      })
    }
    window.addEventListener("pointermove", handlePointerMove)
    window.addEventListener("pointerup", handlePointerUp, { once: true })
  }, [fileTreeWidth, mode])

  return (
    <AgentWorkspacePanelContext.Provider value={contextValue}>
      <div ref={containerRef} className="relative h-full min-h-0 min-w-0 overflow-hidden">
        <WorkspaceAuxiliaryPanelLayout
          main={children}
          auxiliary={panel}
          persistenceId={`agent-${mode}`}
        />
        {fileTree ? (
          <div
            ref={fileTreeOverlayRef}
            data-agent-file-tree-overlay
            className="absolute inset-y-0 left-0 z-10 overflow-hidden border-r bg-background"
            style={{ width: visibleFileTreeWidth }}
          >
            {fileTree}
            <div
              role="separator"
              aria-label="调整文件树宽度"
              aria-orientation="vertical"
              data-track="agent-file-tree-resize"
              className="absolute inset-y-0 right-0 w-1 cursor-col-resize"
              onPointerDown={handleFileTreeResizeStart}
            />
          </div>
        ) : null}
      </div>
    </AgentWorkspacePanelContext.Provider>
  )
}

export function resolveAgentFileTreeOverlayWidth(
  availableWidth: number | null,
  preferredWidth: number,
): number {
  if (availableWidth === null) return preferredWidth
  return Math.max(0, Math.min(preferredWidth, availableWidth - MIN_VISIBLE_CONVERSATION_WIDTH))
}

export function useAgentWorkspacePanel(): AgentWorkspacePanelContextValue {
  const value = useContext(AgentWorkspacePanelContext)
  if (!value) throw new Error("useAgentWorkspacePanel must be used inside AgentWorkspaceShell")
  return value
}

export function useOptionalAgentWorkspacePanel(): AgentWorkspacePanelContextValue | null {
  return useContext(AgentWorkspacePanelContext)
}
