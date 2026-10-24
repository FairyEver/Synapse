import { Component, useEffect, useState, type ReactNode } from "react"
import { getSynapseBridge } from "@/lib/electron-bridge"
import { createRendererLogger } from "@/app-shell/logging"
import type { ShareRenderRequest, ShareRenderResponse } from "../../../../app-capabilities/agent/shared/share"
import { captureShareImage, shareBlobBase64 } from "./image"
import { AgentSharePaper } from "./share-paper"
import { GeneratedUiTheme } from "../openui/generated-ui-theme"
import { AgentShareSnapshotsContext } from "./privacy-context"

const logger = createRendererLogger("agent.share.host")

/** Mounted beside the app router, so changing pages never swaps the job's source. */
export function AgentShareRenderHost() {
  const [requests, setRequests] = useState<ShareRenderRequest[]>([])
  useEffect(() => getSynapseBridge()?.agent?.onShareEvent?.(event => {
    if (event.type === "shareRenderCancelled") setRequests(current => current.filter(item => item.requestId !== event.payload.requestId))
    if (event.type === "shareRender") setRequests(current => current.some(item => item.requestId === event.payload.requestId) ? current : [...current, event.payload])
  }), [])
  return <>{requests.map(request => <ShareRenderBoundary key={request.requestId} request={request} onDone={() => setRequests(current => current.filter(item => item.requestId !== request.requestId))}><ShareRenderJob request={request} onDone={() => setRequests(current => current.filter(item => item.requestId !== request.requestId))} /></ShareRenderBoundary>)}</>
}

function ShareRenderJob({ request, onDone }: { request: ShareRenderRequest; onDone: () => void }) {
  const [paper, setPaper] = useState<HTMLElement | null>(null)
  useEffect(() => {
    if (!paper) return
    const controller = new AbortController()
    const identity: ShareRenderResponse = { requestId: request.requestId, nonce: request.nonce, projectId: request.projectId, conversationId: request.conversationId }
    async function render() {
      let result: ShareRenderResponse
      try {
        const blob = await captureShareImage(paper!, request.settings.scale, "save", controller.signal, identity)
        controller.signal.throwIfAborted()
        const pngBase64 = await shareBlobBase64(blob)
        controller.signal.throwIfAborted()
        result = { ...identity, pngBase64 }
      } catch (cause) {
        if (controller.signal.aborted) return
        logger.warn("Share render failed.", { errorName: cause instanceof Error ? cause.name : typeof cause })
        const message = cause instanceof Error ? cause.message : ""
        const error = /过长|过大|清晰度|像素|文件过/.test(message) ? "limit_exceeded" : /宽度|滚动/.test(message) ? "layout_failed" : /图片|图表|资源|加载/.test(message) ? "resource_failed" : "render_failed"
        result = { ...identity, error }
      }
      try { await getSynapseBridge()?.agent.completeShareRender(result) }
      catch (cause) { logger.warn("Share render response rejected.", { errorName: cause instanceof Error ? cause.name : typeof cause }) }
      if (!controller.signal.aborted) onDone()
    }
    void render()
    return () => controller.abort()
    // onDone changes as sibling jobs complete; a running capture must keep its lease.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paper, request])
  return <div aria-hidden="true" inert className="pointer-events-none fixed -left-[20000px] top-0">
    <GeneratedUiTheme><AgentShareSnapshotsContext.Provider value={request.generatedUi}>
      <AgentSharePaper paperRef={setPaper} target={request} messages={request.messages} settings={request.settings} indexes={new Map(request.messages.map(m => [m.id, m.ordinal]))} />
    </AgentShareSnapshotsContext.Provider></GeneratedUiTheme>
  </div>
}

class ShareRenderBoundary extends Component<{ request: ShareRenderRequest; onDone(): void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(cause: Error) {
    logger.warn("Share component render failed.", { errorName: cause.name })
    const { requestId, nonce, projectId, conversationId } = this.props.request
    void getSynapseBridge()?.agent.completeShareRender({ requestId, nonce, projectId, conversationId, error: "render_failed" })
      .catch(error => logger.warn("Share failure response rejected.", { errorName: error instanceof Error ? error.name : typeof error }))
      .finally(() => this.props.onDone())
  }
  render() { return this.state.failed ? null : this.props.children }
}
