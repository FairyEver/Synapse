import { Component, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Renderer } from "@openuidev/react-lang"
import { isRecoverableGeneratedUiError, normalizeGeneratedUiSource, validateGeneratedUiSource } from "@/lib/agent-generated-ui"
import { redactSensitiveText } from "@/lib/agent-redaction"
import { createRendererLogger } from "@/app-shell/logging"
import { Button } from "@/components/ui/button"
import type { GeneratedUiBlock } from "@/types/agent-generated-ui"
import { useGeneratedUi } from "./use-generated-ui"
import { GeneratedUiFailureContext, guardedOpenuiLibrary } from "./guarded-library"
import { AgentSharePrivacyContext } from "../share/privacy-context"

const logger = createRendererLogger("agent.generated-ui")

function SourceFallback({ source, error }: { source: string; error: string }) {
  return <div data-agent-render-error className="space-y-2"><p className="text-sm text-muted-foreground">{error}</p><pre className="max-w-full overflow-x-auto whitespace-pre-wrap text-sm"><code>{source}</code></pre></div>
}

class GeneratedUiBoundary extends Component<{ children: ReactNode; source: string }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error) { logger.warn("agent.generated-ui.render.failed", { errorName: error.name }) }
  render() { return this.state.failed ? <SourceFallback source={this.props.source} error="界面暂时无法显示。" /> : this.props.children }
}

export function GeneratedUiView({ source, streaming, block, projectId, conversationId, disabled = false, snapshotOnly = false, hideEmails = false }: {
  source: string; streaming: boolean; block?: GeneratedUiBlock; projectId?: string; conversationId?: string; disabled?: boolean; snapshotOnly?: boolean; hideEmails?: boolean
}) {
  const [renderFailed, setRenderFailed] = useState(false)
  const wasStreaming = useRef(streaming)
  useEffect(() => {
    if (wasStreaming.current && !streaming) setRenderFailed(false)
    wasStreaming.current = streaming
  }, [streaming])
  const onRenderFailure = useCallback((error: Error) => { logger.warn("agent.generated-ui.render.failed", { errorName: error.name }); setRenderFailed(true) }, [])
  const safeSource = useMemo(() => redactSensitiveText(source), [source])
  const renderSource = useMemo(() => normalizeGeneratedUiSource(safeSource), [safeSource])
  const validationError = useMemo(() => validateGeneratedUiSource(safeSource, streaming), [safeSource, streaming])
  const target = !streaming && !validationError && block && projectId && conversationId
    ? { projectId, conversationId, blockId: block.id } : undefined
  const controller = useGeneratedUi(target, snapshotOnly, hideEmails)
  if (validationError) return <SourceFallback source={safeSource} error={validationError} />
  if (renderFailed) return <SourceFallback source={safeSource} error="界面暂时无法显示。" />
  if (controller?.loading) return <p data-agent-render-pending className="text-sm text-muted-foreground">加载中</p>
  if (controller?.error) return <div data-agent-render-error className="space-y-2"><p className="text-sm text-muted-foreground">{controller.error}</p><Button variant="outline" onClick={() => void controller.restore()}>重新加载</Button></div>
  return (
    <GeneratedUiBoundary source={safeSource}>
      {controller?.snapshot.submission?.status === "uncertain" ? <p className="text-sm text-muted-foreground">提交状态待确认，请查看对话。</p> : null}
      <div data-agent-generated-ui="" className="w-full min-w-0 max-w-full overflow-x-auto" inert={disabled || streaming || !controller || controller.snapshot.readOnly || controller.busy}>
        <AgentSharePrivacyContext.Provider value={snapshotOnly && hideEmails}><GeneratedUiFailureContext.Provider value={onRenderFailure}>
          <Renderer response={renderSource} library={guardedOpenuiLibrary} isStreaming={streaming} publishObservability={false}
            initialState={controller?.snapshot.state} onStateUpdate={controller?.stateChanged} onAction={disabled ? undefined : controller?.action}
            onError={(errors) => { if (!streaming && errors.some((error) => error.severity !== "warning" && !isRecoverableGeneratedUiError(error))) { logger.warn("agent.generated-ui.parse.failed", { count: errors.length }); setRenderFailed(true) } }} />
        </GeneratedUiFailureContext.Provider></AgentSharePrivacyContext.Provider>
      </div>
    </GeneratedUiBoundary>
  )
}
