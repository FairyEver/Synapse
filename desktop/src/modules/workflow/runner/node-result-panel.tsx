import { useState, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { MarkdownViewer } from "@/components/markdown-viewer"
import { ScrollArea } from "@/components/ui/scroll-area"
import { TokenUsageSummary } from "@/components/token-usage-summary"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { ChevronDown, Copy, MessageSquare, X } from "lucide-react"
import type { NodeRunResult, WorkflowDefinition } from "@/types/workflow"
import type { SynapseAgentConversationTarget } from "@/types/agent-navigation"
import { agentConversationTargetFromOutputs } from "@/lib/agent-conversation-target"
import { track } from "@/lib/ui-tracking"
import { createRendererLogger } from "@/app-shell/logging"
import { cn } from "@/lib/utils"
import { NODE_STATUS_LABEL, NODE_STATUS_VARIANT } from "../lib/status-display"
import { resolveBranchLabel } from "../lib/branch-label"

const logger = createRendererLogger("workflow.runner")
type ContentRenderMode = "markdown" | "plain"

interface NodeResultPanelProps {
  result: NodeRunResult
  nodeName: string
  definition?: WorkflowDefinition
  onClose: () => void
  onCopyNodeReport?: () => Promise<void>
  onOpenAgentConversation?: (target: SynapseAgentConversationTarget) => void
}

export function NodeResultPanel({ result, nodeName, definition, onClose, onCopyNodeReport, onOpenAgentConversation }: NodeResultPanelProps) {
  // Resolve activeBranch ID to user-configured label when definition is available
  const activeBranchLabel = (() => {
    if (!result.activeBranch || !definition) return result.activeBranch
    return resolveBranchLabel(definition, result.nodeId, result.activeBranch)
  })()
  const handleClose = () => {
    track({
      component: "workflow.runner",
      name: "workflow-runner-node-result-close",
      action: "close",
      value: result.nodeId,
      metadata: {
        boundary: "renderer.workflow.runner.node-result",
        nodeId: result.nodeId,
        status: result.status,
        hasOutput: Boolean(result.output),
        hasError: Boolean(result.error),
        hasPrompt: Boolean(result.input.prompt),
        variableCount: Object.keys(result.input.variables).length,
        outputLength: result.output?.length ?? 0,
        errorLength: result.error?.length ?? 0,
        promptLength: result.input.prompt?.length ?? 0,
      },
    })
    onClose()
  }
  const structuredOutputs = resolveStructuredOutputs(result)
  const agentConversation = agentConversationTargetFromOutputs(result.outputs)

  return (
    <div className="flex h-full min-w-0 max-w-full flex-col overflow-hidden">
      <div className="flex min-w-0 items-center gap-2 border-b px-3 py-2">
        <span className="text-sm font-medium truncate flex-1">{nodeName}</span>
        <Badge variant={NODE_STATUS_VARIANT[result.status] ?? "outline"} className="text-xs">
          {NODE_STATUS_LABEL[result.status] ?? result.status}
        </Badge>
        {result.status === "running" && result.progressLabel && (
          <span className="text-xs text-muted-foreground animate-pulse">{result.progressLabel}</span>
        )}
        {onCopyNodeReport && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7"
            data-track="workflow-runner-copy-node-report"
            onClick={() => void onCopyNodeReport()}
          >
            <Copy className="h-3.5 w-3.5 mr-1" />复制
          </Button>
        )}
        {agentConversation ? (
          <Button
            size="sm"
            variant="ghost"
            className="h-7"
            onClick={() => onOpenAgentConversation?.(agentConversation)}
          >
            <MessageSquare data-icon="inline-start" />
            打开对话
          </Button>
        ) : null}
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6"
          aria-label="关闭节点详情"
          data-track="workflow-runner-node-result-close-button"
          onClick={handleClose}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      <ScrollArea className="min-w-0 flex-1 p-3">
        <div className="flex min-w-0 max-w-full flex-col gap-3 text-xs">
          <TokenUsageSummary usage={result.usage} />
          {Object.keys(result.input.variables).length > 0 && (
            <ContentSection title="输入变量" trackingName="workflow-runner-input-variables-render-mode">
              {(mode) => (
                <FieldList>
                  {Object.entries(result.input.variables).map(([k, v]) => (
                    <FieldBlock key={k} label={`$${k}`} monoLabel>
                      <TextContent content={v || "（空）"} mode={mode} empty={!v} />
                    </FieldBlock>
                  ))}
                </FieldList>
              )}
            </ContentSection>
          )}
          {result.input.prompt && (
            <ContentSection title="完整 Prompt" trackingName="workflow-runner-prompt-render-mode">
              {(mode) => (
                <FieldList>
                  <FieldBlock label="内容">
                    <TextContent content={result.input.prompt ?? ""} mode={mode} />
                  </FieldBlock>
                </FieldList>
              )}
            </ContentSection>
          )}
          {result.output != null && result.output !== "" && (
            <ContentSection title="输出" trackingName="workflow-runner-output-render-mode">
              {(mode) => (
                <FieldList>
                  <FieldBlock label="结果">
                    <TextContent content={result.output ?? ""} mode={mode} />
                  </FieldBlock>
                </FieldList>
              )}
            </ContentSection>
          )}
          {result.error && (
            <ContentSection
              title="错误"
              titleClassName={result.status === "cancelled" ? "text-muted-foreground" : "text-destructive"}
              trackingName="workflow-runner-error-render-mode"
            >
              {(mode) => (
                <FieldList>
                  <FieldBlock label="错误信息" labelClassName={result.status === "cancelled" ? undefined : "text-destructive"}>
                    <TextContent
                      content={result.error ?? ""}
                      mode={mode}
                      className={result.status === "cancelled" ? "text-muted-foreground" : "text-destructive"}
                    />
                  </FieldBlock>
                </FieldList>
              )}
            </ContentSection>
          )}
          {structuredOutputs && (
            <ContentSection title="结构化输出" trackingName="workflow-runner-structured-output-render-mode">
              {(mode) => (
                <FieldList>
                  {Object.entries(structuredOutputs).map(([k, v]) => (
                    <FieldBlock key={k} label={k} monoLabel>
                      <TextContent content={formatOutputValue(v)} mode={mode} />
                    </FieldBlock>
                  ))}
                </FieldList>
              )}
            </ContentSection>
          )}
          {activeBranchLabel && (
            <div className="grid gap-1">
              <p className="font-medium text-muted-foreground">命中分支</p>
              <span className="font-mono">{activeBranchLabel}</span>
            </div>
          )}
          {!result.input.prompt && !result.error && !activeBranchLabel
            && (result.output == null || result.output === "")
            && (!result.outputs || Object.keys(result.outputs).length === 0) && (
            <p className="text-muted-foreground">
              {result.status === "skipped" ? "节点因工作流分支逻辑被跳过，未执行" : result.status === "pending" ? "节点等待执行" : result.status === "running" ? "节点正在执行…" : result.status === "cancelled" ? "节点执行被取消" : "（无可展示的输出）"}
            </p>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

interface ContentSectionProps {
  children: (mode: ContentRenderMode) => ReactNode
  title: string
  titleClassName?: string
  trackingName: string
}

function ContentSection({ children, title, titleClassName, trackingName }: ContentSectionProps) {
  const [mode, setMode] = useState<ContentRenderMode>("markdown")
  const [open, setOpen] = useState(true)

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      data-track={trackingName}
      className="min-w-0 max-w-full overflow-hidden rounded-lg border bg-background"
    >
      <section>
        <div className={cn("flex items-center justify-between gap-2 px-3 py-2", open && "border-b")}>
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="min-w-0 justify-start px-1"
              aria-label={`${open ? "折叠" : "展开"}${title}`}
            >
              <ChevronDown className={cn("transition-transform", !open && "-rotate-90")} />
              <span className={cn("truncate font-medium text-muted-foreground", titleClassName)}>{title}</span>
            </Button>
          </CollapsibleTrigger>
          <ToggleGroup
            type="single"
            value={mode}
            onValueChange={(value) => {
              if (value === "markdown" || value === "plain") setMode(value)
            }}
            variant="outline"
            size="sm"
            data-track={`${trackingName}-mode`}
            aria-label={`${title}渲染模式`}
          >
            <ToggleGroupItem value="markdown" aria-label="Markdown 渲染">Markdown</ToggleGroupItem>
            <ToggleGroupItem value="plain" aria-label="文本渲染">文本</ToggleGroupItem>
          </ToggleGroup>
        </div>
        <CollapsibleContent className="min-w-0 px-3 py-3">
          {children(mode)}
        </CollapsibleContent>
      </section>
    </Collapsible>
  )
}

function FieldList({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-w-0 max-w-full flex-col gap-3">
      {children}
    </div>
  )
}

interface FieldBlockProps {
  children: ReactNode
  label: string
  labelClassName?: string
  monoLabel?: boolean
}

function FieldBlock({ children, label, labelClassName, monoLabel = false }: FieldBlockProps) {
  return (
    <div className="flex min-w-0 max-w-full flex-col gap-1.5 border-t pt-3 first:border-t-0 first:pt-0">
      <span
        className={cn(
          "text-xs font-medium text-muted-foreground",
          monoLabel && "font-mono",
          labelClassName,
        )}
      >
        {label}
      </span>
      <div className="min-w-0 max-w-full">
        {children}
      </div>
    </div>
  )
}

interface TextContentProps {
  className?: string
  content: string
  empty?: boolean
  mode: ContentRenderMode
}

function TextContent({ className, content, empty = false, mode }: TextContentProps) {
  if (empty) {
    return <span className="text-muted-foreground italic">（空）</span>
  }

  if (mode === "markdown") {
    return (
      <div className={cn("min-w-0 max-w-full overflow-hidden rounded-md bg-muted p-3", className)}>
        <MarkdownViewer content={content} mode="rendered" showTabs={false} surface="plain" />
      </div>
    )
  }

  return (
    <pre className={cn("min-w-0 max-w-full overflow-hidden rounded-md bg-muted p-3 whitespace-pre-wrap break-all font-mono text-sm", className)}>
      {content}
    </pre>
  )
}

function formatOutputValue(value: unknown): string {
  if (value === null || value === undefined) return "（空）"
  if (typeof value === "bigint") return value.toString()
  if (typeof value === "object") {
    try {
      return JSON.stringify(value, getCircularReplacer())
    } catch (err) {
      logger.warn("[node-result-panel] JSON.stringify failed", err)
      return "[非序列化值]"
    }
  }
  return String(value)
}

function resolveStructuredOutputs(result: NodeRunResult): Record<string, unknown> | undefined {
  if (!result.outputs || Object.keys(result.outputs).length === 0) return undefined
  const entries = Object.entries(result.outputs).filter(([key, value]) => (
    key !== "agentConversation"
    && !(key === "markdown" && typeof value === "string" && value === result.output)
  ))
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

/** JSON.stringify replacer that replaces circular references with a marker. */
function getCircularReplacer(): (key: string, value: unknown) => unknown {
  const seen = new WeakSet<object>()
  return (_key: string, value: unknown) => {
    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) return "[Circular]"
      seen.add(value)
    }
    return value
  }
}
