import { Component, useEffect, useMemo, useState, type ErrorInfo, type ReactNode } from "react"
import { DiffModeEnum, DiffView } from "@git-diff-view/react"
import { WrapText } from "lucide-react"
import "@git-diff-view/react/styles/diff-view-pure.css"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Toggle } from "@/components/ui/toggle"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { createRendererLogger } from "@/app-shell/logging"
import { isBinaryGitDiff } from "../lib/git-diff-sections"

export type GitDiffViewMode = "unified" | "split"

type GitDiffViewerProps = {
  readonly path: string
  readonly originalPath?: string | null
  readonly statusLabel?: string
  readonly text: string
  readonly binary?: boolean
  readonly truncated?: boolean
  readonly mode: GitDiffViewMode
  readonly wrap: boolean
  readonly onModeChange: (mode: GitDiffViewMode) => void
  readonly onWrapChange: (wrap: boolean) => void
}

const logger = createRendererLogger("git.diff-viewer")

export function GitDiffViewer({
  path,
  originalPath = null,
  statusLabel,
  text,
  binary = false,
  truncated = false,
  mode,
  wrap,
  onModeChange,
  onWrapChange,
}: GitDiffViewerProps) {
  const theme = useDocumentTheme()
  const data = useMemo(() => ({
    oldFile: { fileName: originalPath ?? path },
    newFile: { fileName: path },
    hunks: [text],
  }), [originalPath, path, text])
  const fallbackKey = `${path}:${originalPath ?? ""}:${text.length}`

  return (
    <div className="grid min-w-0 bg-background">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-b px-4 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium" title={path}>{path}</span>
          {statusLabel ? <Badge variant="outline">{statusLabel}</Badge> : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ToggleGroup
            type="single"
            value={mode}
            variant="outline"
            size="sm"
            aria-label="差异布局"
            data-track="git-diff-layout"
            onValueChange={(value) => {
              if (value === "unified" || value === "split") onModeChange(value)
            }}
          >
            <ToggleGroupItem value="unified" aria-label="统一视图">统一</ToggleGroupItem>
            <ToggleGroupItem value="split" aria-label="分栏视图">分栏</ToggleGroupItem>
          </ToggleGroup>
          <Toggle
            variant="outline"
            size="sm"
            pressed={wrap}
            aria-label="自动换行"
            data-track="git-diff-wrap"
            onPressedChange={onWrapChange}
          >
            <WrapText />
            换行
          </Toggle>
        </div>
      </div>
      {truncated ? (
        <div className="p-4 pb-0">
          <Alert>
            <AlertTitle>差异内容已截断</AlertTitle>
            <AlertDescription>内容过大，仅显示前 2 MiB。</AlertDescription>
          </Alert>
        </div>
      ) : null}
      {binary || isBinaryGitDiff(text) ? (
        <div className="p-4 text-sm text-muted-foreground">文件已变更。</div>
      ) : text ? (
        <GitDiffRenderBoundary key={fallbackKey} text={text}>
          <div className="min-w-0 overflow-x-auto" data-allow-select="true">
            <DiffView
              data={data}
              diffViewMode={mode === "split" ? DiffModeEnum.Split : DiffModeEnum.Unified}
              diffViewTheme={theme}
              diffViewWrap={wrap}
              diffViewHighlight
              diffViewFontSize={12}
            />
          </div>
        </GitDiffRenderBoundary>
      ) : (
        <div className="p-4 text-sm text-muted-foreground">没有文本差异。</div>
      )}
    </div>
  )
}

export function GitRawDiff({ text, parseFailed = false }: { readonly text: string; readonly parseFailed?: boolean }) {
  return (
    <div className="grid min-w-0 gap-3 p-4">
      {parseFailed ? (
        <Alert>
          <AlertTitle>无法格式化差异</AlertTitle>
          <AlertDescription>已显示原始内容。</AlertDescription>
        </Alert>
      ) : null}
      <pre className="block w-full min-w-0 max-w-full overflow-x-auto bg-muted p-3 text-xs leading-relaxed text-foreground" data-allow-select="true">
        {text || "没有文本差异。"}
      </pre>
    </div>
  )
}

class GitDiffRenderBoundary extends Component<{
  readonly children: ReactNode
  readonly text: string
}, { readonly failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logger.warn("Git diff renderer failed; using raw text fallback.", {
      errorName: error.name,
      componentStackAvailable: Boolean(info.componentStack),
    })
  }

  render() {
    if (this.state.failed) return <GitRawDiff text={this.props.text} parseFailed />
    return this.props.children
  }
}

function useDocumentTheme(): "light" | "dark" {
  const readTheme = () => document.documentElement.classList.contains("dark") ? "dark" : "light"
  const [theme, setTheme] = useState<"light" | "dark">(readTheme)

  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(readTheme()))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
    return () => observer.disconnect()
  }, [])

  return theme
}
