import { useMemo } from "react"
import { toast } from "sonner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { CodeIcon, EyeIcon } from "lucide-react"
import { renderMarkdown } from "@/lib/markdown"
import { cn } from "@/lib/utils"
import { requireBridgeDomain } from "@/lib/electron-bridge"

// highlight.js 基础样式（颜色变量由下面的 CSS 定义）
import "highlight.js/styles/github.css"

type MarkdownViewerMode = "rendered" | "source"
type MarkdownViewerSurface = "default" | "plain"

type MarkdownViewerProps = {
  className?: string
  content: string
  mode?: MarkdownViewerMode
  showTabs?: boolean
  surface?: MarkdownViewerSurface
}

export const MARKDOWN_BODY_CLASSNAME = cn(
  "min-w-0 max-w-full text-sm leading-6 text-foreground",
  "[&_a]:text-foreground [&_a]:underline [&_a]:underline-offset-4",
  "[&_blockquote]:border-l [&_blockquote]:border-border [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground",
  "[&_code]:break-words [&_code]:rounded-sm [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.8125rem]",
  "[&_h1]:text-lg [&_h1]:font-semibold",
  "[&_h2]:text-base [&_h2]:font-semibold",
  "[&_h3]:font-medium",
  "[&_hr]:my-4 [&_hr]:border-border",
  "[&_img]:max-w-full",
  "[&_li>p]:my-1",
  "[&_ol]:list-decimal [&_ol]:pl-5",
  "[&_p]:break-words",
  "[&_pre]:max-w-full [&_pre]:whitespace-pre-wrap [&_pre]:break-words [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-border [&_pre]:bg-muted/40 [&_pre]:p-0",
  "[&_pre_code]:whitespace-pre-wrap [&_pre_code]:break-words [&_pre_code]:bg-transparent [&_pre_code]:p-4",
  "[&_table]:w-full [&_table]:max-w-full [&_table]:table-fixed [&_table]:border-collapse",
  "[&_tbody_tr]:border-t [&_tbody_tr]:border-border",
  "[&_td]:break-words [&_td]:align-top [&_td]:px-3 [&_td]:py-2",
  "[&_th]:break-words [&_th]:border-b [&_th]:border-border [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-medium",
  "[&_ul]:list-disc [&_ul]:pl-5",
  "[&_*+blockquote]:mt-4 [&_*+h1]:mt-6 [&_*+h2]:mt-6 [&_*+h3]:mt-5 [&_*+hr]:mt-6 [&_*+ol]:mt-3 [&_*+p]:mt-3 [&_*+pre]:mt-4 [&_*+table]:mt-4 [&_*+ul]:mt-3",
  // 代码块样式 - 使用 github 主题作为基础
  "[&_.hljs]:bg-transparent",
  "[&_pre.hljs]:bg-muted/40",
  // 暗色模式覆盖 - 使用 CSS 变量
  "dark:[&_.hljs]:text-[var(--hljs-text)]",
  "dark:[&_.hljs-doctag]:text-[var(--hljs-keyword)]",
  "dark:[&_.hljs-keyword]:text-[var(--hljs-keyword)]",
  "dark:[&_.hljs-literal]:text-[var(--hljs-literal)]",
  "dark:[&_.hljs-number]:text-[var(--hljs-number)]",
  "dark:[&_.hljs-operator]:text-[var(--hljs-operator)]",
  "dark:[&_.hljs-selector]:text-[var(--hljs-selector)]",
  "dark:[&_.hljs-regexp]:text-[var(--hljs-regexp)]",
  "dark:[&_.hljs-string]:text-[var(--hljs-string)]",
  "dark:[&_.hljs-title]:text-[var(--hljs-title)]",
  "dark:[&_.hljs-variable]:text-[var(--hljs-variable)]",
  "dark:[&_.hljs-attr]:text-[var(--hljs-attr)]",
  "dark:[&_.hljs-attribute]:text-[var(--hljs-attribute)]",
  "dark:[&_.hljs-built_in]:text-[var(--hljs-built-in)]",
  "dark:[&_.hljs-bullet]:text-[var(--hljs-bullet)]",
  "dark:[&_.hljs-class]:text-[var(--hljs-class)]",
  "dark:[&_.hljs-code]:text-[var(--hljs-code)]",
  "dark:[&_.hljs-comment]:text-[var(--hljs-comment)]",
  "dark:[&_.hljs-formula]:text-[var(--hljs-formula)]",
  "dark:[&_.hljs-function]:text-[var(--hljs-function)]",
  "dark:[&_.hljs-name]:text-[var(--hljs-name)]",
  "dark:[&_.hljs-tag]:text-[var(--hljs-tag)]",
  "dark:[&_.hljs-quote]:text-[var(--hljs-quote)]",
  "dark:[&_.hljs-section]:text-[var(--hljs-section)]",
  "dark:[&_.hljs-params]:text-[var(--hljs-text)]",
  "dark:[&_.hljs-punctuation]:text-[var(--hljs-text)]",
  "dark:[&_.hljs-link]:text-[var(--hljs-link)]",
  "dark:[&_.hljs-template-variable]:text-[var(--hljs-template-variable)]",
  "dark:[&_.hljs-type]:text-[var(--hljs-type)]",
  "dark:[&_.hljs-addition]:text-[var(--hljs-addition)] dark:[&_.hljs-addition]:bg-[var(--hljs-addition-bg)]",
  "dark:[&_.hljs-deletion]:text-[var(--hljs-deletion)] dark:[&_.hljs-deletion]:bg-[var(--hljs-deletion-bg)]",
  "dark:[&_.hljs-meta]:text-[var(--hljs-meta)]",
  "dark:[&_.hljs-subst]:text-[var(--hljs-subst)]",
  "dark:[&_.hljs-symbol]:text-[var(--hljs-symbol)]",
  "dark:[&_.hljs-emphasis]:italic",
  "dark:[&_.hljs-strong]:font-bold",
)

function MarkdownViewer({
  className,
  content,
  mode = "rendered",
  showTabs = true,
  surface = "default",
}: MarkdownViewerProps) {
  const renderedHtml = useMemo(() => renderMarkdown(content), [content])
  const surfaceClassName = surface === "plain"
    ? "border-0 rounded-none bg-transparent p-0"
    : "rounded-lg border border-border bg-muted/20 px-4 py-4"

  const handleRenderedClickCapture = async (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target

    if (!(target instanceof HTMLElement)) {
      return
    }

    const link = target.closest("a")

    if (!link) {
      return
    }

    const href = link.getAttribute("href")
    if (!href) return

    // Anchor links: let browser handle naturally (same-page navigation)
    if (href.startsWith("#")) {
      return
    }

    event.preventDefault()

    if (href.startsWith("http://") || href.startsWith("https://")) {
      try {
        await requireBridgeDomain("shell").openExternal(href)
      } catch {
        toast.error("无法打开链接")
      }
      return
    }

    toast.error("不支持打开此链接")
  }

  const renderedContent = (
    <div
      data-allow-select="true"
      className={cn("markdown-viewer min-w-0 max-w-full", surfaceClassName)}
      onClickCapture={handleRenderedClickCapture}
    >
      <div
        className={MARKDOWN_BODY_CLASSNAME}
        dangerouslySetInnerHTML={{ __html: renderedHtml }}
      />
    </div>
  )

  const sourceContent = (
    <div
      data-allow-select="true"
      className={cn("min-w-0 max-w-full", surfaceClassName)}
    >
      <pre className="whitespace-pre-wrap break-words font-mono text-sm leading-6 text-foreground">
        {content}
      </pre>
    </div>
  )

  if (!showTabs) {
    return mode === "source" ? sourceContent : renderedContent
  }

  return (
    <Tabs defaultValue="rendered" className={cn("gap-2", className)}>
      <TabsList className="mx-auto">
        <TabsTrigger value="rendered">
          <EyeIcon />
          预览
        </TabsTrigger>
        <TabsTrigger value="source">
          <CodeIcon />
          源码
        </TabsTrigger>
      </TabsList>

      <TabsContent value="rendered" className="mt-0">
        {renderedContent}
      </TabsContent>

      <TabsContent value="source" className="mt-0">
        {sourceContent}
      </TabsContent>
    </Tabs>
  )
}

export { MarkdownViewer }
export type { MarkdownViewerMode, MarkdownViewerSurface }
