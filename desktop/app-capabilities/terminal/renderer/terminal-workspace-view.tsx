import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type Ref,
} from "react"
import { FitAddon } from "@xterm/addon-fit"
import { WebLinksAddon } from "@xterm/addon-web-links"
import { WebglAddon } from "@xterm/addon-webgl"
import { Terminal } from "@xterm/xterm"
import { X } from "lucide-react"
import "@xterm/xterm/css/xterm.css"
import { toast } from "sonner"

import { createRendererLogger } from "../../../src/app-shell/logging"
import { Button } from "../../../src/components/ui/button"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "../../../src/components/ui/resizable"
import { requireBridgeDomain } from "../../../src/lib/electron-bridge"
import { runTrackedOperation } from "../../../src/lib/ui-tracking"
import { cn } from "../../../src/lib/utils"
import type {
  SynapseTerminalLayoutNode,
  SynapseTerminalOutputChunk,
  SynapseTerminalPaneDropEdge,
  SynapseTerminalResizedEvent,
  SynapseTerminalSession,
  SynapseTerminalWorkspace,
} from "../../../src/types/terminal"
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
import {
  constrainTerminalCompositionToViewport,
  createTerminalRenderingOptions,
} from "./terminal-rendering"

const TERMINAL_WRITE_CHUNK_SIZE = 60 * 1024
const TERMINAL_PANE_DRAG_TYPE = "application/x-synapse-terminal-pane"
const TERMINAL_PANE_DROP_EDGE_RATIO = 0.25
const logger = createRendererLogger("terminal.workspace")

export type TerminalWorkspaceViewHandle = {
  clearActivePane(): void
}

type PaneControls = {
  clear(): void
  focus(): void
}

export function TerminalWorkspaceView({
  activePaneId,
  appearanceSize,
  onActivePaneChange,
  onClosePane,
  onMovePane,
  onSessionChanged,
  onSessionDeleted,
  onSplitPane,
  onSplitRatioChange,
  platform,
  ref,
  sessions,
  workspace,
}: {
  readonly activePaneId: string
  readonly appearanceSize: TerminalAppearanceSize
  readonly onActivePaneChange: (paneId: string) => void
  readonly onClosePane: (paneId: string) => void
  readonly onMovePane: (
    sourcePaneId: string,
    targetPaneId: string,
    edge: SynapseTerminalPaneDropEdge,
  ) => void
  readonly onSessionChanged: (session: SynapseTerminalSession) => void
  readonly onSessionDeleted: (sessionId: string) => void
  readonly onSplitPane: (paneId: string, direction: "right" | "down") => void
  readonly onSplitRatioChange: (splitId: string, ratio: number) => void
  readonly platform: string | undefined
  readonly ref?: Ref<TerminalWorkspaceViewHandle>
  readonly sessions: readonly SynapseTerminalSession[]
  readonly workspace: SynapseTerminalWorkspace
}) {
  const paneElementsRef = useRef(new Map<string, HTMLDivElement>())
  const paneControlsRef = useRef(new Map<string, PaneControls>())
  const [paneDrag, setPaneDrag] = useState<{
    readonly sourcePaneId: string
    readonly targetPaneId: string | null
    readonly edge: SynapseTerminalPaneDropEdge | null
  } | null>(null)
  const sessionsById = useMemo(
    () => new Map(sessions.map((session) => [session.id, session])),
    [sessions],
  )

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

  const focusPane = useCallback((paneId: string, direction: FocusDirection) => {
    const nextPaneId = findPaneInDirection(paneId, direction, paneElementsRef.current)
    if (!nextPaneId) return
    onActivePaneChange(nextPaneId)
    paneControlsRef.current.get(nextPaneId)?.focus()
  }, [onActivePaneChange])

  const handleShortcut = useCallback((paneId: string, shortcut: TerminalPaneShortcut) => {
    if (shortcut === "split-right") return onSplitPane(paneId, "right")
    if (shortcut === "split-down") return onSplitPane(paneId, "down")
    if (shortcut === "close-pane") return onClosePane(paneId)
    focusPane(paneId, shortcut.slice("focus-".length) as FocusDirection)
  }, [focusPane, onClosePane, onSplitPane])

  const handlePaneDragStart = useCallback((sourcePaneId: string) => {
    setPaneDrag({ sourcePaneId, targetPaneId: null, edge: null })
  }, [])

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

  return (
    <TerminalLayout
      activePaneId={activePaneId}
      appearanceSize={appearanceSize}
      layout={workspace.layout}
      draggedPaneId={paneDrag?.sourcePaneId ?? null}
      dropEdge={paneDrag?.edge ?? null}
      dropTargetPaneId={paneDrag?.targetPaneId ?? null}
      onActivePaneChange={onActivePaneChange}
      onMovePane={onMovePane}
      onPaneDragEnd={handlePaneDragEnd}
      onPaneDragStart={handlePaneDragStart}
      onPaneDragTargetChange={handlePaneDragTargetChange}
      onSessionChanged={onSessionChanged}
      onSessionDeleted={onSessionDeleted}
      onShortcut={handleShortcut}
      onSplitRatioChange={onSplitRatioChange}
      platform={platform}
      registerPaneControls={registerPaneControls}
      registerPaneElement={registerPaneElement}
      sessionsById={sessionsById}
    />
  )
}

function TerminalLayout({
  activePaneId,
  appearanceSize,
  draggedPaneId,
  dropEdge,
  dropTargetPaneId,
  layout,
  onActivePaneChange,
  onMovePane,
  onPaneDragEnd,
  onPaneDragStart,
  onPaneDragTargetChange,
  onSessionChanged,
  onSessionDeleted,
  onShortcut,
  onSplitRatioChange,
  platform,
  registerPaneControls,
  registerPaneElement,
  sessionsById,
}: {
  readonly activePaneId: string
  readonly appearanceSize: TerminalAppearanceSize
  readonly draggedPaneId: string | null
  readonly dropEdge: SynapseTerminalPaneDropEdge | null
  readonly dropTargetPaneId: string | null
  readonly layout: SynapseTerminalLayoutNode
  readonly onActivePaneChange: (paneId: string) => void
  readonly onMovePane: (
    sourcePaneId: string,
    targetPaneId: string,
    edge: SynapseTerminalPaneDropEdge,
  ) => void
  readonly onPaneDragEnd: () => void
  readonly onPaneDragStart: (paneId: string) => void
  readonly onPaneDragTargetChange: (paneId: string, edge: SynapseTerminalPaneDropEdge | null) => void
  readonly onSessionChanged: (session: SynapseTerminalSession) => void
  readonly onSessionDeleted: (sessionId: string) => void
  readonly onShortcut: (paneId: string, shortcut: TerminalPaneShortcut) => void
  readonly onSplitRatioChange: (splitId: string, ratio: number) => void
  readonly platform: string | undefined
  readonly registerPaneControls: (paneId: string, controls: PaneControls | null) => void
  readonly registerPaneElement: (paneId: string, element: HTMLDivElement | null) => void
  readonly sessionsById: ReadonlyMap<string, SynapseTerminalSession>
}) {
  if (layout.type === "leaf") {
    const session = sessionsById.get(layout.sessionId)
    if (!session) return null
    return (
      <TerminalPane
        active={layout.paneId === activePaneId}
        appearanceSize={appearanceSize}
        dragSourcePaneId={draggedPaneId}
        dragged={layout.paneId === draggedPaneId}
        dropEdge={layout.paneId === dropTargetPaneId ? dropEdge : null}
        onActive={() => onActivePaneChange(layout.paneId)}
        onMovePane={onMovePane}
        onPaneDragEnd={onPaneDragEnd}
        onPaneDragStart={() => onPaneDragStart(layout.paneId)}
        onPaneDragTargetChange={(edge) => onPaneDragTargetChange(layout.paneId, edge)}
        onSessionChanged={onSessionChanged}
        onSessionDeleted={onSessionDeleted}
        onShortcut={(shortcut) => onShortcut(layout.paneId, shortcut)}
        paneId={layout.paneId}
        platform={platform}
        registerControls={registerPaneControls}
        registerElement={registerPaneElement}
        session={session}
      />
    )
  }

  const firstId = `${layout.splitId}:first`
  const secondId = `${layout.splitId}:second`
  const sharedProps = {
    activePaneId,
    appearanceSize,
    draggedPaneId,
    dropEdge,
    dropTargetPaneId,
    onActivePaneChange,
    onMovePane,
    onPaneDragEnd,
    onPaneDragStart,
    onPaneDragTargetChange,
    onSessionChanged,
    onSessionDeleted,
    onShortcut,
    onSplitRatioChange,
    platform,
    registerPaneControls,
    registerPaneElement,
    sessionsById,
  }

  return (
    <ResizablePanelGroup
      id={layout.splitId}
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
      <ResizablePanel id={firstId} minSize="10%">
        <TerminalLayout {...sharedProps} layout={layout.first} />
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel id={secondId} minSize="10%">
        <TerminalLayout {...sharedProps} layout={layout.second} />
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}

function TerminalPane({
  active,
  appearanceSize,
  dragSourcePaneId,
  dragged,
  dropEdge,
  onActive,
  onMovePane,
  onPaneDragEnd,
  onPaneDragStart,
  onPaneDragTargetChange,
  onSessionChanged,
  onSessionDeleted,
  onShortcut,
  paneId,
  platform,
  registerControls,
  registerElement,
  session,
}: {
  readonly active: boolean
  readonly appearanceSize: TerminalAppearanceSize
  readonly dragSourcePaneId: string | null
  readonly dragged: boolean
  readonly dropEdge: SynapseTerminalPaneDropEdge | null
  readonly onActive: () => void
  readonly onMovePane: (
    sourcePaneId: string,
    targetPaneId: string,
    edge: SynapseTerminalPaneDropEdge,
  ) => void
  readonly onPaneDragEnd: () => void
  readonly onPaneDragStart: () => void
  readonly onPaneDragTargetChange: (edge: SynapseTerminalPaneDropEdge | null) => void
  readonly onSessionChanged: (session: SynapseTerminalSession) => void
  readonly onSessionDeleted: (sessionId: string) => void
  readonly onShortcut: (shortcut: TerminalPaneShortcut) => void
  readonly paneId: string
  readonly platform: string | undefined
  readonly registerControls: (paneId: string, controls: PaneControls | null) => void
  readonly registerElement: (paneId: string, element: HTMLDivElement | null) => void
  readonly session: SynapseTerminalSession
}) {
  const terminalBridge = requireBridgeDomain("terminal")
  const shellBridge = requireBridgeDomain("shell")
  const containerRef = useRef<HTMLDivElement | null>(null)
  const xtermRef = useRef<Terminal | null>(null)
  const syncTerminalGeometryRef = useRef<((refreshRenderer?: boolean) => void) | null>(null)
  const appearanceSizeRef = useRef(appearanceSize)
  const sessionRef = useRef(session)
  const onSessionChangedRef = useRef(onSessionChanged)
  const onSessionDeletedRef = useRef(onSessionDeleted)
  const onShortcutRef = useRef(onShortcut)
  const [readError, setReadError] = useState<string | null>(null)
  appearanceSizeRef.current = appearanceSize
  sessionRef.current = session
  onSessionChangedRef.current = onSessionChanged
  onSessionDeletedRef.current = onSessionDeleted
  onShortcutRef.current = onShortcut

  useEffect(() => {
    const xterm = xtermRef.current
    if (!xterm) return
    xterm.options.disableStdin = session.status !== "running"
  }, [session.status])

  useEffect(() => {
    if (active) xtermRef.current?.focus()
  }, [active])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return undefined

    setReadError(null)
    let disposed = false
    let deleted = false
    let lastSeq = 0
    let attached = false
    let projectionAvailable = false
    let geometrySyncReady = false
    let appliedSizeRevision = sessionRef.current.sizeRevision
    let announcedSizeRevision = sessionRef.current.sizeRevision
    let drainInFlight = false
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

    const syncTerminalGeometry = (refreshRenderer = false) => {
      if (disposed || !geometrySyncReady || !projectionAvailable) return
      if (refreshRenderer) xterm.refresh(0, xterm.rows - 1)
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
      clear: () => {
        xterm.clear()
        syncTerminalGeometry(true)
      },
      focus: () => xterm.focus(),
    }
    registerControls(paneId, controls)

    const resizeObserver = new ResizeObserver(() => {
      syncTerminalGeometry()
      constrainComposition()
    })
    resizeObserver.observe(container)

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
    const writeTerminalData = (data: string) => new Promise<void>((resolve) => {
      if (disposed) return resolve()
      xterm.write(data, resolve)
    })

    const writePendingChunksThrough = async (throughOutputSeq: number) => {
      pendingChunks.sort((left, right) => left.seq - right.seq)
      while (!disposed && pendingChunks.length > 0) {
        const chunk = pendingChunks[0]!
        if (chunk.seq > throughOutputSeq) break
        pendingChunks.shift()
        if (chunk.seq <= lastSeq) continue
        await writeTerminalData(chunk.data)
        lastSeq = chunk.seq
      }
    }

    const drainProjection = async () => {
      if (drainInFlight || !attached || !projectionAvailable || disposed) return
      drainInFlight = true
      try {
        while (!disposed) {
          const nextBarrier = [...resizeBarriers.values()]
            .filter((event) => event.sizeRevision > appliedSizeRevision)
            .sort((left, right) => left.sizeRevision - right.sizeRevision)[0]
          if (nextBarrier) {
            await writePendingChunksThrough(nextBarrier.throughOutputSeq)
            if (disposed) return
            xterm.resize(nextBarrier.cols, nextBarrier.rows)
            xterm.refresh(0, xterm.rows - 1)
            appliedSizeRevision = nextBarrier.sizeRevision
            requestedResize = { cols: nextBarrier.cols, rows: nextBarrier.rows }
            resizeBarriers.delete(nextBarrier.sizeRevision)
            continue
          }
          if (announcedSizeRevision > appliedSizeRevision || pendingChunks.length === 0) return
          await writePendingChunksThrough(Number.POSITIVE_INFINITY)
        }
      } finally {
        drainInFlight = false
        const hasApplicableBarrier = [...resizeBarriers.keys()].some((revision) => revision > appliedSizeRevision)
        if (hasApplicableBarrier || (announcedSizeRevision <= appliedSizeRevision && pendingChunks.length > 0)) {
          void drainProjection()
        }
      }
    }

    const unsubscribeData = terminalBridge.operation.onData((event) => {
      if (event.sessionId !== session.id || disposed) return
      pendingChunks.push(event.chunk)
      void drainProjection()
    })
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
    const unsubscribeResized = terminalBridge.operation.onResized((event) => {
      if (event.sessionId !== session.id || disposed || event.sizeRevision <= appliedSizeRevision) return
      announcedSizeRevision = Math.max(announcedSizeRevision, event.sizeRevision)
      resizeBarriers.set(event.sizeRevision, event)
      void drainProjection()
    })

    const attachProjection = async () => {
      const snapshot = await terminalBridge.session.attach({ sessionId: session.id })
      if (disposed) return
      onSessionChangedRef.current(snapshot.session)
      if (snapshot.degraded) {
        setReadError("终端画面无法恢复")
        attached = true
        return
      }
      xterm.resize(snapshot.cols, snapshot.rows)
      await writeTerminalData(snapshot.serialized)
      if (disposed) return
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
    }

    void attachProjection().catch((error) => {
      logger.error("Failed to attach terminal projection.", error)
      if (!disposed && !deleted) {
        setReadError("终端画面无法恢复")
        toast.error("终端画面无法恢复")
      }
    })

    return () => {
      disposed = true
      unsubscribeData()
      unsubscribeSessionChanged()
      unsubscribeSessionDeleted()
      unsubscribeResized()
      inputDisposable.dispose()
      webglRenderer?.dispose()
      resizeObserver.disconnect()
      compositionTextarea?.removeEventListener("compositionupdate", constrainComposition)
      registerControls(paneId, null)
      if (syncTerminalGeometryRef.current === syncTerminalGeometry) {
        syncTerminalGeometryRef.current = null
      }
      if (xtermRef.current === xterm) xtermRef.current = null
      xterm.dispose()
    }
  }, [paneId, platform, registerControls, session.id, shellBridge, terminalBridge])

  useEffect(() => {
    const xterm = xtermRef.current
    if (!xterm) return
    xterm.options.fontSize = getTerminalAppearanceOptions(appearanceSize).fontSize
    syncTerminalGeometryRef.current?.(true)
  }, [appearanceSize])

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (isTerminalPaneDrag(event)) {
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
    if (!isExternalFileDrag(event)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = "copy"
  }, [dragSourcePaneId, onPaneDragTargetChange, paneId])

  const handleDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!isTerminalPaneDrag(event)) return
    const relatedTarget = event.relatedTarget
    if (relatedTarget instanceof Node && event.currentTarget.contains(relatedTarget)) return
    onPaneDragTargetChange(null)
  }, [onPaneDragTargetChange])

  const handleDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (isTerminalPaneDrag(event)) {
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
    if (!isExternalFileDrag(event)) return
    event.preventDefault()
    onActive()
    if (session.status !== "running") {
      toast.error("终端未运行")
      return
    }
    const paths = Array.from(event.dataTransfer.files ?? []).map((file) => shellBridge.filePathForDroppedFile(file))
    if (paths.length === 0 || paths.some((path) => !isValidDroppedTerminalPath(path))) {
      toast.error("拖拽路径不可用")
      return
    }
    const input = formatDroppedTerminalPaths(paths.filter(isValidDroppedTerminalPath))
    void runTrackedOperation(
      { component: "terminal", eventKey: "terminal.pane.drop_files" },
      () => writeTerminalInputChunks({
        input,
        write: (data) => terminalBridge.session.write({ sessionId: session.id, data }),
      }),
    ).catch((error) => {
      logger.error("Failed to write dropped terminal paths.", error)
      toast.error("写入终端失败")
    })
  }, [dragSourcePaneId, onActive, onMovePane, onPaneDragEnd, paneId, session.id, session.status, shellBridge, terminalBridge])

  const handlePaneDragStart = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (event.target instanceof Element && event.target.closest("button")) {
      event.preventDefault()
      return
    }
    event.dataTransfer.effectAllowed = "move"
    event.dataTransfer.setData(TERMINAL_PANE_DRAG_TYPE, paneId)
    onPaneDragStart()
  }, [onPaneDragStart, paneId])

  return (
    <div
      ref={(element) => registerElement(paneId, element)}
      role="region"
      aria-label={`终端输出与输入：${session.title}`}
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
        <span className="truncate text-xs font-medium text-foreground/75" title={session.title}>
          {session.title}
        </span>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          aria-label={`关闭分屏：${session.title}`}
          title="关闭分屏"
          className="text-muted-foreground hover:text-destructive"
          onClick={(event) => {
            event.stopPropagation()
            onShortcut("close-pane")
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <X className="size-3.5" />
        </Button>
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
      {readError ? (
        <div className="absolute inset-x-1 top-8 z-10 bg-background px-2 py-1 text-sm text-muted-foreground">
          {readError}
        </div>
      ) : null}
      <div
        data-terminal-xterm-frame
        className="h-full min-h-0 min-w-0 flex-1 overflow-hidden p-1"
      >
        <div
          ref={containerRef}
          data-terminal-xterm-mount
          className="h-full min-h-0 min-w-0 overflow-hidden"
        />
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
