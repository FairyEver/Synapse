import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
  type Ref,
} from "react"
import { createPortal } from "react-dom"
import {
  useGroupRef,
  usePanelRef,
  type Layout,
} from "react-resizable-panels"
import { FitAddon } from "@xterm/addon-fit"
import { WebLinksAddon } from "@xterm/addon-web-links"
import { WebglAddon } from "@xterm/addon-webgl"
import { Terminal } from "@xterm/xterm"
import { Columns3, Folder, Maximize2, Minimize2, Pencil, RotateCcw, Rows3, Square, X } from "lucide-react"
import "@xterm/xterm/css/xterm.css"
import { toast } from "sonner"

import { createRendererLogger } from "../../../src/app-shell/logging"
import { Badge } from "../../../src/components/ui/badge"
import { Button } from "../../../src/components/ui/button"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "../../../src/components/ui/context-menu"
import { Spinner } from "../../../src/components/ui/spinner"
import { WorkspaceFileTree } from "../../../src/components/workspace-file-tree"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "../../../src/components/ui/resizable"
import { requireBridgeDomain } from "../../../src/lib/electron-bridge"
import { runTrackedOperation, track } from "../../../src/lib/ui-tracking"
import { cn } from "../../../src/lib/utils"
import {
  clearWorkspaceFileTreeDrag,
  hasWorkspaceFileTreeDrag,
  readWorkspaceFileTreeDrag,
} from "../../../src/lib/workspace-file-tree-drag"
import {
  readWorkspacePanelWidth,
  writeWorkspacePanelWidth,
  type WorkspacePanelSizeConstraints,
} from "../../../src/lib/workspace-panel-layout-storage"
import { useDismissOnPointerDownOutside } from "../../../src/hooks/use-dismiss-on-pointer-down-outside"
import type {
  SynapseTerminalLayoutNode,
  SynapseTerminalOutputChunk,
  SynapseTerminalPaneDropEdge,
  SynapseTerminalResizedEvent,
  SynapseTerminalSession,
  SynapseTerminalWorkspace,
} from "../../../src/types/terminal"
import type { WorkspaceFileTreeDataSource } from "../../../src/types/workspace-file-tree"
import {
  collectTerminalPaneLeaves,
  findTerminalPaneParentDirection,
  findTerminalPaneSplitPath,
} from "../shared/schema"
import { installTerminalUnicodeWidth } from "../shared/terminal-unicode-width"
import {
  getTerminalClipboardShortcut,
  getTerminalPaneShortcut,
  isTerminalShiftEnterEvent,
  type TerminalPaneShortcut,
} from "./terminal-keyboard"
import {
  getTerminalAppearanceOptions,
  type TerminalAppearanceSize,
} from "./terminal-appearance"
import { decideTerminalGrid } from "./terminal-grid-ownership"
import {
  constrainTerminalCompositionToViewport,
  createTerminalRenderingOptions,
} from "./terminal-rendering"

/**
 * Width the viewport's scrollbar takes over the right edge of the screen.
 *
 * Matches what the fit addon reserves for it, so a grid-sized mount is not narrower
 * than the grid xterm is already drawing into it.
 */
const TERMINAL_VIEWPORT_SCROLLBAR_PX = 14

const TERMINAL_WRITE_CHUNK_SIZE = 60 * 1024
const TERMINAL_PANE_DRAG_TYPE = "application/x-synapse-terminal-pane"
const TERMINAL_PANE_DROP_EDGE_RATIO = 0.25
const TERMINAL_FILE_TREE_MIN_WIDTH = 220
const TERMINAL_FILE_TREE_DEFAULT_WIDTH = 280
const TERMINAL_FILE_TREE_MAX_WIDTH = 480
const TERMINAL_FILE_TREE_PERSISTENCE_ID = "terminal-file-tree"
const TERMINAL_FILE_TREE_WIDTH_CONSTRAINTS: WorkspacePanelSizeConstraints = {
  defaultSize: TERMINAL_FILE_TREE_DEFAULT_WIDTH,
  minSize: TERMINAL_FILE_TREE_MIN_WIDTH,
  maxSize: TERMINAL_FILE_TREE_MAX_WIDTH,
}
const logger = createRendererLogger("terminal.workspace")

export type TerminalWorkspaceViewHandle = {
  clearActivePane(): void
}

type PaneControls = {
  clear(): void
  focus(): void
}

type SplitLayoutControls = {
  getLayout(): Layout
  resizeSibling(paneSide: "first" | "second"): void
  setLayout(layout: Layout): void
}

export function TerminalWorkspaceView({
  activePaneId,
  appearanceSize,
  onActivePaneChange,
  onClosePane,
  onEqualizePane,
  onMovePane,
  onRenameSession,
  onSessionChanged,
  onSessionDeleted,
  onSplitPane,
  onSplitRatioChange,
  pendingClosePaneIds,
  platform,
  ref,
  sessions,
  visible,
  workspace,
}: {
  readonly activePaneId: string
  readonly appearanceSize: TerminalAppearanceSize
  readonly onActivePaneChange: (paneId: string) => void
  readonly onClosePane: (paneId: string) => void
  readonly onEqualizePane: (paneId: string) => void
  readonly onMovePane: (
    sourcePaneId: string,
    targetPaneId: string,
    edge: SynapseTerminalPaneDropEdge,
  ) => void
  readonly onRenameSession: (sessionId: string, returnFocus: HTMLElement | null) => void
  readonly onSessionChanged: (session: SynapseTerminalSession) => void
  readonly onSessionDeleted: (sessionId: string) => void
  readonly onSplitPane: (paneId: string, direction: "right" | "down") => void
  readonly onSplitRatioChange: (splitId: string, ratio: number) => void
  readonly pendingClosePaneIds: ReadonlySet<string>
  readonly platform: string | undefined
  readonly ref?: Ref<TerminalWorkspaceViewHandle>
  readonly sessions: readonly SynapseTerminalSession[]
  readonly visible: boolean
  readonly workspace: SynapseTerminalWorkspace
}) {
  const paneElementsRef = useRef(new Map<string, HTMLDivElement>())
  const paneControlsRef = useRef(new Map<string, PaneControls>())
  const paneHostsRef = useRef(new Map<string, HTMLDivElement>())
  const splitLayoutControlsRef = useRef(new Map<string, SplitLayoutControls>())
  const maximizedPaneIdRef = useRef<string | null>(null)
  const maximizedLayoutBaselineRef = useRef<Map<string, Layout> | null>(null)
  const maximizedLayoutSignatureRef = useRef<string | null>(null)
  const pendingMaximizeRestoreRef = useRef(false)
  const suppressSplitRatioPersistenceRef = useRef(false)
  const persistenceReleaseFrameRef = useRef<number | null>(null)
  const [maximizedPaneId, setMaximizedPaneId] = useState<string | null>(null)
  const [fileTreePaneIds, setFileTreePaneIds] = useState<ReadonlySet<string>>(new Set())
  const [fileTreeWidth, setFileTreeWidth] = useState(() =>
    readWorkspacePanelWidth(TERMINAL_FILE_TREE_PERSISTENCE_ID, TERMINAL_FILE_TREE_WIDTH_CONSTRAINTS))
  const [paneDrag, setPaneDrag] = useState<{
    readonly sourcePaneId: string
    readonly targetPaneId: string | null
    readonly edge: SynapseTerminalPaneDropEdge | null
  } | null>(null)
  const sessionsById = useMemo(
    () => new Map(sessions.map((session) => [session.id, session])),
    [sessions],
  )
  const workspaceClosingPaneIds = useMemo(
    () => new Set(workspace.closingPaneIds),
    [workspace.closingPaneIds],
  )
  const workspacePanes = useMemo(() => collectTerminalPaneLeaves(workspace.layout), [workspace.layout])
  const workspaceLayoutSignature = useMemo(() => JSON.stringify(workspace.layout), [workspace.layout])
  const workspacePaneIds = useMemo(() => new Set(workspacePanes.map((pane) => pane.paneId)), [workspacePanes])
  const visiblePaneIds = useMemo(
    () => workspacePanes
      .filter((pane) => sessionsById.has(pane.sessionId))
      .map((pane) => pane.paneId),
    [sessionsById, workspacePanes],
  )
  const dimInactivePanes = visiblePaneIds.length > 1 && visiblePaneIds.includes(activePaneId)
  const maximizedSplitPath = useMemo(
    () => maximizedPaneId ? findTerminalPaneSplitPath(workspace.layout, maximizedPaneId) : null,
    [maximizedPaneId, workspace.layout],
  )
  const maximizedPaneSides = useMemo(
    () => new Map(maximizedSplitPath?.map(({ splitId, paneSide }) => [splitId, paneSide]) ?? []),
    [maximizedSplitPath],
  )

  const releaseSplitRatioPersistence = useCallback(() => {
    if (persistenceReleaseFrameRef.current !== null) {
      cancelAnimationFrame(persistenceReleaseFrameRef.current)
    }
    persistenceReleaseFrameRef.current = requestAnimationFrame(() => {
      persistenceReleaseFrameRef.current = null
      if (!maximizedPaneIdRef.current && !pendingMaximizeRestoreRef.current) {
        suppressSplitRatioPersistenceRef.current = false
      }
    })
  }, [])

  const restoreMaximizedPane = useCallback(() => {
    if (!maximizedPaneIdRef.current) return
    suppressSplitRatioPersistenceRef.current = true
    pendingMaximizeRestoreRef.current = true
    maximizedPaneIdRef.current = null
    setMaximizedPaneId(null)
  }, [])

  const activatePane = useCallback((paneId: string) => {
    if (maximizedPaneIdRef.current && maximizedPaneIdRef.current !== paneId) {
      restoreMaximizedPane()
    }
    onActivePaneChange(paneId)
  }, [onActivePaneChange, restoreMaximizedPane])

  const togglePaneMaximize = useCallback((paneId: string) => {
    if (workspacePanes.length <= 1) return
    if (maximizedPaneIdRef.current === paneId) {
      restoreMaximizedPane()
      return
    }
    if (!maximizedLayoutBaselineRef.current) {
      maximizedLayoutBaselineRef.current = captureTerminalSplitLayouts(
        workspace.layout,
        splitLayoutControlsRef.current,
      )
      maximizedLayoutSignatureRef.current = workspaceLayoutSignature
    }
    pendingMaximizeRestoreRef.current = false
    suppressSplitRatioPersistenceRef.current = true
    maximizedPaneIdRef.current = paneId
    setMaximizedPaneId(paneId)
  }, [restoreMaximizedPane, workspace.layout, workspaceLayoutSignature, workspacePanes.length])

  const equalizePane = useCallback((paneId: string) => {
    restoreMaximizedPane()
    onEqualizePane(paneId)
  }, [onEqualizePane, restoreMaximizedPane])

  const registerSplitLayoutControls = useCallback((
    splitId: string,
    controls: SplitLayoutControls | null,
  ) => {
    if (controls) splitLayoutControlsRef.current.set(splitId, controls)
    else splitLayoutControlsRef.current.delete(splitId)
  }, [])

  const handleSplitRatioChange = useCallback((splitId: string, ratio: number) => {
    if (suppressSplitRatioPersistenceRef.current) return
    onSplitRatioChange(splitId, ratio)
  }, [onSplitRatioChange])

  useLayoutEffect(() => {
    if ((maximizedPaneIdRef.current || pendingMaximizeRestoreRef.current)
      && maximizedLayoutSignatureRef.current !== workspaceLayoutSignature) {
      suppressSplitRatioPersistenceRef.current = true
      maximizedPaneIdRef.current = null
      maximizedLayoutBaselineRef.current = null
      maximizedLayoutSignatureRef.current = null
      pendingMaximizeRestoreRef.current = false
      setMaximizedPaneId(null)
      releaseSplitRatioPersistence()
      return
    }

    const baseline = maximizedLayoutBaselineRef.current
    if (maximizedPaneId && maximizedSplitPath && baseline) {
      for (const [splitId, layout] of baseline) {
        splitLayoutControlsRef.current.get(splitId)?.setLayout(layout)
      }
      for (const { splitId, paneSide } of maximizedSplitPath) {
        splitLayoutControlsRef.current.get(splitId)?.resizeSibling(paneSide)
      }
      return
    }

    if (!pendingMaximizeRestoreRef.current || !baseline) return
    queueMicrotask(() => {
      if (!pendingMaximizeRestoreRef.current
        || maximizedPaneIdRef.current
        || maximizedLayoutBaselineRef.current !== baseline) return
      // Removing the 100px constraints re-registers panels; restore after that commit settles.
      for (const [splitId, layout] of baseline) {
        splitLayoutControlsRef.current.get(splitId)?.setLayout(layout)
      }
      pendingMaximizeRestoreRef.current = false
      maximizedLayoutBaselineRef.current = null
      maximizedLayoutSignatureRef.current = null
      releaseSplitRatioPersistence()
    })
  }, [maximizedPaneId, maximizedSplitPath, releaseSplitRatioPersistence, workspaceLayoutSignature])

  useLayoutEffect(() => {
    if (!visible || (maximizedPaneIdRef.current && activePaneId !== maximizedPaneIdRef.current)) {
      restoreMaximizedPane()
    }
  }, [activePaneId, restoreMaximizedPane, visible])

  useEffect(() => () => {
    if (persistenceReleaseFrameRef.current !== null) {
      cancelAnimationFrame(persistenceReleaseFrameRef.current)
    }
  }, [])

  useEffect(() => {
    setFileTreePaneIds((current) => {
      const next = new Set([...current].filter((paneId) => workspacePaneIds.has(paneId)))
      return next.size === current.size && [...current].every((paneId) => next.has(paneId))
        ? current
        : next
    })
  }, [workspacePaneIds])

  useEffect(() => {
    for (const [paneId, host] of paneHostsRef.current) {
      if (workspacePaneIds.has(paneId)) continue
      host.remove()
      paneHostsRef.current.delete(paneId)
    }
  }, [workspacePaneIds])

  useEffect(() => () => {
    for (const host of paneHostsRef.current.values()) host.remove()
    paneHostsRef.current.clear()
  }, [])

  useImperativeHandle(ref, () => ({
    clearActivePane() {
      paneControlsRef.current.get(activePaneId)?.clear()
    },
  }), [activePaneId])

  const registerPaneElement = useCallback((paneId: string, element: HTMLDivElement | null) => {
    if (element) paneElementsRef.current.set(paneId, element)
    else paneElementsRef.current.delete(paneId)
  }, [])

  const registerPaneControls = useCallback((paneId: string, controls: PaneControls | null) => {
    if (controls) paneControlsRef.current.set(paneId, controls)
    else paneControlsRef.current.delete(paneId)
  }, [])

  const getPaneHost = useCallback((paneId: string) => {
    const existing = paneHostsRef.current.get(paneId)
    if (existing) return existing
    // Split-tree changes move this stable host instead of remounting the pane's xterm instance.
    const host = document.createElement("div")
    host.className = "h-full min-h-0 min-w-0"
    paneHostsRef.current.set(paneId, host)
    return host
  }, [])

  const focusPane = useCallback((paneId: string, direction: FocusDirection) => {
    const nextPaneId = findPaneInDirection(paneId, direction, paneElementsRef.current)
    if (!nextPaneId) return
    activatePane(nextPaneId)
    paneControlsRef.current.get(nextPaneId)?.focus()
  }, [activatePane])

  const handleShortcut = useCallback((paneId: string, shortcut: TerminalPaneShortcut) => {
    if (shortcut === "split-right") {
      restoreMaximizedPane()
      return onSplitPane(paneId, "right")
    }
    if (shortcut === "split-down") {
      restoreMaximizedPane()
      return onSplitPane(paneId, "down")
    }
    if (shortcut === "close-pane") {
      restoreMaximizedPane()
      return onClosePane(paneId)
    }
    focusPane(paneId, shortcut.slice("focus-".length) as FocusDirection)
  }, [focusPane, onClosePane, onSplitPane, restoreMaximizedPane])

  const handlePaneDragStart = useCallback((sourcePaneId: string) => {
    restoreMaximizedPane()
    setPaneDrag({ sourcePaneId, targetPaneId: null, edge: null })
  }, [restoreMaximizedPane])

  const handleMovePane = useCallback((
    sourcePaneId: string,
    targetPaneId: string,
    edge: SynapseTerminalPaneDropEdge,
  ) => {
    restoreMaximizedPane()
    onMovePane(sourcePaneId, targetPaneId, edge)
  }, [onMovePane, restoreMaximizedPane])

  const handlePaneDragTargetChange = useCallback((
    targetPaneId: string,
    edge: SynapseTerminalPaneDropEdge | null,
  ) => {
    setPaneDrag((current) => {
      if (!current) return current
      if (current.sourcePaneId === targetPaneId) {
        return current.targetPaneId === null ? current : { ...current, targetPaneId: null, edge: null }
      }
      if (!edge && current.targetPaneId !== targetPaneId) return current
      if (current.targetPaneId === targetPaneId && current.edge === edge) return current
      return { ...current, targetPaneId: edge ? targetPaneId : null, edge }
    })
  }, [])

  const handlePaneDragEnd = useCallback(() => setPaneDrag(null), [])
  const handleToggleFileTree = useCallback((paneId: string) => {
    setFileTreePaneIds((current) => {
      const next = new Set(current)
      if (next.has(paneId)) next.delete(paneId)
      else next.add(paneId)
      return next
    })
  }, [])
  const handleCloseFileTree = useCallback((paneId: string) => {
    setFileTreePaneIds((current) => {
      if (!current.has(paneId)) return current
      const next = new Set(current)
      next.delete(paneId)
      return next
    })
  }, [])
  const handleFileTreeWidthCommit = useCallback((width: number) => {
    setFileTreeWidth(width)
    writeWorkspacePanelWidth(
      TERMINAL_FILE_TREE_PERSISTENCE_ID,
      width,
      TERMINAL_FILE_TREE_WIDTH_CONSTRAINTS,
    )
  }, [])

  return (
    <>
      <TerminalLayout
        getPaneHost={getPaneHost}
        layout={workspace.layout}
        maximizedPaneSides={maximizedPaneSides}
        maximized={maximizedPaneId !== null}
        onSplitRatioChange={handleSplitRatioChange}
        registerSplitLayoutControls={registerSplitLayoutControls}
      />
      {workspacePanes.map((pane) => {
        const session = sessionsById.get(pane.sessionId)
        if (!session) return null
        const equalizeDirection = findTerminalPaneParentDirection(workspace.layout, pane.paneId)
        return createPortal(
          <TerminalPane
            active={pane.paneId === activePaneId}
            appearanceSize={appearanceSize}
            dimmed={dimInactivePanes && pane.paneId !== activePaneId}
            dragSourcePaneId={paneDrag?.sourcePaneId ?? null}
            dragged={pane.paneId === paneDrag?.sourcePaneId}
            dropEdge={pane.paneId === paneDrag?.targetPaneId ? paneDrag.edge : null}
            fileTreeOpen={fileTreePaneIds.has(pane.paneId)}
            fileTreeWidth={fileTreeWidth}
            equalizeDirection={equalizeDirection}
            equalizeDisabled={!equalizeDirection || pendingClosePaneIds.has(pane.paneId) || workspaceClosingPaneIds.has(pane.paneId)}
            maximized={pane.paneId === maximizedPaneId}
            maximizeDisabled={workspacePanes.length <= 1 || pendingClosePaneIds.has(pane.paneId) || workspaceClosingPaneIds.has(pane.paneId)}
            onActive={() => activatePane(pane.paneId)}
            onMovePane={handleMovePane}
            onCloseFileTree={() => handleCloseFileTree(pane.paneId)}
            onEqualize={() => equalizePane(pane.paneId)}
            onFileTreeWidthChange={setFileTreeWidth}
            onFileTreeWidthCommit={handleFileTreeWidthCommit}
            onPaneDragEnd={handlePaneDragEnd}
            onPaneDragStart={() => handlePaneDragStart(pane.paneId)}
            onPaneDragTargetChange={(edge) => handlePaneDragTargetChange(pane.paneId, edge)}
            onRenameSession={onRenameSession}
            onSessionChanged={onSessionChanged}
            onSessionDeleted={onSessionDeleted}
            onShortcut={(shortcut) => handleShortcut(pane.paneId, shortcut)}
            onToggleFileTree={() => handleToggleFileTree(pane.paneId)}
            onToggleMaximize={() => togglePaneMaximize(pane.paneId)}
            paneId={pane.paneId}
            closePending={pendingClosePaneIds.has(pane.paneId)}
            closing={workspaceClosingPaneIds.has(pane.paneId)}
            platform={platform}
            registerControls={registerPaneControls}
            registerElement={registerPaneElement}
            session={session}
            visible={visible}
          />,
          getPaneHost(pane.paneId),
          pane.paneId,
        )
      })}
    </>
  )
}

function TerminalLayout({
  getPaneHost,
  layout,
  maximized,
  maximizedPaneSides,
  onSplitRatioChange,
  registerSplitLayoutControls,
}: {
  readonly getPaneHost: (paneId: string) => HTMLDivElement
  readonly layout: SynapseTerminalLayoutNode
  readonly maximized: boolean
  readonly maximizedPaneSides: ReadonlyMap<string, "first" | "second">
  readonly onSplitRatioChange: (splitId: string, ratio: number) => void
  readonly registerSplitLayoutControls: (splitId: string, controls: SplitLayoutControls | null) => void
}) {
  if (layout.type === "leaf") {
    return <TerminalPaneSlot host={getPaneHost(layout.paneId)} />
  }

  return (
    <TerminalSplitLayout
      getPaneHost={getPaneHost}
      layout={layout}
      maximized={maximized}
      maximizedPaneSides={maximizedPaneSides}
      onSplitRatioChange={onSplitRatioChange}
      registerSplitLayoutControls={registerSplitLayoutControls}
    />
  )
}

function TerminalSplitLayout({
  getPaneHost,
  layout,
  maximized,
  maximizedPaneSides,
  onSplitRatioChange,
  registerSplitLayoutControls,
}: {
  readonly getPaneHost: (paneId: string) => HTMLDivElement
  readonly layout: Extract<SynapseTerminalLayoutNode, { type: "split" }>
  readonly maximized: boolean
  readonly maximizedPaneSides: ReadonlyMap<string, "first" | "second">
  readonly onSplitRatioChange: (splitId: string, ratio: number) => void
  readonly registerSplitLayoutControls: (splitId: string, controls: SplitLayoutControls | null) => void
}) {
  const groupRef = useGroupRef()
  const firstPanelRef = usePanelRef()
  const secondPanelRef = usePanelRef()

  const firstId = `${layout.splitId}:first`
  const secondId = `${layout.splitId}:second`
  const maximizedPaneSide = maximizedPaneSides.get(layout.splitId)
  const firstIsSibling = maximizedPaneSide === "second"
  const secondIsSibling = maximizedPaneSide === "first"

  useLayoutEffect(() => {
    const controls: SplitLayoutControls = {
      getLayout: () => groupRef.current?.getLayout() ?? {
        [firstId]: layout.ratio * 100,
        [secondId]: (1 - layout.ratio) * 100,
      },
      resizeSibling: (paneSide) => {
        const siblingPanel = paneSide === "first" ? secondPanelRef.current : firstPanelRef.current
        siblingPanel?.resize("100px")
      },
      setLayout: (nextLayout) => {
        groupRef.current?.setLayout(nextLayout)
      },
    }
    registerSplitLayoutControls(layout.splitId, controls)
    return () => registerSplitLayoutControls(layout.splitId, null)
  }, [firstId, groupRef, layout.ratio, layout.splitId, registerSplitLayoutControls, secondId, firstPanelRef, secondPanelRef])

  useLayoutEffect(() => {
    if (maximized) return
    const currentLayout = groupRef.current?.getLayout()
    const first = currentLayout?.[firstId]
    const second = currentLayout?.[secondId]
    if (first === undefined || second === undefined || first + second === 0) return
    if (Math.abs(first / (first + second) - layout.ratio) < 0.001) return
    groupRef.current?.setLayout({
      [firstId]: layout.ratio * 100,
      [secondId]: (1 - layout.ratio) * 100,
    })
  }, [firstId, groupRef, layout.ratio, maximized, secondId])

  return (
    <ResizablePanelGroup
      id={layout.splitId}
      groupRef={groupRef}
      orientation={layout.direction}
      defaultLayout={{
        [firstId]: layout.ratio * 100,
        [secondId]: (1 - layout.ratio) * 100,
      }}
      onLayoutChanged={(sizes) => {
        const first = sizes[firstId]
        const second = sizes[secondId]
        if (first === undefined || second === undefined || first + second === 0) return
        const ratio = first / (first + second)
        if (Math.abs(ratio - layout.ratio) < 0.001) return
        onSplitRatioChange(layout.splitId, ratio)
      }}
    >
      <ResizablePanel
        id={firstId}
        panelRef={firstPanelRef}
        minSize={firstIsSibling ? "100px" : "10%"}
        maxSize={firstIsSibling ? "100px" : undefined}
        groupResizeBehavior={firstIsSibling ? "preserve-pixel-size" : undefined}
        data-terminal-maximized-sibling={firstIsSibling ? "first" : undefined}
      >
        <TerminalLayout
          getPaneHost={getPaneHost}
          layout={layout.first}
          maximized={maximized}
          maximizedPaneSides={maximizedPaneSides}
          onSplitRatioChange={onSplitRatioChange}
          registerSplitLayoutControls={registerSplitLayoutControls}
        />
      </ResizablePanel>
      <ResizableHandle
        disabled={maximized}
        data-terminal-split-locked={maximized ? "true" : undefined}
      />
      <ResizablePanel
        id={secondId}
        panelRef={secondPanelRef}
        minSize={secondIsSibling ? "100px" : "10%"}
        maxSize={secondIsSibling ? "100px" : undefined}
        groupResizeBehavior={secondIsSibling ? "preserve-pixel-size" : undefined}
        data-terminal-maximized-sibling={secondIsSibling ? "second" : undefined}
      >
        <TerminalLayout
          getPaneHost={getPaneHost}
          layout={layout.second}
          maximized={maximized}
          maximizedPaneSides={maximizedPaneSides}
          onSplitRatioChange={onSplitRatioChange}
          registerSplitLayoutControls={registerSplitLayoutControls}
        />
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}

function TerminalPaneSlot({ host }: { readonly host: HTMLDivElement }) {
  const slotRef = useRef<HTMLDivElement | null>(null)
  const attachHost = useCallback((element: HTMLDivElement | null) => {
    const previousSlot = slotRef.current
    slotRef.current = element
    if (element) {
      element.append(host)
    } else if (previousSlot && host.parentElement === previousSlot) {
      host.remove()
    }
  }, [host])

  return <div ref={attachHost} className="h-full min-h-0 min-w-0 overflow-hidden" />
}

function captureTerminalSplitLayouts(
  layout: SynapseTerminalLayoutNode,
  controlsBySplitId: ReadonlyMap<string, SplitLayoutControls>,
  snapshot = new Map<string, Layout>(),
): Map<string, Layout> {
  if (layout.type === "leaf") return snapshot
  const firstId = `${layout.splitId}:first`
  const secondId = `${layout.splitId}:second`
  const liveLayout = controlsBySplitId.get(layout.splitId)?.getLayout()
  snapshot.set(layout.splitId, liveLayout?.[firstId] !== undefined && liveLayout[secondId] !== undefined
    ? { ...liveLayout }
    : {
        [firstId]: layout.ratio * 100,
        [secondId]: (1 - layout.ratio) * 100,
      })
  captureTerminalSplitLayouts(layout.first, controlsBySplitId, snapshot)
  captureTerminalSplitLayouts(layout.second, controlsBySplitId, snapshot)
  return snapshot
}

/**
 * The conversation name in a pane header. Renaming is offered through the same gestures as the
 * sidebar tab row: double-click, or the context menu. The header doubles as the pane drag handle,
 * so both gestures stay on the title and the drag keeps working on the rest of the header.
 *
 * The title stays unfocusable on purpose: a focusable label would pull focus away from the
 * terminal on every click on the header.
 */
function TerminalPaneTitle({
  onActive,
  onRename,
  title,
}: {
  readonly onActive: () => void
  readonly onRename: () => void
  readonly title: string
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <span
          className="truncate text-xs font-medium text-foreground/75"
          data-track="terminal-pane-title"
          onClick={() => {
            track({
              component: "terminal",
              name: "terminal.pane.title_select",
              action: "select",
              eventKey: "terminal.pane.title_select",
            })
            onActive()
          }}
          onDoubleClick={() => {
            track({
              component: "terminal",
              name: "terminal.pane.rename",
              action: "open",
              eventKey: "terminal.pane.rename",
            })
            onRename()
          }}
        >
          {title}
        </span>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={onRename}>
          <Pencil />
          重命名
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

function TerminalPane({
  active,
  appearanceSize,
  closePending,
  closing,
  dimmed,
  dragSourcePaneId,
  dragged,
  dropEdge,
  fileTreeOpen,
  fileTreeWidth,
  equalizeDirection,
  equalizeDisabled,
  maximized,
  maximizeDisabled,
  onActive,
  onCloseFileTree,
  onEqualize,
  onFileTreeWidthChange,
  onFileTreeWidthCommit,
  onMovePane,
  onPaneDragEnd,
  onPaneDragStart,
  onPaneDragTargetChange,
  onRenameSession,
  onSessionChanged,
  onSessionDeleted,
  onShortcut,
  onToggleFileTree,
  onToggleMaximize,
  paneId,
  platform,
  registerControls,
  registerElement,
  session,
  visible,
}: {
  readonly active: boolean
  readonly appearanceSize: TerminalAppearanceSize
  readonly closePending: boolean
  readonly closing: boolean
  readonly dimmed: boolean
  readonly dragSourcePaneId: string | null
  readonly dragged: boolean
  readonly dropEdge: SynapseTerminalPaneDropEdge | null
  readonly fileTreeOpen: boolean
  readonly fileTreeWidth: number
  readonly equalizeDirection: "horizontal" | "vertical" | null
  readonly equalizeDisabled: boolean
  readonly maximized: boolean
  readonly maximizeDisabled: boolean
  readonly onActive: () => void
  readonly onCloseFileTree: () => void
  readonly onEqualize: () => void
  readonly onFileTreeWidthChange: (width: number) => void
  readonly onFileTreeWidthCommit: (width: number) => void
  readonly onMovePane: (
    sourcePaneId: string,
    targetPaneId: string,
    edge: SynapseTerminalPaneDropEdge,
  ) => void
  readonly onPaneDragEnd: () => void
  readonly onPaneDragStart: () => void
  readonly onPaneDragTargetChange: (edge: SynapseTerminalPaneDropEdge | null) => void
  readonly onRenameSession: (sessionId: string, returnFocus: HTMLElement | null) => void
  readonly onSessionChanged: (session: SynapseTerminalSession) => void
  readonly onSessionDeleted: (sessionId: string) => void
  readonly onShortcut: (shortcut: TerminalPaneShortcut) => void
  readonly onToggleFileTree: () => void
  readonly onToggleMaximize: () => void
  readonly paneId: string
  readonly platform: string | undefined
  readonly registerControls: (paneId: string, controls: PaneControls | null) => void
  readonly registerElement: (paneId: string, element: HTMLDivElement | null) => void
  readonly session: SynapseTerminalSession
  readonly visible: boolean
}) {
  const terminalBridge = requireBridgeDomain("terminal")
  const workspaceTreeBridge = terminalBridge.workspaceTree
  const shellBridge = requireBridgeDomain("shell")
  const containerRef = useRef<HTMLDivElement | null>(null)
  /**
   * The pane's terminal area, one level above the mount.
   *
   * Geometry is measured here rather than on the mount because in the remote-sized
   * mode the mount is set to the phone's grid, and measuring that would make this
   * component's own layout look like the user resizing the pane.
   */
  const frameRef = useRef<HTMLDivElement | null>(null)
  const paneRootRef = useRef<HTMLDivElement | null>(null)
  const paneContentRef = useRef<HTMLDivElement | null>(null)
  const fileTreeOverlayRef = useRef<HTMLDivElement | null>(null)
  const fileTreeTriggerRef = useRef<HTMLButtonElement | null>(null)
  const xtermRef = useRef<Terminal | null>(null)
  const syncTerminalGeometryRef = useRef<((refreshRenderer?: boolean) => void) | null>(null)
  /** Hands the grid back to this machine. Reached from the pane header button. */
  const releaseGridOwnershipRef = useRef<((announceFailure?: boolean) => void) | null>(null)
  const setProjectionVisibilityRef = useRef<((nextVisible: boolean) => void) | null>(null)
  const appearanceSizeRef = useRef(appearanceSize)
  const sessionRef = useRef(session)
  /** True while a phone decides this terminal's grid. */
  const remoteSized = session.sizeOwner?.kind === "mobile"
  /**
   * The phone's grid in pixels, so the mount can be laid out at it.
   *
   * Measured from xterm's own screen element rather than computed from a cell size,
   * because that element is already exactly the grid — and the cell size lives
   * inside xterm, which does not expose it.
   */
  const [remoteCanvas, setRemoteCanvas] = useState<{ width: number; height: number } | null>(null)
  const onSessionChangedRef = useRef(onSessionChanged)
  const onSessionDeletedRef = useRef(onSessionDeleted)
  const onShortcutRef = useRef(onShortcut)
  const [readError, setReadError] = useState<string | null>(null)
  const [projectionReady, setProjectionReady] = useState(false)
  const [pathDropActive, setPathDropActive] = useState(false)
  const [fileTreeRootRevision, setFileTreeRootRevision] = useState(0)
  const fileTreeDataSource = useMemo<WorkspaceFileTreeDataSource | null>(() =>
    workspaceTreeBridge ? ({
      open: () => workspaceTreeBridge.open({ sessionId: session.id }),
      list: workspaceTreeBridge.list,
      close: workspaceTreeBridge.close,
      onChanged: workspaceTreeBridge.onChanged,
    }) : null, [session.id, workspaceTreeBridge])
  appearanceSizeRef.current = appearanceSize
  sessionRef.current = session
  onSessionChangedRef.current = onSessionChanged
  onSessionDeletedRef.current = onSessionDeleted
  onShortcutRef.current = onShortcut
  const visibleRef = useRef(visible)
  visibleRef.current = visible

  useDismissOnPointerDownOutside(
    fileTreeOpen,
    fileTreeOverlayRef,
    fileTreeTriggerRef,
    onCloseFileTree,
  )

  useEffect(() => {
    const xterm = xtermRef.current
    if (!xterm) return
    xterm.options.disableStdin = session.status !== "running"
  }, [session.status])

  useEffect(() => {
    if (!visible || !projectionReady) return undefined
    const frame = requestAnimationFrame(() => {
      syncTerminalGeometryRef.current?.(true)
    })
    return () => cancelAnimationFrame(frame)
  }, [projectionReady, visible])

  useEffect(() => {
    if (active && visible) xtermRef.current?.focus()
  }, [active, visible])

  useEffect(() => {
    if (!fileTreeOpen) return undefined
    return terminalBridge.operation.onWorkingDirectoryChanged?.((event) => {
      if (event.sessionId === session.id) setFileTreeRootRevision((current) => current + 1)
    })
  }, [fileTreeOpen, session.id, terminalBridge])

  useEffect(() => {
    if (!pathDropActive) return undefined
    const clearPathDrop = () => setPathDropActive(false)
    window.addEventListener("dragend", clearPathDrop)
    return () => window.removeEventListener("dragend", clearPathDrop)
  }, [pathDropActive])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return undefined

    setReadError(null)
    setProjectionReady(false)
    let disposed = false
    let deleted = false
    let lastSeq = 0
    let attached = false
    let projectionAvailable = false
    let geometrySyncReady = false
    let appliedSizeRevision = sessionRef.current.sizeRevision
    let announcedSizeRevision = sessionRef.current.sizeRevision
    let drainInFlight = false
    let projectionGeneration = 0
    let projectionVisible = visibleRef.current && document.visibilityState !== "hidden"
    let requestedResize = { cols: sessionRef.current.cols, rows: sessionRef.current.rows }
    const pendingChunks: SynapseTerminalOutputChunk[] = []
    const resizeBarriers = new Map<number, SynapseTerminalResizedEvent>()
    const xterm = new Terminal({
      ...createTerminalRenderingOptions({
        appearanceSize: appearanceSizeRef.current,
        container,
        disableStdin: sessionRef.current.status !== "running",
      }),
      cols: sessionRef.current.cols,
      rows: sessionRef.current.rows,
    })
    const unicodeWidthStatus = installTerminalUnicodeWidth(xterm)
    if (unicodeWidthStatus !== "patched") {
      logger.warn("Terminal unicode width table fell back.", { status: unicodeWidthStatus })
    }
    xtermRef.current = xterm
    const fitAddon = new FitAddon()
    const webLinksAddon = new WebLinksAddon((_event, uri) => {
      void shellBridge.openExternal(uri).catch((error) => {
        logger.error("Failed to open terminal web link.", error)
        toast.error("打开链接失败")
      })
    })
    xterm.loadAddon(fitAddon)
    xterm.loadAddon(webLinksAddon)
    xterm.open(container)
    const webglRenderer = loadWebglRenderer(xterm)
    const compositionTextarea = container.querySelector<HTMLTextAreaElement>(".xterm-helper-textarea")
    const constrainComposition = () => constrainTerminalCompositionToViewport(container)
    compositionTextarea?.addEventListener("compositionupdate", constrainComposition)

    /**
     * The pane area's size at the last sync, so a genuine layout change can be told
     * apart from the observer merely firing again.
     *
     * Null until the first look, which only establishes the baseline. Starting from
     * zero instead would make mounting the pane read as a resize — and a pane
     * remounts whenever its workspace is switched back to, which would take the grid
     * away from a phone that had done nothing.
     */
    let lastPaneSize: { width: number; height: number } | null = null
    /** Set once this pane has asked to give the grid back, so it asks once. Cleared
     *  when the claim is gone, which is what lets a later claim preempt again. */
    let ownershipReleaseRequested = false

    /**
     * Sizes the mount to the phone's grid, or takes it back to filling the pane.
     *
     * The screen element is measured rather than a cell size computed, because xterm
     * owns the cell size and does not expose it. The extra width is the scrollbar the
     * viewport lays over the right edge: without it the last column sits under it.
     */
    let remoteCanvasFrame: number | undefined
    /**
     * Whether the mount is currently wearing the phone's dimensions.
     *
     * A flag rather than the state alone: the fit has to know this *before* React has
     * re-rendered, because that is exactly the window in which it would measure the
     * wrong thing.
     */
    let remoteCanvasApplied = false
    const syncRemoteCanvas = () => {
      if (remoteCanvasFrame !== undefined) return
      if (sessionRef.current.sizeOwner?.kind !== "mobile") {
        remoteCanvasApplied = false
        setRemoteCanvas((current) => (current === null ? current : null))
        return
      }
      // Measured on the next frame rather than now. A font-size change is applied by
      // xterm's own render pass, so reading the screen element in the same tick
      // would measure the size it is about to stop being.
      remoteCanvasFrame = requestAnimationFrame(() => {
        remoteCanvasFrame = undefined
        if (disposed) return
        if (sessionRef.current.sizeOwner?.kind !== "mobile") return
        const screen = container.querySelector<HTMLElement>(".xterm-screen")
        if (!screen || screen.offsetWidth === 0 || screen.offsetHeight === 0) return
        remoteCanvasApplied = true
        const next = {
          width: screen.offsetWidth + TERMINAL_VIEWPORT_SCROLLBAR_PX,
          height: screen.offsetHeight,
        }
        setRemoteCanvas((current) =>
          current && current.width === next.width && current.height === next.height ? current : next,
        )
      })
    }

    const releaseGridOwnership = (announceFailure = false) => {
      void terminalBridge.session
        .releaseSizeOwnership({ sessionId: session.id })
        .then(() => syncTerminalGeometryRef.current?.(true))
        .catch((error) => {
          ownershipReleaseRequested = false
          logger.warn("Failed to release terminal grid ownership.", error)
          // Only when the reader asked for it. Preemption happens because they
          // resized something, and they are already looking at the result.
          if (announceFailure) toast.error("重置终端尺寸失败")
        })
    }
    releaseGridOwnershipRef.current = releaseGridOwnership

    const syncTerminalGeometry = (refreshRenderer = false) => {
      if (disposed || !projectionVisible || !geometrySyncReady || !projectionAvailable) return
      if (refreshRenderer) xterm.refresh(0, xterm.rows - 1)

      // Measured on the pane, not on the mount: in the remote-sized mode the mount
      // is set to the phone's grid, so measuring that would make this component's
      // own layout look like someone resizing the pane.
      const pane = frameRef.current
      const size = { width: pane?.clientWidth ?? 0, height: pane?.clientHeight ?? 0 }
      const paneChanged = lastPaneSize !== null
        && (size.width !== lastPaneSize.width || size.height !== lastPaneSize.height)
      lastPaneSize = size

      const owner = sessionRef.current.sizeOwner
      const decision = decideTerminalGrid({
        hasMobileOwner: owner?.kind === "mobile",
        releaseRequested: ownershipReleaseRequested,
        paneChanged,
      })
      const canvasWasRemote = remoteCanvasApplied
      syncRemoteCanvas()
      if (decision === "hold") return
      if (decision === "release") {
        ownershipReleaseRequested = true
        releaseGridOwnership()
        return
      }
      // No claim left, so a later one is free to preempt all over again.
      if (!owner) ownershipReleaseRequested = false

      // The mount is still sized to the phone's grid, and React has not re-rendered to
      // take that off it yet. Measuring it here proposes the phone's grid — which is
      // the size the terminal already has — so the fit finds nothing to do, skips the
      // resize, and the terminal keeps the phone's shape until some unrelated event
      // happens to run the fit again. That is why taking the size back appeared to
      // work only after clicking the terminal.
      if (canvasWasRemote) {
        requestAnimationFrame(() => syncTerminalGeometryRef.current?.(true))
        return
      }

      const proposed = fitAddon.proposeDimensions()
      const cols = proposed?.cols ?? xterm.cols
      const rows = proposed?.rows ?? xterm.rows
      if (!cols || !rows) return
      if (xterm.cols === cols && xterm.rows === rows) return
      if (requestedResize.cols === cols && requestedResize.rows === rows) return
      requestedResize = { cols, rows }
      void terminalBridge.session.resize({ sessionId: session.id, cols, rows }).catch((error) => {
        requestedResize = { cols: xterm.cols, rows: xterm.rows }
        logger.warn("Failed to resize terminal session.", error)
      })
    }
    syncTerminalGeometryRef.current = syncTerminalGeometry

    const controls: PaneControls = {
      clear: () => xterm.clear(),
      focus: () => xterm.focus(),
    }
    registerControls(paneId, controls)

    let resizeFrame: number | undefined
    const resizeObserver = new ResizeObserver(() => {
      if (resizeFrame !== undefined) return
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = undefined
        syncTerminalGeometry()
        constrainComposition()
      })
    })
    // Observes the pane area, not the mount: the mount's size is chosen by this
    // component in the remote-sized mode, and watching it would make every layout
    // change here read as a user resize.
    resizeObserver.observe(frameRef.current ?? container)

    const writeTerminalInput = (data: string) => {
      if (disposed || xterm.options.disableStdin) return
      void terminalBridge.session.write({ sessionId: session.id, data }).catch((error) => {
        logger.error("Failed to write terminal input.", error)
        toast.error("写入终端失败")
      })
    }

    xterm.attachCustomKeyEventHandler((event) => {
      const shortcut = getTerminalPaneShortcut(event, platform)
      if (shortcut) {
        event.preventDefault()
        event.stopPropagation()
        if (event.type === "keydown" && !event.repeat) onShortcutRef.current(shortcut)
        return false
      }
      const clipboardShortcut = getTerminalClipboardShortcut(event, platform)
      if (clipboardShortcut === "copy") {
        if (!xterm.hasSelection() || !navigator.clipboard?.writeText) return true
        event.preventDefault()
        event.stopPropagation()
        if (event.type === "keydown" && !event.repeat) {
          const selection = xterm.getSelection()
          void navigator.clipboard.writeText(selection).catch((error) => {
            logger.error("Failed to copy terminal selection.", error)
            toast.error("复制终端文字失败")
          })
        }
        return false
      }
      if (clipboardShortcut === "paste") {
        if (xterm.options.disableStdin) {
          event.preventDefault()
          event.stopPropagation()
          return false
        }
        if (!navigator.clipboard?.readText) return true
        event.preventDefault()
        event.stopPropagation()
        if (event.type === "keydown" && !event.repeat) {
          void terminalBridge.clipboard.materializeImage().then(async (imagePath) => {
            if (disposed) return
            if (imagePath) {
              xterm.paste(quoteTerminalClipboardPath(imagePath, platform))
              return
            }
            if (!navigator.clipboard?.readText) return
            xterm.paste(await navigator.clipboard.readText())
          }).catch((error) => {
            logger.error("Failed to read clipboard for terminal paste.", error)
            toast.error("读取剪贴板失败")
          })
        }
        return false
      }
      if (!isTerminalShiftEnterEvent(event)) return true
      event.preventDefault()
      event.stopPropagation()
      if (event.type === "keydown") writeTerminalInput("\n")
      return false
    })

    const inputDisposable = xterm.onData(writeTerminalInput)
    let terminalWriteChain = Promise.resolve()
    const writeTerminalData = (data: string) => {
      terminalWriteChain = terminalWriteChain.then(() => new Promise<void>((writeResolve) => {
        if (disposed) return writeResolve()
        xterm.write(data, writeResolve)
      }))
      return terminalWriteChain
    }
    const resetTerminalData = () => {
      terminalWriteChain = terminalWriteChain.then(() => {
        if (!disposed) xterm.reset()
      })
      return terminalWriteChain
    }

    const writePendingChunksThrough = async (throughOutputSeq: number, generation: number) => {
      pendingChunks.sort((left, right) => left.seq - right.seq)
      while (!disposed && generation === projectionGeneration && pendingChunks.length > 0) {
        const chunk = pendingChunks[0]!
        if (chunk.seq > throughOutputSeq) break
        pendingChunks.shift()
        if (chunk.seq <= lastSeq) continue
        await writeTerminalData(chunk.data)
        if (generation !== projectionGeneration) return
        lastSeq = chunk.seq
      }
    }

    const drainProjection = async () => {
      if (drainInFlight || !attached || !projectionAvailable || disposed) return
      const generation = projectionGeneration
      drainInFlight = true
      try {
        while (!disposed && generation === projectionGeneration) {
          const nextBarrier = [...resizeBarriers.values()]
            .filter((event) => event.sizeRevision > appliedSizeRevision)
            .sort((left, right) => left.sizeRevision - right.sizeRevision)[0]
          if (nextBarrier) {
            await writePendingChunksThrough(nextBarrier.throughOutputSeq, generation)
            if (disposed || generation !== projectionGeneration) return
            xterm.resize(nextBarrier.cols, nextBarrier.rows)
            appliedSizeRevision = nextBarrier.sizeRevision
            requestedResize = { cols: nextBarrier.cols, rows: nextBarrier.rows }
            // The grid just changed shape, so the mount's size — which is the grid
            // in the remote-sized mode — has to follow it.
            syncRemoteCanvas()
            resizeBarriers.delete(nextBarrier.sizeRevision)
            continue
          }
          if (announcedSizeRevision > appliedSizeRevision || pendingChunks.length === 0) return
          await writePendingChunksThrough(Number.POSITIVE_INFINITY, generation)
        }
      } finally {
        drainInFlight = false
        const hasApplicableBarrier = [...resizeBarriers.keys()].some((revision) => revision > appliedSizeRevision)
        if (attached && projectionAvailable
          && (hasApplicableBarrier || (announcedSizeRevision <= appliedSizeRevision && pendingChunks.length > 0))) {
          void drainProjection()
        }
      }
    }

    const handleData = (event: { readonly sessionId: string; readonly chunk: SynapseTerminalOutputChunk }) => {
      if (event.sessionId !== session.id || disposed || !projectionVisible) return
      pendingChunks.push(event.chunk)
      void drainProjection()
    }
    const handleResized = (event: SynapseTerminalResizedEvent) => {
      if (event.sessionId !== session.id || disposed || !projectionVisible
        || event.sizeRevision <= appliedSizeRevision) return
      announcedSizeRevision = Math.max(announcedSizeRevision, event.sizeRevision)
      resizeBarriers.set(event.sizeRevision, event)
      void drainProjection()
    }
    let unsubscribeData: (() => void) | undefined
    let unsubscribeResized: (() => void) | undefined
    const subscribeProjectionEvents = () => {
      if (unsubscribeData || disposed) return
      unsubscribeData = terminalBridge.operation.onData(handleData)
      unsubscribeResized = terminalBridge.operation.onResized(handleResized)
    }
    const unsubscribeProjectionEvents = () => {
      unsubscribeData?.()
      unsubscribeResized?.()
      unsubscribeData = undefined
      unsubscribeResized = undefined
    }
    const unsubscribeSessionChanged = terminalBridge.operation.onSessionChanged((nextSession) => {
      if (nextSession.id !== session.id) return
      onSessionChangedRef.current(nextSession)
      if (nextSession.sizeRevision <= announcedSizeRevision) return
      announcedSizeRevision = nextSession.sizeRevision
      void drainProjection()
    })
    const unsubscribeSessionDeleted = terminalBridge.operation.onSessionDeleted((event) => {
      if (event.sessionId !== session.id) return
      deleted = true
      onSessionDeletedRef.current(event.sessionId)
    })

    const attachProjection = async (generation: number, reset: boolean) => {
      const snapshot = await terminalBridge.session.attach({ sessionId: session.id })
      if (disposed || generation !== projectionGeneration || !projectionVisible) return
      onSessionChangedRef.current(snapshot.session)
      if (snapshot.degraded) {
        setReadError("终端画面无法恢复")
        attached = true
        setProjectionReady(true)
        return
      }
      const replaceExistingState = reset
        && (snapshot.throughOutputSeq !== lastSeq || snapshot.sizeRevision !== appliedSizeRevision)
      if (replaceExistingState) await resetTerminalData()
      if (disposed || generation !== projectionGeneration || !projectionVisible) return
      xterm.resize(snapshot.cols, snapshot.rows)
      syncRemoteCanvas()
      if (!reset || replaceExistingState) await writeTerminalData(snapshot.serialized)
      if (disposed || generation !== projectionGeneration || !projectionVisible) return
      lastSeq = snapshot.throughOutputSeq
      appliedSizeRevision = snapshot.sizeRevision
      announcedSizeRevision = Math.max(announcedSizeRevision, snapshot.sizeRevision)
      requestedResize = { cols: snapshot.cols, rows: snapshot.rows }
      for (const revision of resizeBarriers.keys()) {
        if (revision <= appliedSizeRevision) resizeBarriers.delete(revision)
      }
      attached = true
      projectionAvailable = true
      await drainProjection()
      geometrySyncReady = true
      syncTerminalGeometry()
      setProjectionReady(true)
    }

    const startProjection = (reset: boolean) => {
      const generation = ++projectionGeneration
      attached = false
      projectionAvailable = false
      geometrySyncReady = false
      pendingChunks.length = 0
      resizeBarriers.clear()
      setReadError(null)
      setProjectionReady(false)
      subscribeProjectionEvents()
      void attachProjection(generation, reset).catch((error) => {
        if (disposed || deleted || generation !== projectionGeneration || !projectionVisible) return
        logger.error("Failed to attach terminal projection.", error)
        setReadError("终端画面无法恢复")
        setProjectionReady(true)
        toast.error("终端画面无法恢复")
      })
    }
    const setProjectionVisibility = (nextVisible: boolean) => {
      if (nextVisible === projectionVisible) return
      projectionVisible = nextVisible
      if (nextVisible) {
        // Rebase from the core emulator so hidden TUI animation frames are not replayed.
        startProjection(true)
        return
      }
      projectionGeneration += 1
      attached = false
      projectionAvailable = false
      geometrySyncReady = false
      pendingChunks.length = 0
      resizeBarriers.clear()
      unsubscribeProjectionEvents()
      setProjectionReady(false)
    }
    setProjectionVisibilityRef.current = setProjectionVisibility

    if (projectionVisible) startProjection(false)

    return () => {
      disposed = true
      projectionGeneration += 1
      unsubscribeProjectionEvents()
      unsubscribeSessionChanged()
      unsubscribeSessionDeleted()
      inputDisposable.dispose()
      webglRenderer?.dispose()
      resizeObserver.disconnect()
      if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame)
      compositionTextarea?.removeEventListener("compositionupdate", constrainComposition)
      registerControls(paneId, null)
      if (syncTerminalGeometryRef.current === syncTerminalGeometry) {
        syncTerminalGeometryRef.current = null
      }
      if (setProjectionVisibilityRef.current === setProjectionVisibility) {
        setProjectionVisibilityRef.current = null
      }
      if (xtermRef.current === xterm) xtermRef.current = null
      xterm.dispose()
    }
  }, [paneId, platform, registerControls, session.id, shellBridge, terminalBridge])

  useEffect(() => {
    const updateProjectionVisibility = () => {
      setProjectionVisibilityRef.current?.(visible && document.visibilityState !== "hidden")
    }
    updateProjectionVisibility()
    document.addEventListener("visibilitychange", updateProjectionVisibility)
    return () => document.removeEventListener("visibilitychange", updateProjectionVisibility)
  }, [visible])

  useEffect(() => {
    const xterm = xtermRef.current
    if (!xterm) return
    const appearanceOptions = getTerminalAppearanceOptions(appearanceSize)
    xterm.options.fontSize = appearanceOptions.fontSize
    xterm.options.lineHeight = appearanceOptions.lineHeight
    syncTerminalGeometryRef.current?.(true)
  }, [appearanceSize])

  /**
   * Takes the grid back when it stops being a phone's.
   *
   * Releasing the claim deliberately leaves the PTY where it is — nothing should
   * reflow a terminal on the strength of a phone that has already stopped looking at
   * it. The other half of that bargain is this effect: the desktop has to notice the
   * claim is gone and fit itself again, or the terminal keeps the phone's shape for
   * ever. Switching back to the fidelity mode then looks like it did nothing, because
   * as far as the PTY is concerned, it did.
   */
  const wasRemoteSizedRef = useRef(false)
  useEffect(() => {
    if (wasRemoteSizedRef.current && !remoteSized) {
      syncTerminalGeometryRef.current?.(true)
    }
    wasRemoteSizedRef.current = remoteSized
  }, [remoteSized])

  const writeDroppedPaths = useCallback((paths: readonly (string | null)[], eventKey: string) => {
    if (paths.length === 0 || paths.some((path) => !isValidDroppedTerminalPath(path))) {
      toast.error("拖拽路径不可用")
      return
    }
    const input = formatDroppedTerminalPaths(paths.filter(isValidDroppedTerminalPath))
    void runTrackedOperation(
      { component: "terminal", eventKey },
      () => writeTerminalInputChunks({
        input,
        write: (data) => terminalBridge.session.write({ sessionId: session.id, data }),
      }),
    ).catch((error) => {
      logger.error("Failed to write dropped terminal paths.", error)
      toast.error("写入终端失败")
    })
  }, [session.id, terminalBridge])

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (isTerminalPaneDrag(event)) {
      setPathDropActive(false)
      const sourcePaneId = dragSourcePaneId
      const edge = sourcePaneId && sourcePaneId !== paneId
        ? resolveTerminalPaneDropEdge(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect())
        : null
      onPaneDragTargetChange(edge)
      if (edge) {
        event.preventDefault()
        event.dataTransfer.dropEffect = "move"
      }
      return
    }
    const workspacePathDrag = hasWorkspaceFileTreeDrag(event.dataTransfer)
    if (!workspacePathDrag && !isExternalFileDrag(event)) return
    if (workspacePathDrag && isWorkspaceFileTreeEvent(event)) {
      setPathDropActive(false)
      return
    }
    event.preventDefault()
    if (workspacePathDrag) event.stopPropagation()
    event.dataTransfer.dropEffect = session.status === "running" ? "copy" : "none"
    setPathDropActive(session.status === "running")
  }, [dragSourcePaneId, onPaneDragTargetChange, paneId, session.status])

  const handleDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    const relatedTarget = event.relatedTarget
    if (relatedTarget instanceof Node && event.currentTarget.contains(relatedTarget)) return
    if (isTerminalPaneDrag(event)) onPaneDragTargetChange(null)
    setPathDropActive(false)
  }, [onPaneDragTargetChange])

  const handleDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (isTerminalPaneDrag(event)) {
      setPathDropActive(false)
      event.preventDefault()
      const sourcePaneId = readTerminalPaneDragId(event) ?? dragSourcePaneId
      const edge = sourcePaneId && sourcePaneId !== paneId
        ? resolveTerminalPaneDropEdge(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect())
        : null
      onPaneDragEnd()
      if (sourcePaneId && edge) {
        onMovePane(sourcePaneId, paneId, edge)
      }
      return
    }
    const workspacePathTransfer = hasWorkspaceFileTreeDrag(event.dataTransfer)
    const workspacePathDrag = readWorkspaceFileTreeDrag(event.dataTransfer)
    clearWorkspaceFileTreeDrag()
    if (!workspacePathDrag && !isExternalFileDrag(event)) return
    event.preventDefault()
    if (workspacePathTransfer) event.stopPropagation()
    setPathDropActive(false)
    onActive()
    if (session.status !== "running") {
      toast.error("终端未运行")
      return
    }
    if (workspacePathDrag) {
      void workspaceTreeBridge.resolve(workspacePathDrag).then((result) => {
        writeDroppedPaths(result.paths, "terminal.pane.drop_workspace_paths")
      }).catch((error) => {
        logger.warn("Failed to resolve dropped workspace paths.", { error })
        toast.error("拖拽路径不可用")
      })
      return
    }
    const paths = Array.from(event.dataTransfer.files ?? []).map((file) => shellBridge.filePathForDroppedFile(file))
    writeDroppedPaths(paths, "terminal.pane.drop_files")
  }, [dragSourcePaneId, onActive, onMovePane, onPaneDragEnd, paneId, session.status, shellBridge, workspaceTreeBridge, writeDroppedPaths])

  const handlePaneDragStart = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (event.target instanceof Element && event.target.closest("button")) {
      event.preventDefault()
      return
    }
    event.dataTransfer.effectAllowed = "move"
    event.dataTransfer.setData(TERMINAL_PANE_DRAG_TYPE, paneId)
    onPaneDragStart()
  }, [onPaneDragStart, paneId])

  const handleFileTreeResizeStart = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const startX = event.clientX
    const startWidth = fileTreeWidth
    let latestWidth = startWidth
    const handlePointerMove = (moveEvent: PointerEvent) => {
      const availableWidth = paneContentRef.current?.getBoundingClientRect().width
        ?? TERMINAL_FILE_TREE_MAX_WIDTH
      latestWidth = Math.min(
        TERMINAL_FILE_TREE_MAX_WIDTH,
        Math.max(TERMINAL_FILE_TREE_MIN_WIDTH, startWidth + moveEvent.clientX - startX),
        Math.max(TERMINAL_FILE_TREE_MIN_WIDTH, availableWidth),
      )
      onFileTreeWidthChange(latestWidth)
    }
    const handlePointerUp = () => {
      window.removeEventListener("pointermove", handlePointerMove)
      window.removeEventListener("pointerup", handlePointerUp)
      onFileTreeWidthCommit(latestWidth)
      track({
        component: "terminal",
        name: "terminal.file_tree.resize",
        action: "resize",
        eventKey: "terminal.file_tree.resize",
      })
    }
    window.addEventListener("pointermove", handlePointerMove)
    window.addEventListener("pointerup", handlePointerUp, { once: true })
  }, [fileTreeWidth, onFileTreeWidthChange, onFileTreeWidthCommit])

  const closeActionLabel = closePending || (closing && platform !== "darwin")
    ? "正在关闭分屏"
    : closing ? "强制关闭分屏" : "关闭分屏"
  const equalizeActionLabel = equalizeDirection === "horizontal"
    ? "平分宽度"
    : equalizeDirection === "vertical" ? "平分高度" : "平分分屏"

  return (
    <div
      ref={(element) => {
        paneRootRef.current = element
        registerElement(paneId, element)
      }}
      role="region"
      aria-label={`终端输出与输入：${session.title}`}
      data-terminal-pane-maximized={maximized ? "true" : undefined}
      data-track="terminal.pane.surface"
      data-track-native="true"
      tabIndex={0}
      onClick={onActive}
      onFocus={onActive}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className={cn(
        "relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background focus-visible:outline-none",
        active && "ring-1 ring-inset ring-ring",
        dimmed && "opacity-50",
      )}
    >
      <div
        data-terminal-pane-header
        data-track="terminal.pane.drag"
        data-track-native="true"
        draggable
        onDragEnd={onPaneDragEnd}
        onDragStart={handlePaneDragStart}
        className={cn(
          "flex h-7 shrink-0 cursor-grab items-center justify-between gap-2 border-b bg-card pl-2 pr-0.5",
          dragged && "cursor-grabbing",
        )}
      >
        <div className="flex min-w-0 items-center gap-0.5">
          <TerminalPaneTitle
            onActive={onActive}
            onRename={() => onRenameSession(session.id, paneRootRef.current)}
            title={session.title}
          />
          {remoteSized ? (
            <Badge variant="outline" className="shrink-0 text-muted-foreground">
              由 {session.sizeOwner?.deviceLabel} 设定 · {session.cols}×{session.rows}
            </Badge>
          ) : null}
          {workspaceTreeBridge ? <Button
            ref={fileTreeTriggerRef}
            type="button"
            size="icon-xs"
            variant="ghost"
            aria-label={fileTreeOpen ? `关闭文件树：${session.title}` : `打开文件树：${session.title}`}
            title={fileTreeOpen ? "关闭文件树" : "打开文件树"}
            aria-pressed={fileTreeOpen}
            data-track="terminal-pane-file-tree-toggle"
            className="shrink-0 text-muted-foreground"
            onClick={(event) => {
              event.stopPropagation()
              onActive()
              onToggleFileTree()
            }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <Folder className="size-3.5" />
          </Button> : null}
        </div>
        <div className="flex shrink-0 items-center">
          {remoteSized ? (
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              aria-label={`重置为电脑尺寸：${session.title}`}
              title="重置为电脑尺寸"
              data-track="terminal-pane-size-owner-reset"
              className="shrink-0 text-muted-foreground"
              onClick={(event) => {
                event.stopPropagation()
                onActive()
                releaseGridOwnershipRef.current?.(true)
              }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <RotateCcw className="size-3.5" />
            </Button>
          ) : null}
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            aria-label={`${equalizeActionLabel}：${session.title}`}
            title={equalizeActionLabel}
            data-track="terminal-pane-equalize"
            className="text-muted-foreground"
            disabled={equalizeDisabled}
            onClick={(event) => {
              event.stopPropagation()
              onActive()
              onEqualize()
            }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            {equalizeDirection === "vertical"
              ? <Rows3 className="size-3.5" />
              : <Columns3 className="size-3.5" />}
          </Button>
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            aria-label={`${maximized ? "还原分屏" : "最大化分屏"}：${session.title}`}
            title={maximized ? "还原分屏" : "最大化分屏"}
            aria-pressed={maximized}
            data-track="terminal-pane-maximize"
            className="text-muted-foreground"
            disabled={maximizeDisabled}
            onClick={(event) => {
              event.stopPropagation()
              onActive()
              onToggleMaximize()
            }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            {maximized
              ? <Minimize2 className="size-3.5" />
              : <Maximize2 className="size-3.5" />}
          </Button>
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            aria-label={`${closeActionLabel}：${session.title}`}
            title={closeActionLabel}
            className="text-muted-foreground hover:text-destructive"
            disabled={closePending || (closing && platform !== "darwin")}
            onClick={(event) => {
              event.stopPropagation()
              onShortcut("close-pane")
            }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            {closePending
              ? <Spinner className="size-3.5" aria-hidden="true" />
              : closing ? <Square className="size-3.5" /> : <X className="size-3.5" />}
          </Button>
        </div>
      </div>
      {dropEdge ? (
        <div
          aria-hidden="true"
          data-terminal-pane-drop-edge={dropEdge}
          className={cn(
            "pointer-events-none absolute z-20 bg-primary/20",
            dropEdge === "top" && "inset-x-0 top-0 h-1/4",
            dropEdge === "right" && "inset-y-0 right-0 w-1/4",
            dropEdge === "bottom" && "inset-x-0 bottom-0 h-1/4",
            dropEdge === "left" && "inset-y-0 left-0 w-1/4",
          )}
        />
      ) : null}
      <div ref={paneContentRef} className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
        {pathDropActive ? (
          <div
            className="pointer-events-none absolute inset-y-0 right-0 z-20 flex items-center justify-center border border-dashed bg-background/80"
            data-terminal-path-drop-overlay
            role="status"
            style={{ left: fileTreeOpen ? fileTreeWidth : 0 }}
          >
            <span className="text-sm font-medium text-foreground">松开插入路径</span>
          </div>
        ) : null}
        {readError ? (
          <div className="absolute inset-x-1 top-1 z-10 bg-background px-2 py-1 text-sm text-muted-foreground">
            {readError}
          </div>
        ) : null}
        <div
          ref={frameRef}
          data-terminal-xterm-frame
          className={cn(
            "h-full min-h-0 min-w-0 overflow-hidden p-1",
            // A phone-sized grid does not fill the pane, so it is placed rather
            // than stretched. Centring is the only arrangement that keeps the
            // dashed canvas outline reading as "this is the whole terminal".
            //
            // Keyed off the measured size rather than off the ownership, because
            // between the claim arriving and the grid being measured there is a
            // frame with no size to place — where a sized-out mount would collapse
            // to nothing and blink.
            remoteCanvas && "flex items-center justify-center",
            !projectionReady && "invisible",
          )}
        >
          <div
            ref={containerRef}
            data-terminal-xterm-mount
            data-remote-sized={remoteSized ? "" : undefined}
            className={cn(
              "min-h-0 min-w-0 overflow-hidden",
              remoteCanvas
                ? "shrink-0 rounded-sm outline-1 outline-dashed outline-border"
                : "h-full w-full",
            )}
            style={remoteCanvas ?? undefined}
          />
        </div>
        {fileTreeOpen && fileTreeDataSource ? (
          <div
            ref={fileTreeOverlayRef}
            data-terminal-file-tree-overlay
            className="absolute inset-y-0 left-0 z-10 max-w-full border-r bg-background"
            style={{ width: fileTreeWidth }}
          >
            <WorkspaceFileTree
              key={`${session.id}:${fileTreeRootRevision}`}
              dataSource={fileTreeDataSource}
              theme="dark"
              onClose={onCloseFileTree}
            />
            <div
              role="separator"
              aria-label="调整文件树宽度"
              aria-orientation="vertical"
              data-track="terminal-pane-file-tree-resize"
              className="absolute inset-y-0 right-0 w-1 cursor-col-resize"
              onPointerDown={handleFileTreeResizeStart}
            />
          </div>
        ) : null}
      </div>
    </div>
  )
}

function quoteTerminalClipboardPath(filePath: string, platform?: string): string {
  if (platform === "win32") return `"${filePath.replaceAll('"', '\\"')}"`
  return `'${filePath.replaceAll("'", "'\\''")}'`
}

type FocusDirection = "down" | "left" | "right" | "up"

export function findPaneInDirection(
  paneId: string,
  direction: FocusDirection,
  elements: ReadonlyMap<string, HTMLElement>,
): string | null {
  const current = elements.get(paneId)?.getBoundingClientRect()
  if (!current) return null
  const currentCenter = centerOf(current)
  let best: { paneId: string; score: number } | null = null

  for (const [candidateId, element] of elements) {
    if (candidateId === paneId) continue
    const candidateCenter = centerOf(element.getBoundingClientRect())
    const dx = candidateCenter.x - currentCenter.x
    const dy = candidateCenter.y - currentCenter.y
    const primary = direction === "left" ? -dx : direction === "right" ? dx : direction === "up" ? -dy : dy
    if (primary <= 0) continue
    const secondary = direction === "left" || direction === "right" ? Math.abs(dy) : Math.abs(dx)
    const score = primary + secondary * 2
    if (!best || score < best.score) best = { paneId: candidateId, score }
  }
  return best?.paneId ?? null
}

function centerOf(rect: DOMRect): { x: number; y: number } {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
}

function isExternalFileDrag(event: DragEvent<HTMLElement>): boolean {
  const types = Array.from(event.dataTransfer.types ?? [])
  return types.includes("Files") || Array.from(event.dataTransfer.files ?? []).length > 0
}

function isTerminalPaneDrag(event: DragEvent<HTMLElement>): boolean {
  return Array.from(event.dataTransfer.types ?? []).includes(TERMINAL_PANE_DRAG_TYPE)
}

function isWorkspaceFileTreeEvent(event: DragEvent<HTMLElement>): boolean {
  return event.target instanceof Element && Boolean(event.target.closest("[data-terminal-file-tree-overlay]"))
}

function readTerminalPaneDragId(event: DragEvent<HTMLElement>): string | null {
  const paneId = event.dataTransfer.getData(TERMINAL_PANE_DRAG_TYPE)
  return paneId || null
}

export function resolveTerminalPaneDropEdge(
  clientX: number,
  clientY: number,
  rect: Pick<DOMRect, "bottom" | "height" | "left" | "right" | "top" | "width">,
): SynapseTerminalPaneDropEdge | null {
  if (rect.width <= 0 || rect.height <= 0) return null
  const horizontalPosition = (clientX - rect.left) / rect.width
  const verticalPosition = (clientY - rect.top) / rect.height
  const distances: ReadonlyArray<readonly [SynapseTerminalPaneDropEdge, number]> = [
    ["top", verticalPosition],
    ["right", 1 - horizontalPosition],
    ["bottom", 1 - verticalPosition],
    ["left", horizontalPosition],
  ]
  const nearest = distances.reduce((best, candidate) => candidate[1] < best[1] ? candidate : best)
  return nearest[1] >= 0 && nearest[1] <= TERMINAL_PANE_DROP_EDGE_RATIO ? nearest[0] : null
}

function isValidDroppedTerminalPath(path: string | null): path is string {
  return typeof path === "string" && path.length > 0 && !/[\r\n]/.test(path)
}

function formatDroppedTerminalPaths(paths: readonly string[]): string {
  return `${paths.map(escapeTerminalPath).join(" ")} `
}

function escapeTerminalPath(path: string): string {
  return path.replace(/([\\\s"'`$&;()<>|*?[\]{}!#~])/g, "\\$1")
}

async function writeTerminalInputChunks(options: {
  readonly input: string
  readonly write: (data: string) => Promise<void>
}): Promise<void> {
  for (const chunk of splitTerminalInput(options.input)) await options.write(chunk)
}

function splitTerminalInput(input: string): string[] {
  const chunks: string[] = []
  for (let index = 0; index < input.length; index += TERMINAL_WRITE_CHUNK_SIZE) {
    chunks.push(input.slice(index, index + TERMINAL_WRITE_CHUNK_SIZE))
  }
  return chunks
}

function loadWebglRenderer(xterm: Terminal): { dispose(): void } | undefined {
  try {
    const webglAddon = new WebglAddon()
    const contextLossDisposable = webglAddon.onContextLoss(() => {
      logger.warn("Terminal WebGL renderer context lost; falling back to DOM renderer.")
      webglAddon.dispose()
    })
    xterm.loadAddon(webglAddon)
    return {
      dispose: () => contextLossDisposable.dispose(),
    }
  } catch (error) {
    logger.warn("Terminal WebGL renderer unavailable; falling back to DOM renderer.", { error })
    return undefined
  }
}
