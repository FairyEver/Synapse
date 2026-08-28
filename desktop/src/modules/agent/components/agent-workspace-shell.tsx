import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { ArrowLeft, X } from "lucide-react"

import { WorkspaceAuxiliaryPanelLayout } from "@/components/workspace-auxiliary-panel-layout"
import { Button } from "@/components/ui/button"

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
}

const AgentWorkspacePanelContext = createContext<AgentWorkspacePanelContextValue | null>(null)

type AgentWorkspaceShellProps = {
  readonly children: ReactNode
  readonly conversationKey: string
  readonly mode: "embedded" | "window"
  readonly panels: readonly AgentWorkspacePanelRegistration[]
}

export function AgentWorkspaceShell({
  children,
  conversationKey,
  mode,
  panels,
}: AgentWorkspaceShellProps) {
  const [request, setRequest] = useState<AgentWorkspacePanelRequest | null>(null)
  const initialFocusRef = useRef<HTMLButtonElement>(null)
  const returnFocusElementRef = useRef<HTMLElement | null>(null)
  const returnFocusIdRef = useRef<string | null>(null)
  const restoreFocusFrameRef = useRef<number | null>(null)
  const shouldRestoreFocusRef = useRef(false)
  const openPanel = useCallback((nextRequest: AgentWorkspacePanelRequest) => {
    const registration = panels.find((candidate) => candidate.id === nextRequest.panelId)
    if (!registration) return
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
  }, [])
  const contextValue = useMemo<AgentWorkspacePanelContextValue>(() => ({
    openPanel,
    closePanel,
  }), [closePanel, openPanel])

  useEffect(() => {
    if (restoreFocusFrameRef.current !== null) {
      window.cancelAnimationFrame(restoreFocusFrameRef.current)
      restoreFocusFrameRef.current = null
    }
    shouldRestoreFocusRef.current = false
    returnFocusElementRef.current = null
    returnFocusIdRef.current = null
    setRequest(null)
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

  useEffect(() => () => {
    if (restoreFocusFrameRef.current !== null) {
      window.cancelAnimationFrame(restoreFocusFrameRef.current)
    }
  }, [])

  useEffect(() => {
    if (!request) return undefined
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return
      event.preventDefault()
      closePanel()
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [closePanel, request])

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

  return (
    <AgentWorkspacePanelContext.Provider value={contextValue}>
      <WorkspaceAuxiliaryPanelLayout
        main={children}
        auxiliary={panel}
        persistenceId={`agent-${mode}`}
      />
    </AgentWorkspacePanelContext.Provider>
  )
}

export function useAgentWorkspacePanel(): AgentWorkspacePanelContextValue {
  const value = useContext(AgentWorkspacePanelContext)
  if (!value) throw new Error("useAgentWorkspacePanel must be used inside AgentWorkspaceShell")
  return value
}
