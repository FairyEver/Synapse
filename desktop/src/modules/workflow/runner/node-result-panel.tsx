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
import { SYSTEM_NOTIFIER_WORKFLOW_NODE_TYPE } from "../../../../app-capabilities/system-notifier/shared/capability"
import { JSON_REPAIR_WORKFLOW_NODE_TYPE } from "../../../../app-capabilities/json-repair/shared/capability"
import type { SynapseAgentConversationReference } from "@/types/agent-navigation"
import { agentConversationTargetFromOutputs } from "@/lib/agent-conversation-target"
import { track } from "@/lib/ui-tracking"
import { createRendererLogger } from "@/app-shell/logging"
import { cn } from "@/lib/utils"
import { NODE_STATUS_LABEL, NODE_STATUS_VARIANT } from "../lib/status-display"
import { resolveBranchLabel } from "../lib/branch-label"
import { sanitizeWorkflowPrimaryOutput, sanitizeWorkflowResultText, sanitizeWorkflowResultValue } from "./result-sanitize"

const logger = createRendererLogger("workflow.runner")
type ContentRenderMode = "markdown" | "plain"

interface NodeResultPanelProps {
  result: NodeRunResult
  nodeName: string
  definition?: WorkflowDefinition
  onClose: () => void
  onCopyNodeReport?: () => Promise<void>
  onOpenAgentConversation?: (target: SynapseAgentConversationReference) => void
}

export function NodeResultPanel({ result, nodeName, definition, onClose, onCopyNodeReport, onOpenAgentConversation }: NodeResultPanelProps) {
  const inputNodeType = definition?.nodes.find((node) => node.id === result.nodeId)?.type
  const hidesSensitiveInput = inputNodeType === SYSTEM_NOTIFIER_WORKFLOW_NODE_TYPE
    || inputNodeType === JSON_REPAIR_WORKFLOW_NODE_TYPE
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
        hasOutput: result.output != null,
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
  const binaryResponseSummary = describeBinaryHttpResponse(result.outputs)
  const structuredOutputs = resolveStructuredOutputs(result, Boolean(binaryResponseSummary))
  const displayInputVariables = hidesSensitiveInput
    ? {}
    : sanitizeWorkflowResultValue(result.input.variables) as Record<string, unknown>
  const displayPrompt = !hidesSensitiveInput && result.input.prompt
    ? sanitizeWorkflowResultText(result.input.prompt)
    : undefined
  const displayOutput = binaryResponseSummary
    ? sanitizeWorkflowResultText(binaryResponseSummary)
    : result.output != null ? sanitizeWorkflowPrimaryOutput(result.output, result.outputs) : undefined
  const displayError = result.error ? sanitizeWorkflowResultText(result.error) : undefined
  const displayStructuredOutputs = structuredOutputs
    ? sanitizeWorkflowResultValue(structuredOutputs) as Record<string, unknown>
    : undefined
  const codexDebug = isRecord(displayStructuredOutputs?.codexDebug) ? displayStructuredOutputs.codexDebug : undefined
  const claudeCodeDebug = isRecord(displayStructuredOutputs?.claudeCodeDebug) ? displayStructuredOutputs.claudeCodeDebug : undefined
  const displayGenericStructuredOutputs = displayStructuredOutputs
    ? omitRecordKeys(displayStructuredOutputs, ["codexDebug", "claudeCodeDebug"])
    : undefined
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
          {Object.keys(displayInputVariables).length > 0 && (
            <ContentSection title="输入变量" trackingName="workflow-runner-input-variables-render-mode">
              {(mode) => (
                <FieldList>
                  {Object.entries(displayInputVariables).map(([k, v]) => {
                    const content = formatOutputValue(v)
                    return (
                      <FieldBlock key={k} label={`$${k}`} monoLabel>
                        <TextContent content={content || "（空）"} mode={mode} empty={!content} />
                      </FieldBlock>
                    )
                  })}
                </FieldList>
              )}
            </ContentSection>
          )}
          {displayPrompt && (
            <ContentSection title="完整 Prompt" trackingName="workflow-runner-prompt-render-mode">
              {(mode) => (
                <FieldList>
                  <FieldBlock label="内容">
                    <TextContent content={displayPrompt} mode={mode} />
                  </FieldBlock>
                </FieldList>
              )}
            </ContentSection>
          )}
          {displayOutput != null && (
            <ContentSection title="输出" trackingName="workflow-runner-output-render-mode">
              {(mode) => (
                <FieldList>
                  <FieldBlock label="结果">
                    <TextContent content={displayOutput === "" ? "空字符串" : displayOutput} mode={mode} />
                  </FieldBlock>
                </FieldList>
              )}
            </ContentSection>
          )}
          {displayError && (
            <ContentSection
              title="错误"
              titleClassName={result.status === "cancelled" ? "text-muted-foreground" : "text-destructive"}
              trackingName="workflow-runner-error-render-mode"
            >
              {(mode) => (
                <FieldList>
                  <FieldBlock label="错误信息" labelClassName={result.status === "cancelled" ? undefined : "text-destructive"}>
                    <TextContent
                      content={displayError}
                      mode={mode}
                      className={result.status === "cancelled" ? "text-muted-foreground" : "text-destructive"}
                    />
                  </FieldBlock>
                </FieldList>
              )}
            </ContentSection>
          )}
          {codexDebug && (
            <ContentSection title="Codex 调试" trackingName="workflow-runner-codex-debug-render-mode">
              {(mode) => (
                <FieldList>
                  {renderCliDebugFields(codexDebug).map(({ label, value, monoLabel }) => (
                    <FieldBlock key={label} label={label} monoLabel={monoLabel}>
                      <TextContent content={value} mode={mode} />
                    </FieldBlock>
                  ))}
                </FieldList>
              )}
            </ContentSection>
          )}
          {claudeCodeDebug && (
            <ContentSection title="Claude Code 调试" trackingName="workflow-runner-claude-code-debug-render-mode">
              {(mode) => (
                <FieldList>
                  {renderCliDebugFields(claudeCodeDebug).map(({ label, value, monoLabel }) => (
                    <FieldBlock key={label} label={label} monoLabel={monoLabel}>
                      <TextContent content={value} mode={mode} />
                    </FieldBlock>
                  ))}
                </FieldList>
              )}
            </ContentSection>
          )}
          {displayGenericStructuredOutputs && (
            <ContentSection title="结构化输出" trackingName="workflow-runner-structured-output-render-mode">
              {(mode) => (
                <FieldList>
                  {Object.entries(displayGenericStructuredOutputs).map(([k, v]) => (
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
            && result.output == null
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
        <div className={cn("grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 py-2", open && "border-b")}>
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full min-w-0 shrink justify-start px-1"
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
            className="justify-self-end"
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
      <div className={cn("min-w-0 max-w-full overflow-hidden break-all rounded-md bg-muted p-3", className)}>
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

function renderCliDebugFields(value: Record<string, unknown>): Array<{ label: string, value: string, monoLabel?: boolean }> {
  const fields: Array<{ label: string, value: string, monoLabel?: boolean }> = []
  appendCliDebugField(fields, "command", value.command)
  appendCliDebugField(fields, "args", formatCliArgs(value.args))
  appendCliDebugField(fields, "cwd", value.cwd)
  appendCliDebugField(fields, "exitCode", value.exitCode)
  appendCliDebugField(fields, "signal", value.signal)
  appendCliDebugField(fields, "durationMs", value.durationMs)
  appendCliDebugField(fields, "stdoutPath", value.stdoutPath)
  appendCliDebugField(fields, "stderrPath", value.stderrPath)
  appendCliDebugField(fields, "promptPath", value.promptPath)
  appendCliDebugField(fields, "lastMessagePath", value.lastMessagePath)
  appendCliDebugField(fields, "stdoutPreview", value.stdoutPreview)
  appendCliDebugField(fields, "stderrPreview", value.stderrPreview)
  appendCliDebugField(fields, "sessionHints", value.sessionHints)
  return fields
}

function appendCliDebugField(
  fields: Array<{ label: string, value: string, monoLabel?: boolean }>,
  label: string,
  value: unknown,
) {
  if (value === null || value === undefined || value === "") return
  fields.push({
    label,
    value: typeof value === "string" ? value : formatOutputValue(value),
    monoLabel: true,
  })
}

function formatCliArgs(value: unknown): string | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined
  if (value.every((entry) => typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean")) {
    return value.map((entry) => String(entry)).join(" ")
  }
  return formatOutputValue(value)
}

function resolveStructuredOutputs(result: NodeRunResult, omitBody = false): Record<string, unknown> | undefined {
  if (!result.outputs || Object.keys(result.outputs).length === 0) return undefined
  const entries = Object.entries(result.outputs).filter(([key, value]) => (
    key !== "agentConversation"
    && !(key === "markdown" && typeof value === "string" && value === result.output)
    && !(key === "body" && (omitBody || (typeof value === "string" && value === result.output)))
  ))
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

function describeBinaryHttpResponse(outputs: Record<string, unknown> | undefined): string | undefined {
  if (!outputs || !isRecord(outputs.headers)) return undefined
  const contentType = recordStringValue(outputs.headers, "content-type")?.split(";", 1)[0]?.trim().toLowerCase()
  if (!contentType || isTextContentType(contentType)) return undefined

  const contentLength = recordStringValue(outputs.headers, "content-length")
  const parsedLength = contentLength && /^\d+$/.test(contentLength) ? Number(contentLength) : undefined
  const size = parsedLength === undefined ? "" : `，${formatByteSize(parsedLength)}`
  return `二进制响应未显示：${contentType}${size}`
}

function recordStringValue(record: Record<string, unknown>, key: string): string | undefined {
  const target = key.toLowerCase()
  const entry = Object.entries(record).find(([recordKey, value]) => (
    recordKey.toLowerCase() === target && typeof value === "string"
  ))
  return entry?.[1] as string | undefined
}

function isTextContentType(contentType: string): boolean {
  if (contentType.startsWith("text/") || contentType.endsWith("+json") || contentType.endsWith("+xml")) {
    return true
  }
  return [
    "application/graphql",
    "application/javascript",
    "application/json",
    "application/sql",
    "application/toml",
    "application/x-www-form-urlencoded",
    "application/x-yaml",
    "application/xml",
    "application/yaml",
  ].includes(contentType)
}

function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function omitRecordKeys(record: Record<string, unknown>, keysToOmit: readonly string[]): Record<string, unknown> | undefined {
  const omittedKeys = new Set(keysToOmit)
  const entries = Object.entries(record).filter(([key]) => !omittedKeys.has(key))
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
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
